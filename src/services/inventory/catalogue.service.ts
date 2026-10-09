import { Prisma } from "@prisma/client";
import { z } from "zod";
import { UNIT_CODES, UNITS_OF_MEASURE, BATCH_QUALITY_STATUS } from "../../lib/constants.js";
import { AppError, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { paginate, parseSort, str, type Query } from "../../lib/pagination.js";
import type { Actor } from "../../middleware/tenant.js";
import { writeAudit } from "../audit.service.js";
import { eventService } from "../event.service.js";
import { productService } from "../product.service.js";
import { assertOwner, getOwnedSku, getReadableBatch, getReadableSku, readableSkuWhere } from "./access.js";
import { parseQuantity } from "./ledger.js";

const skuSchema = z.object({
  sku: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/, "Letters, digits and . _ - / only."),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(100).optional(),
  brand: z.string().trim().max(120).optional(),
  unitOfMeasure: z.enum(UNIT_CODES).default("PCS"),
  status: z.enum(["ACTIVE", "DISCONTINUED"]).optional(),
});

const batchPatchSchema = z
  .object({
    skuId: z.string().nullable(),
    unitOfMeasure: z.enum(UNIT_CODES).nullable(),
    plannedQuantity: z.union([z.number(), z.string()]).nullable(),
    qualityStatus: z.enum(BATCH_QUALITY_STATUS),
    passportProductId: z.string().nullable(),
    name: z.string().trim().max(200),
  })
  .partial()
  .strict();

export class CatalogueService {
  async listSkus(organizationId: string, q: Query) {
    const search = str(q, "q");
    const where: Prisma.ProductSkuWhereInput = {
      AND: [
        readableSkuWhere(organizationId),
        ...(str(q, "scope") === "owned" ? [{ organizationId }] : []),
        ...(str(q, "status") ? [{ status: str(q, "status") }] : []),
        ...(search ? [{ OR: [{ sku: { contains: search, mode: "insensitive" as const } }, { name: { contains: search, mode: "insensitive" as const } }, { category: { contains: search, mode: "insensitive" as const } }] }] : []),
      ],
    };
    return paginate(
      q,
      () => prisma.productSku.count({ where }),
      (page) => prisma.productSku.findMany({ where, ...page, orderBy: parseSort(q, ["createdAt", "sku", "name"] as const, "sku", "asc"), include: { _count: { select: { batches: true } } } }),
    );
  }

