/**
 * Bridge between inventory movements and the existing product provenance chain.
 *
 * Quantity movements are recorded as hash-chained events on the *batch passport* (when the batch
 * has one), inside the same database transaction as the ledger entries. The events are anchored on
 * the blockchain after commit through the existing event service, so a chain outage never blocks or
 * corrupts stock operations (proofs simply stay PENDING).
 */
import type { ProductEvent } from "@prisma/client";
import type { EventType } from "../../lib/constants.js";
import type { Db } from "../../lib/prisma.js";
import { eventService } from "../event.service.js";

export type ProvenanceInput = {
  batch: { id: string; passportProductId: string | null } | null;
  organizationId: string;
  actorUserId: string | null;
  eventType: EventType;
  /** Coarse, public-safe place (city / country). Never storage codes or bins. */
  publicLocation: string | null;
  metadata: Record<string, unknown>;
};

/** Appends one event to the batch passport; returns null when the batch has no passport. */
export async function recordInventoryEvent(tx: Db, input: ProvenanceInput): Promise<ProductEvent | null> {
  if (!input.batch?.passportProductId) return null;
  const passport = await tx.product.findUnique({ where: { id: input.batch.passportProductId }, include: { identity: true } });
  if (!passport?.identity?.isCanonical) return null;
  return eventService.insert(tx, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    productId: passport.id,
    eventType: input.eventType,
    location: input.publicLocation,
    metadata: { ...input.metadata, batchId: input.batch.id },
  });
}

/** Anchors (and audits) the events after the surrounding transaction committed. */
export async function anchorAfterCommit(events: Array<ProductEvent | null>, ipHash?: string | null) {
  for (const event of events) {
    if (!event) continue;
    try {
      await eventService.afterCommit(event, { ipHash });
    } catch (error) {
      // The stock operation is already committed. Anchoring problems are reported, never surfaced as a
      // failed movement; the event stays unanchored (shown as NOT_ANCHORED / PENDING, never as verified).
      console.error(JSON.stringify({ level: "error", msg: "inventory provenance anchoring failed", eventId: event.id, error: String(error) }));
    }
  }
}

export function publicPlace(warehouse: { city: string | null; country: string | null } | null | undefined) {
  if (!warehouse) return null;
  return [warehouse.city, warehouse.country].filter(Boolean).join(", ") || null;
}
