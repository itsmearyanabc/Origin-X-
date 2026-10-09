import { Prisma, type ProductEvent } from "@prisma/client";
import { z } from "zod";
import { config } from "../config.js";
import {
  CRITICAL_EVENT_TYPES,
  CUSTODIAN_EVENT_TYPES,
  MANUAL_EVENT_TYPES,
  OWNER_EVENT_TYPES,
  SHARED_EVENT_TYPES,
  type EventType,
} from "../lib/constants.js";
import { computeEventHash } from "../lib/crypto.js";
import { AppError, forbidden } from "../lib/errors.js";
import { GENESIS_HASH } from "../lib/constants.js";
import { json, prisma, type Db } from "../lib/prisma.js";
import type { Actor } from "../middleware/tenant.js";
import { writeAudit } from "./audit.service.js";
import { blockchainService } from "./blockchain.service.js";
import { getReadableProduct, orgSummarySelect, productRelation } from "./product-access.js";

export type AppendParams = {
  organizationId: string;
  actorUserId: string | null;
  productId: string;
  eventType: EventType;
  location?: string | null;
  metadata?: Record<string, unknown>;
  /** Server-side callers only (e.g. demo seed). Never accepted from API clients. */
  occurredAt?: Date;
  anchor?: boolean;
  ipHash?: string | null;
};

const metadataSchema = z
  .record(z.unknown())
  .optional()
  .refine((m) => !m || JSON.stringify(m).length <= 8_000, "Metadata is limited to 8KB.");

const manualEventSchema = z.object({
  eventType: z.enum(MANUAL_EVENT_TYPES),
  location: z.string().trim().max(200).optional(),
  metadata: metadataSchema,
});

const BLOCKED_STATUSES: Record<string, EventType[] | "all"> = {
  QUARANTINED: "all",
  ARCHIVED: ["DOCUMENT_ADDED"],
  RECALLED: ["DOCUMENT_ADDED", "CERTIFICATE_ADDED", "STATUS_CHANGED"],
  SUSPENDED: ["DOCUMENT_ADDED", "CERTIFICATE_ADDED", "STATUS_CHANGED"],
  DELIVERED: ["DOCUMENT_ADDED", "CERTIFICATE_ADDED", "STATUS_CHANGED"],
};

/** Metadata keys written by platform workflows; safe to show to other supply-chain participants. */
const SHARED_METADATA_KEYS = ["custodyTransferId", "fromOrganizationId", "toOrganizationId", "recallId", "previousStatus", "newStatus"];

function sharedMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(metadata).filter(([k]) => SHARED_METADATA_KEYS.includes(k)));
}

export class EventService {
  /** Inserts the next hash-linked event inside an existing transaction. */
  async insert(tx: Db, params: AppendParams): Promise<ProductEvent> {
    const last = await tx.productEvent.findFirst({ where: { productId: params.productId }, orderBy: { sequence: "desc" } });
    const previousEventHash = last?.eventHash ?? GENESIS_HASH;
    const sequence = (last?.sequence ?? 0) + 1;
    const timestamp = params.occurredAt ?? new Date();
    if (last && timestamp < last.timestamp) {
      throw new AppError("EVENT_OUT_OF_ORDER", "Events must be recorded in chronological order.", 409);
    }
    const metadata = params.metadata ?? {};
    // Round-trip through JSON so the hashed payload is exactly what is stored.
    const storedMetadata = JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
    const eventHash = computeEventHash(
      {
        productId: params.productId,
        sequence,
        eventType: params.eventType,
        actorUserId: params.actorUserId,
        actorOrganizationId: params.organizationId,
        timestamp: timestamp.toISOString(),
        location: params.location ?? null,
        metadata: storedMetadata,
      },
      previousEventHash,
    );
    return tx.productEvent.create({
      data: {
        organizationId: params.organizationId,
        productId: params.productId,
        sequence,
        eventType: params.eventType,
        actorUserId: params.actorUserId,
        actorOrganizationId: params.organizationId,
        timestamp,
        location: params.location ?? null,
        metadataJson: JSON.stringify(storedMetadata),
        previousEventHash,
        eventHash,
      },
    });
  }