  async createSku(a: Actor, input: unknown) {
    const data = skuSchema.parse(input);
    try {
      const sku = await prisma.productSku.create({
        data: {
          organizationId: a.organizationId,
          sku: data.sku,
          name: data.name,
          description: data.description,
          category: data.category,
          brand: data.brand,
          manufacturerOrganizationId: a.organizationId,
          unitOfMeasure: data.unitOfMeasure,
          allowsFractional: UNITS_OF_MEASURE[data.unitOfMeasure].fractional,
          status: data.status ?? "ACTIVE",
        },
      });
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "SKU_CREATED", resourceType: "ProductSku", resourceId: sku.id, metadata: { sku: sku.sku }, ipHash: a.ipHash });
      return sku;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("SKU_EXISTS", "This SKU already exists in your catalogue.", 409);
      throw error;
    }
  }

  async updateSku(a: Actor, skuId: string, input: unknown) {
    const sku = await getOwnedSku(a.organizationId, skuId);
    const patch = skuSchema.omit({ sku: true }).partial().parse(input);
    if (patch.unitOfMeasure && patch.unitOfMeasure !== sku.unitOfMeasure) {
      const stock = await prisma.inventoryBalance.count({ where: { skuId } });
      if (stock) throw new AppError("UNIT_LOCKED", "The unit of measure cannot change once stock has been recorded.", 409);
    }
    const updated = await prisma.productSku.update({
      where: { id: skuId },
      data: { ...patch, ...(patch.unitOfMeasure ? { allowsFractional: UNITS_OF_MEASURE[patch.unitOfMeasure].fractional } : {}) },
    });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "SKU_UPDATED", resourceType: "ProductSku", resourceId: skuId, metadata: { fields: Object.keys(patch) }, ipHash: a.ipHash });
    return updated;
  }

  async getSku(organizationId: string, skuId: string) {
    const sku = await getReadableSku(organizationId, skuId);
    const [batches, balances, rule] = await Promise.all([
      prisma.productBatch.findMany({ where: { skuId, OR: [{ organizationId }, { balances: { some: { organizationId } } }] }, orderBy: { createdAt: "desc" } }),
      prisma.inventoryBalance.findMany({ where: { skuId, organizationId }, include: { location: { include: { warehouse: true } }, batch: { select: { batchCode: true, holdStatus: true, expiryDate: true } } } }),
      prisma.reorderRule.findUnique({ where: { organizationId_skuId: { organizationId, skuId } } }),
    ]);
    return { sku, owned: sku.organizationId === organizationId, batches, balances, reorderThreshold: rule?.threshold.toString() ?? null };
  }

  /** Inventory fields on an existing batch (brand owner only). Quality changes are recorded in provenance. */
  async updateBatch(a: Actor, batchId: string, input: unknown) {
    const patch = batchPatchSchema.parse(input);
    const batch = await getReadableBatch(a.organizationId, batchId);
    assertOwner(batch.organizationId, a.organizationId, "batch");
    if (patch.skuId) await getOwnedSku(a.organizationId, patch.skuId);
    if (patch.skuId !== undefined && batch.skuId && patch.skuId !== batch.skuId && (await prisma.inventoryBalance.count({ where: { batchId } }))) {
      throw new AppError("BATCH_SKU_LOCKED", "The SKU of a batch with recorded stock cannot change.", 409);
    }
    if (patch.passportProductId) {
      const passport = await prisma.product.findFirst({ where: { id: patch.passportProductId, organizationId: a.organizationId, identity: { isCanonical: true } } });
      if (!passport) throw notFound("Product");
      if (passport.batchId && passport.batchId !== batchId) throw new AppError("PASSPORT_BATCH_MISMATCH", "That passport belongs to a different batch.", 422);
    }
    const sku = patch.skuId ? await prisma.productSku.findUniqueOrThrow({ where: { id: patch.skuId } }) : batch.skuId ? await prisma.productSku.findUnique({ where: { id: batch.skuId } }) : null;
    const unit = patch.unitOfMeasure ?? batch.unitOfMeasure ?? sku?.unitOfMeasure ?? "PCS";
    const updated = await prisma.productBatch.update({
      where: { id: batchId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.skuId !== undefined ? { skuId: patch.skuId, unitOfMeasure: patch.unitOfMeasure ?? sku?.unitOfMeasure ?? batch.unitOfMeasure } : {}),
        ...(patch.unitOfMeasure !== undefined ? { unitOfMeasure: patch.unitOfMeasure } : {}),
        ...(patch.plannedQuantity !== undefined ? { plannedQuantity: patch.plannedQuantity === null ? null : parseQuantity(patch.plannedQuantity, unit, "plannedQuantity") } : {}),
        ...(patch.qualityStatus ? { qualityStatus: patch.qualityStatus } : {}),
        ...(patch.passportProductId !== undefined ? { passportProductId: patch.passportProductId } : {}),
      },
    });
    if (patch.qualityStatus && patch.qualityStatus !== batch.qualityStatus && updated.passportProductId) {
      await eventService.append({
        organizationId: a.organizationId,
        actorUserId: a.userId,
        productId: updated.passportProductId,
        eventType: patch.qualityStatus === "APPROVED" ? "QUALITY_APPROVED" : "STATUS_CHANGED",
        metadata: { batchId, previousStatus: `QUALITY_${batch.qualityStatus}`, newStatus: `QUALITY_${patch.qualityStatus}` },
        ipHash: a.ipHash,
      });
    }
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "BATCH_UPDATED", resourceType: "ProductBatch", resourceId: batchId, metadata: { fields: Object.keys(patch), qualityStatus: patch.qualityStatus }, ipHash: a.ipHash });
    return updated;
  }

  /**
   * Creates a Digital Product Passport for a whole batch through the existing product service, so
   * it gets the normal on-chain identity, QR token and hash chain. Identity = SKU + "batch:<code>".
   */
  async createBatchPassport(a: Actor, batchId: string, input: unknown) {
    const data = z.object({ originCountry: z.string().trim().max(60).optional(), originLocation: z.string().trim().max(200).optional(), description: z.string().trim().max(2000).optional() }).parse(input ?? {});
    const batch = await getReadableBatch(a.organizationId, batchId);
    assertOwner(batch.organizationId, a.organizationId, "batch");
    if (batch.passportProductId) throw new AppError("PASSPORT_EXISTS", "This batch already has a passport.", 409);
    if (!batch.skuId) throw new AppError("BATCH_WITHOUT_SKU", "Link the batch to a SKU first.", 422);
    const sku = await prisma.productSku.findUniqueOrThrow({ where: { id: batch.skuId } });
    const result = await productService.create(a, {
      productCode: sku.sku,
      productName: sku.name,
      category: sku.category ?? undefined,
      description: data.description ?? sku.description ?? undefined,
      batchCode: batch.batchCode,
      originCountry: data.originCountry,
      originLocation: data.originLocation,
      manufacturingDate: batch.manufacturedAt?.toISOString(),
      expiryDate: batch.expiryDate?.toISOString(),
    }, { passportType: "BATCH", skuId: sku.id });
    if (result.collision) return result;
    await prisma.productBatch.update({ where: { id: batchId }, data: { passportProductId: result.product.id } });
    return result;
  }

  async setReorderRule(a: Actor, skuId: string, input: unknown) {
    const sku = await getReadableSku(a.organizationId, skuId);
    const { threshold } = z.object({ threshold: z.union([z.number(), z.string()]).nullable() }).parse(input);
    if (threshold === null) {
      await prisma.reorderRule.deleteMany({ where: { organizationId: a.organizationId, skuId } });
      return { skuId, threshold: null };
    }
    const value = parseQuantity(threshold, sku.unitOfMeasure, "threshold");
    const rule = await prisma.reorderRule.upsert({
      where: { organizationId_skuId: { organizationId: a.organizationId, skuId } },
      update: { threshold: value },
      create: { organizationId: a.organizationId, skuId, threshold: value },
    });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "REORDER_RULE_SET", resourceType: "ProductSku", resourceId: skuId, metadata: { threshold: value.toString() }, ipHash: a.ipHash });
    return { skuId, threshold: rule.threshold.toString() };
  }
}

export const catalogueService = new CatalogueService();
