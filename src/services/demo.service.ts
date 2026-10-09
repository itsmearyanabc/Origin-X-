/**
 * DEMO ONLY — simulates a database-level attacker so the integrity engine can be demonstrated.
 * Available only when DEMO_MODE=true (production configuration refuses to start with it enabled).
 *
 *  naive   : edits one event's content in place. Detected by hash recomputation.
 *  rewrite : edits one event AND recomputes every downstream hash and link, so the database chain
 *            looks perfectly consistent. Only the on-chain anchors can expose it.
 */
import { z } from "zod";
import { config } from "../config.js";
import { AppError, notFound } from "../lib/errors.js";
import { computeEventHash } from "../lib/crypto.js";
import { json, prisma } from "../lib/prisma.js";
import type { Actor } from "../middleware/tenant.js";
import { writeAudit } from "./audit.service.js";
import { verificationService } from "./verification.service.js";

export class DemoService {
  assertEnabled() {
    if (!config.demoMode) throw new AppError("NOT_FOUND", "Route not found.", 404);
  }

  async tamper(a: Actor, productId: string, input: unknown) {
    this.assertEnabled();
    const data = z
      .object({
        mode: z.enum(["naive", "rewrite"]).default("naive"),
        sequence: z.number().int().positive().optional(),
        change: z.record(z.unknown()).default({ location: "Unverified warehouse (tampered)" }),
      })
      .parse(input ?? {});
    const product = await prisma.product.findFirst({ where: { id: productId, organizationId: a.organizationId } });
    if (!product) throw notFound("Product");
    const events = await prisma.productEvent.findMany({ where: { productId }, orderBy: { sequence: "asc" } });
    if (events.length < 2) throw new AppError("NOT_ENOUGH_EVENTS", "The product needs at least two events to demonstrate tampering.", 409);
    const target = events.find((e) => e.sequence === (data.sequence ?? Math.ceil(events.length / 2)));
    if (!target) throw new AppError("EVENT_NOT_FOUND", "No event with that sequence.", 404);

    const before = await verificationService.assess(productId);
    const location = typeof data.change.location === "string" ? data.change.location : target.location;
    const metadata = { ...json(target.metadataJson), ...Object.fromEntries(Object.entries(data.change).filter(([k]) => k !== "location")) };

    await prisma.$transaction(async (tx) => {
      const unlock = await tx.demoTamperUnlock.create({ data: {} });
      if (data.mode === "naive") {
        await tx.productEvent.update({ where: { id: target.id }, data: { location, metadataJson: JSON.stringify(metadata) } });
      } else {
        let previous = target.previousEventHash;
        for (const event of events.filter((e) => e.sequence >= target.sequence)) {
          const isTarget = event.id === target.id;
          const eventMetadata = isTarget ? metadata : json(event.metadataJson);
          const eventLocation = isTarget ? location : event.location;
          const eventHash = computeEventHash(
            {
              productId,
              sequence: event.sequence,
              eventType: event.eventType,
              actorUserId: event.actorUserId,
              actorOrganizationId: event.actorOrganizationId,
              timestamp: event.timestamp.toISOString(),
              location: eventLocation,
              metadata: eventMetadata,
            },
            previous,
          );
          await tx.productEvent.update({
            where: { id: event.id },
            data: { location: eventLocation, metadataJson: JSON.stringify(eventMetadata), previousEventHash: previous, eventHash },
          });
          previous = eventHash;
        }
      }
      await tx.demoTamperUnlock.delete({ where: { id: unlock.id } });
    });

    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: "DEMO_TAMPER_EXECUTED",
      resourceType: "ProductEvent",
      resourceId: target.id,
      metadata: { mode: data.mode, sequence: target.sequence, demo: true },
      ipHash: a.ipHash,
    });

    const after = await verificationService.assess(productId);
    return {
      demo: true,
      mode: data.mode,
      tamperedEvent: { id: target.id, sequence: target.sequence, eventType: target.eventType, originalHash: target.eventHash },
      before: { historyValid: before.history.historyValid, trustScore: before.trust.score, trustLevel: before.trust.level, blockchain: before.history.blockchainVerification.status },
      after: {
        historyValid: after.history.historyValid,
        trustScore: after.trust.score,
        trustLevel: after.trust.level,
        blockchain: after.history.blockchainVerification.status,
        databaseChainLooksValid: after.history.brokenLinks.length === 0 && after.history.tamperedEvents.every((t) => "detectedBy" in t),
        tamperedEvents: after.history.tamperedEvents,
        brokenLinks: after.history.brokenLinks,
        affectedEvents: after.history.affectedEvents,
        firstCompromisedSequence: after.history.firstCompromisedSequence,
        penalties: after.trust.penalties.filter((p) => p.applied).map((p) => p.code),
      },
      note:
        data.mode === "rewrite"
          ? "Every database hash and link was recomputed, so only the blockchain anchors expose the rewrite."
          : "The event was edited without recomputing its hash, so hash recomputation exposes it.",
    };
  }
}

export const demoService = new DemoService();
