import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { canonicalIdentityHash, collisionClaimHash, publicVerificationToken } from "../lib/crypto.js";
import { json, prisma } from "../lib/prisma.js";
import { paginate, parseSort, str, type Query } from "../lib/pagination.js";
import type { Actor } from "../middleware/tenant.js";
import { writeAudit } from "./audit.service.js";
import { blockchainService } from "./blockchain.service.js";
import { entitlementService } from "./entitlement.service.js";
import { eventService } from "./event.service.js";
import { passportSnapshot } from "./hash-chain.service.js";
import { incidentService } from "./incident.service.js";
import { getReadableProduct, orgSummarySelect, productRelation, readableProductWhere } from "./product-access.js";
import { trustScoreService } from "./trust.service.js";

const isoDate = z.string().datetime({ offset: true }).or(z.string().date());

const createSchema = z.object({
  productCode: z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, "Use letters, digits and . _ - /"),
  productName: z.string().trim().min(2).max(200),
  category: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2_000).optional(),
  batchCode: z.string().trim().min(1).max(64).optional(),
  serialNumber: z.string().trim().max(100).optional(),
  originCountry: z.string().trim().max(60).optional(),
  originLocation: z.string().trim().max(200).optional(),
  manufacturingDate: isoDate.optional(),
  expiryDate: isoDate.optional(),
  currentLocation: z.string().trim().max(200).optional(),
});
export type CreateProductInput = z.infer<typeof createSchema>;

const updateSchema = z
  .object({
    productName: z.string().trim().min(2).max(200),
    category: z.string().trim().max(100),
    description: z.string().trim().max(2_000),
  })
  .partial()
  .strict();

const SORTABLE = ["createdAt", "productName", "productCode", "trustScore", "updatedAt"] as const;

const detailInclude = {
  identity: true,
  batch: true,
  organization: { select: orgSummarySelect },
  manufacturer: { select: orgSummarySelect },
  currentOwner: { select: orgSummarySelect },
} satisfies Prisma.ProductInclude;

type CreateOptions = { occurredAt?: Date; passportType?: "UNIT" | "BATCH"; skuId?: string | null };

export function presentProduct<T extends { trustScoreJson: string }>(product: T) {
  const { trustScoreJson, ...rest } = product;
  return { ...rest, trust: json(trustScoreJson) };
}