  /** Runs `work` (which inserts one event) in a transaction, retrying if another writer took the sequence. */
  async inTransaction<T extends { event: ProductEvent }>(work: (tx: Db) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await prisma.$transaction((tx) => work(tx));
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
        if (!conflict || attempt >= 4) throw error;
      }
    }
  }

  /** Post-commit work: anchor the event hash on-chain and audit. */
  async afterCommit(event: ProductEvent, params: Pick<AppendParams, "anchor" | "ipHash">) {
    const shouldAnchor = params.anchor ?? (config.blockchain.anchorPolicy === "all" || CRITICAL_EVENT_TYPES.includes(event.eventType as EventType));
    if (shouldAnchor) {
      const identity = await prisma.productIdentity.findUnique({ where: { productId: event.productId } });
      // Only canonical (non-quarantined) identities exist on-chain, so only their events can be anchored.
      if (identity?.isCanonical) {
        await blockchainService.anchorEventProof(event.productId, event.id, event.eventHash, identity.identityHash);
      }
    }
    await writeAudit({
      organizationId: event.organizationId,
      actorUserId: event.actorUserId,
      action: "EVENT_CREATED",
      resourceType: "ProductEvent",
      resourceId: event.id,
      metadata: { eventType: event.eventType, productId: event.productId, sequence: event.sequence, eventHash: event.eventHash },
      ipHash: params.ipHash,
    });
    return prisma.productEvent.findUniqueOrThrow({ where: { id: event.id }, include: { proof: true } });
  }

  async append(params: AppendParams) {
    const { event } = await this.inTransaction(async (tx) => ({ event: await this.insert(tx, params) }));
    return this.afterCommit(event, params);
  }

  /**
   * Lifecycle event recorded by an organization user. Authority depends on the event type:
   * brand-owner events, custodian events, or either. Platform-workflow events (registration,
   * custody transfer, incidents, recalls) cannot be created directly.
   */
  async createFromRequest(a: Actor, productId: string, input: unknown) {
    const data = manualEventSchema.parse(input);
    const product = await getReadableProduct(a.organizationId, productId);
    const { isBrandOwner, isCurrentCustodian } = productRelation(product, a.organizationId);
    const type = data.eventType;
    const allowed =
      (OWNER_EVENT_TYPES.includes(type) && isBrandOwner) ||
      (CUSTODIAN_EVENT_TYPES.includes(type) && isCurrentCustodian) ||
      (SHARED_EVENT_TYPES.includes(type) && (isBrandOwner || isCurrentCustodian));
    if (!allowed) {
      throw forbidden(
        CUSTODIAN_EVENT_TYPES.includes(type)
          ? `Only the current custodian can record ${type}.`
          : `Only the brand owner can record ${type}.`,
        "EVENT_NOT_PERMITTED",
      );
    }
    const blocked = BLOCKED_STATUSES[product.status];
    if (blocked === "all" || (blocked && !blocked.includes(type))) {
      throw new AppError("PRODUCT_STATUS_BLOCKS_EVENT", `A ${product.status.toLowerCase()} product cannot record ${type}.`, 409);
    }

    const event = await this.append({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      productId,
      eventType: type,
      location: data.location,
      metadata: data.metadata,
      ipHash: a.ipHash,
    });

    const productUpdate: Prisma.ProductUpdateInput = {};
    if (CUSTODIAN_EVENT_TYPES.includes(type) && data.location) productUpdate.currentLocation = data.location;
    if (type === "DELIVERED") productUpdate.status = "DELIVERED";
    if (Object.keys(productUpdate).length) await prisma.product.update({ where: { id: productId }, data: productUpdate });
    return event;
  }

  /** Lifecycle as seen by a tenant: hashes and proof status, with actor organizations summarized. */
  async list(organizationId: string, productId: string) {
    await getReadableProduct(organizationId, productId);
    const events = await prisma.productEvent.findMany({
      where: { productId },
      orderBy: { sequence: "asc" },
      include: {
        organization: { select: orgSummarySelect },
        actor: { select: { id: true, fullName: true } },
        proof: { select: { status: true, transactionHash: true, blockNumber: true, network: true, chainId: true } },
      },
    });
    return events.map(({ metadataJson, organization, actor, ...e }) => ({
      ...e,
      metadata: e.organizationId === organizationId ? json(metadataJson) : sharedMetadata(json(metadataJson)),
      actorOrganization: organization,
      // Users of other organizations are not disclosed.
      actorUser: e.organizationId === organizationId ? actor : null,
    }));
  }
}

export const eventService = new EventService();