export class ProductService {
  /**
   * Registers a product and its global identity. Collisions (the same product identity already
   * registered — by another organization, or on-chain) are quarantined as POTENTIAL_COUNTERFEIT
   * instead of being created as genuine products.
   */
  async create(a: Actor, input: unknown, opts: CreateOptions = {}) {
    const data = createSchema.parse(input);
    const entitlement = await entitlementService.assertCanAddProduct(a.organizationId);
    if (opts.passportType === "BATCH" && !data.batchCode) throw new AppError("BATCH_REQUIRED", "A batch passport needs a batch code.", 422);
    // Unit passports: identity = product code + serial. Batch passports (inventory layer): product code + batch.
    const canonical = canonicalIdentityHash(data.productCode, opts.passportType === "BATCH" ? `batch:${data.batchCode}` : data.serialNumber);

    const sameIdentity = await prisma.productIdentity.findFirst({
      where: { canonicalIdentityHash: canonical, isCanonical: true },
      include: { product: true },
    });
    if (sameIdentity && sameIdentity.product.organizationId === a.organizationId) {
      throw new AppError("PRODUCT_ALREADY_REGISTERED", "This product identity is already registered by your organization.", 409);
    }
    const codeOwnedElsewhere = sameIdentity
      ? null
      : await prisma.product.findFirst({
          where: { productCode: { equals: data.productCode, mode: "insensitive" }, organizationId: { not: a.organizationId }, identity: { isCanonical: true } },
        });
    const original = sameIdentity?.product ?? codeOwnedElsewhere;
    const onChain = original ? null : await blockchainService.lookupIdentity(canonical);

    if (original || onChain?.exists) {
      return this.quarantineCollision(a, data, canonical, original, opts);
    }

    const product = await this.persist(a.organizationId, data, {
      passportType: opts.passportType ?? "UNIT",
      skuId: opts.skuId ?? null,
      identity: { canonicalIdentityHash: canonical, identityHash: canonical, isCanonical: true, status: "ACTIVE" },
      status: "ACTIVE",
      authenticityStatus: "AUTHENTIC",
      verificationStatus: "REGISTERED",
    });

    // Identity goes on-chain first; lifecycle event anchors reference it.
    await blockchainService.registerProductIdentity(product.id, canonical);
    await eventService.append({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      productId: product.id,
      eventType: "PRODUCT_REGISTERED",
      location: data.currentLocation ?? data.originLocation ?? null,
      metadata: { passport: passportSnapshot({ ...product, batchCode: data.batchCode ?? null }), identityHash: canonical },
      occurredAt: opts.occurredAt,
      ipHash: a.ipHash,
    });
    await trustScoreService.calculate(product.id);
    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: "PRODUCT_REGISTERED",
      resourceType: "Product",
      resourceId: product.id,
      metadata: { productCode: data.productCode, identityHash: canonical },
      ipHash: a.ipHash,
    });
    return { product: await this.detail(a.organizationId, product.id), collision: null, entitlement };
  }

  private async quarantineCollision(
    a: Actor,
    data: CreateProductInput,
    canonical: string,
    original: { id: string; organizationId: string } | null,
    opts: { occurredAt?: Date },
  ) {
    const claim = await this.persist(a.organizationId, data, {
      identity: {
        canonicalIdentityHash: canonical,
        identityHash: collisionClaimHash(canonical, randomUUID()),
        isCanonical: false,
        collidesWithProductId: original?.id ?? null,
        status: "COUNTERFEIT",
      },
      status: "QUARANTINED",
      authenticityStatus: "COUNTERFEIT",
      verificationStatus: "POTENTIAL_COUNTERFEIT",
    });
    await eventService.append({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      productId: claim.id,
      eventType: "PRODUCT_REGISTERED",
      location: data.currentLocation ?? data.originLocation ?? null,
      metadata: { passport: passportSnapshot({ ...claim, batchCode: data.batchCode ?? null }), identityCollision: true },
      occurredAt: opts.occurredAt,
      ipHash: a.ipHash,
    });

    // Claimant's view: told about the conflict, but never who owns the genuine identity.
    await incidentService.create({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      productId: claim.id,
      type: "IDENTITY_COLLISION",
      severity: "CRITICAL",
      title: "Registration conflicts with an existing product identity",
      description: `Product identity ${data.productCode}${data.serialNumber ? ` / ${data.serialNumber}` : ""} is already registered on ORIGINX. This record is quarantined as a potential counterfeit.`,
      evidence: { canonicalIdentityHash: canonical, detectedBy: original ? "ORIGINX_REGISTRY" : "BLOCKCHAIN_REGISTRY" },
      source: "SYSTEM",
    });
    // Genuine owner's view: full evidence about the clone attempt.
    if (original) {
      const claimant = await prisma.organization.findUniqueOrThrow({ where: { id: a.organizationId } });
      await incidentService.create({
        organizationId: original.organizationId,
        productId: original.id,
        type: "IDENTITY_COLLISION",
        severity: "HIGH",
        title: "Another organization attempted to register this product identity",
        description: `${claimant.name} attempted to register product identity ${data.productCode}. The attempt was quarantined as POTENTIAL_COUNTERFEIT.`,
        evidence: {
          canonicalIdentityHash: canonical,
          claimantOrganizationId: claimant.id,
          claimantOrganizationName: claimant.name,
          claimantOrganizationVerification: claimant.verificationStatus,
          claimantProductId: claim.id,
          attemptedAt: new Date().toISOString(),
        },
        source: "SYSTEM",
      });
    }
    for (const orgId of new Set([a.organizationId, original?.organizationId].filter(Boolean) as string[])) {
      await writeAudit({
        organizationId: orgId,
        actorUserId: a.userId,
        action: "IDENTITY_COLLISION_DETECTED",
        resourceType: "Product",
        resourceId: orgId === a.organizationId ? claim.id : original!.id,
        metadata: { canonicalIdentityHash: canonical },
        ipHash: a.ipHash,
      });
    }
    return {
      product: await this.detail(a.organizationId, claim.id),
      collision: {
        detected: true,
        code: "IDENTITY_COLLISION",
        status: "POTENTIAL_COUNTERFEIT",
        message: "This product identity is already registered. The record was quarantined and an incident was opened.",
      },
      entitlement: null,
    };
  }

  private async persist(
    organizationId: string,
    data: CreateProductInput,
    flags: {
      identity: Prisma.ProductIdentityCreateWithoutProductInput;
      passportType?: string;
      skuId?: string | null;
      status: string;
      authenticityStatus: string;
      verificationStatus: string;
    },
  ) {
    let batchId: string | undefined;
    if (data.batchCode) {
      const batch = await prisma.productBatch.upsert({
        where: { organizationId_batchCode: { organizationId, batchCode: data.batchCode } },
        update: {},
        create: {
          organizationId,
          batchCode: data.batchCode,
          name: data.batchCode,
          manufacturedAt: data.manufacturingDate ? new Date(data.manufacturingDate) : undefined,
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
        },
      });
      batchId = batch.id;
    }
    try {
      return await prisma.product.create({
        data: {
          organizationId,
          productCode: data.productCode,
          productName: data.productName,
          category: data.category,
          description: data.description,
          batchId,
          manufacturerId: organizationId,
          originCountry: data.originCountry,
          originLocation: data.originLocation,
          manufacturingDate: data.manufacturingDate ? new Date(data.manufacturingDate) : undefined,
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
          serialNumber: data.serialNumber,
          currentOwnerOrganizationId: organizationId,
          currentLocation: data.currentLocation ?? data.originLocation,
          status: flags.status,
          authenticityStatus: flags.authenticityStatus,
          verificationStatus: flags.verificationStatus,
          publicVerificationToken: publicVerificationToken(),
          passportType: flags.passportType ?? "UNIT",
          skuId: flags.skuId ?? null,
          identity: { create: flags.identity },
        },
        include: { identity: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("PRODUCT_ALREADY_REGISTERED", "This product identity was registered concurrently. Retry to run collision checks.", 409);
      }
      throw error;
    }
  }

  async list(organizationId: string, q: Query) {
    const filters: Prisma.ProductWhereInput[] = [readableProductWhere(organizationId)];
    const status = str(q, "status");
    const search = str(q, "q");
    const scope = str(q, "scope"); // registered | custody | all
    if (status) filters.push({ status });
    if (str(q, "category")) filters.push({ category: str(q, "category") });
    if (str(q, "trustLevel")) filters.push({ trustLevel: str(q, "trustLevel") });
    if (str(q, "batchCode")) filters.push({ batch: { batchCode: str(q, "batchCode") } });
    if (scope === "registered") filters.push({ organizationId });
    if (scope === "custody") filters.push({ currentOwnerOrganizationId: organizationId });
    if (search) filters.push({ OR: [{ productName: { contains: search, mode: "insensitive" as const } }, { productCode: { contains: search, mode: "insensitive" as const } }, { serialNumber: { contains: search, mode: "insensitive" as const } }] });
    const where = { AND: filters };
    const orderBy = parseSort(q, SORTABLE, "createdAt");
    const result = await paginate(
      q,
      () => prisma.product.count({ where }),
      (page) =>
        prisma.product.findMany({
          where,
          ...page,
          orderBy,
          include: {
            batch: { select: { batchCode: true } },
            identity: { select: { status: true, isCanonical: true } },
            currentOwner: { select: { id: true, name: true } },
          },
        }),
    );
    return { ...result, items: result.items.map(presentProduct) };
  }

  async detail(organizationId: string, productId: string) {
    const product = await prisma.product.findFirst({
      where: { AND: [{ id: productId }, readableProductWhere(organizationId)] },
      include: {
        ...detailInclude,
        events: { orderBy: { sequence: "asc" }, select: { id: true, sequence: true, eventType: true, timestamp: true, location: true, eventHash: true, previousEventHash: true, verificationStatus: true, actorOrganizationId: true } },
        proofs: { orderBy: { createdAt: "asc" } },
        // Tenant isolation: only this organization's own incidents on the product.
        incidents: { where: { organizationId }, orderBy: { createdAt: "desc" } },
        recalls: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!product) throw notFound("Product");
    const { incidents, ...rest } = product;
    return {
      ...presentProduct(rest),
      incidents: incidents.map(({ evidenceJson, ...i }) => ({ ...i, evidence: json(evidenceJson) })),
      relation: productRelation(product, organizationId),
    };
  }

  /** Only presentation fields are editable; identity/origin fields are sealed at registration. */
  async update(a: Actor, productId: string, input: unknown) {
    const patch = updateSchema.parse(input);
    const product = await getReadableProduct(a.organizationId, productId);
    if (product.organizationId !== a.organizationId) throw forbidden("Only the brand owner can edit product details.", "NOT_BRAND_OWNER");
    const updated = await prisma.product.update({ where: { id: productId }, data: patch });
    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: "PRODUCT_UPDATED",
      resourceType: "Product",
      resourceId: productId,
      metadata: { changes: Object.fromEntries(Object.keys(patch).map((k) => [k, { from: (product as Record<string, unknown>)[k], to: (patch as Record<string, unknown>)[k] }])) },
      ipHash: a.ipHash,
    });
    return presentProduct(updated);
  }

  async archive(a: Actor, productId: string) {
    const product = await getReadableProduct(a.organizationId, productId);
    if (product.organizationId !== a.organizationId) throw forbidden("Only the brand owner can archive a product.", "NOT_BRAND_OWNER");
    if (product.status === "ARCHIVED") return presentProduct(product);
    await eventService.append({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      productId,
      eventType: "STATUS_CHANGED",
      metadata: { previousStatus: product.status, newStatus: "ARCHIVED" },
      ipHash: a.ipHash,
    });
    const updated = await prisma.product.update({ where: { id: productId }, data: { status: "ARCHIVED" } });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "PRODUCT_ARCHIVED", resourceType: "Product", resourceId: productId, ipHash: a.ipHash });
    return presentProduct(updated);
  }

  async qr(organizationId: string, productId: string) {
    const product = await getReadableProduct(organizationId, productId);
    const url = `${config.publicVerifyBaseUrl.replace(/\/$/, "")}/${product.publicVerificationToken}`;
    return {
      token: product.publicVerificationToken,
      url,
      svg: await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 }),
      pngDataUrl: await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 512 }),
    };
  }

  // ---------------------------------------------------------------------------
  // Batches
  // ---------------------------------------------------------------------------

  async createBatch(a: Actor, input: unknown) {
    const data = z
      .object({ batchCode: z.string().trim().min(1).max(64), name: z.string().trim().max(200).optional(), manufacturedAt: isoDate.optional(), expiryDate: isoDate.optional() })
      .parse(input);
    const batch = await prisma.productBatch.create({
      data: {
        organizationId: a.organizationId,
        batchCode: data.batchCode,
        name: data.name ?? data.batchCode,
        manufacturedAt: data.manufacturedAt ? new Date(data.manufacturedAt) : undefined,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
      },
    });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "BATCH_CREATED", resourceType: "ProductBatch", resourceId: batch.id, ipHash: a.ipHash });
    return batch;
  }

  async listBatches(organizationId: string, q: Query) {
    const where = { organizationId, ...(str(q, "q") ? { batchCode: { contains: str(q, "q"), mode: "insensitive" as const } } : {}) };
    return paginate(
      q,
      () => prisma.productBatch.count({ where }),
      (page) => prisma.productBatch.findMany({ where, ...page, orderBy: { createdAt: "desc" }, include: { _count: { select: { products: true } } } }),
    );
  }

  async getBatch(organizationId: string, batchId: string) {
    const batch = await prisma.productBatch.findFirst({
      where: { id: batchId, organizationId },
      include: {
        products: { select: { id: true, productCode: true, productName: true, serialNumber: true, status: true, trustScore: true, trustLevel: true } },
        recalls: true,
      },
    });
    if (!batch) throw notFound("ProductBatch", "BATCH_NOT_FOUND");
    return batch;
  }
}

export const productService = new ProductService();
