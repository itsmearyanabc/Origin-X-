import { z } from "zod";
import { ACTIVE_RECALL_STATUS } from "../lib/constants.js";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { json, prisma } from "../lib/prisma.js";
import { str, type Query } from "../lib/pagination.js";
import type { Actor } from "../middleware/tenant.js";
import { writeAudit } from "./audit.service.js";
import { blockchainService } from "./blockchain.service.js";
import { eventService } from "./event.service.js";
import { inventoryService } from "./inventory/inventory.service.js";
import { trustScoreService } from "./trust.service.js";

const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["INITIATED", "CANCELLED"],
  INITIATED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Recalls are issued by the brand owner for a single product or a whole batch. Initiating a recall:
 *  - marks every affected product RECALLED (identity stays genuine — status RECALLED),
 *  - appends a hash-chained RECALL_INITIATED event,
 *  - anchors the RECALLED identity status on-chain, so public verification can never be silently
 *    reverted to "verified" in the database alone.
 */
export class RecallService {
  async create(a: Actor, input: unknown) {
    const data = z
      .object({
        productId: z.string().optional(),
        batchId: z.string().optional(),
        reason: z.string().trim().min(3).max(2_000),
        incidentId: z.string().optional(),
        affectedUnits: z.number().int().min(0).optional(),
        initiate: z.boolean().optional(),
      })
      .refine((d) => Boolean(d.productId) !== Boolean(d.batchId), "Provide exactly one of productId or batchId.")
      .parse(input);

    if (data.productId) {
      const product = await prisma.product.findFirst({ where: { id: data.productId, organizationId: a.organizationId } });
      if (!product) throw notFound("Product");
      if (product.status === "QUARANTINED") throw new AppError("PRODUCT_QUARANTINED", "Quarantined records cannot be recalled.", 409);
    }
    if (data.batchId && !(await prisma.productBatch.findFirst({ where: { id: data.batchId, organizationId: a.organizationId } }))) {
      throw notFound("ProductBatch", "BATCH_NOT_FOUND");
    }
    if (data.incidentId && !(await prisma.incident.findFirst({ where: { id: data.incidentId, organizationId: a.organizationId } }))) {
      throw notFound("Incident");
    }
    const units = data.productId ? 1 : await prisma.product.count({ where: { batchId: data.batchId, organizationId: a.organizationId, status: { not: "QUARANTINED" } } });

    const recall = await prisma.recall.create({
      data: {
        organizationId: a.organizationId,
        productId: data.productId,
        batchId: data.batchId,
        reason: data.reason,
        incidentId: data.incidentId,
        affectedUnits: data.affectedUnits ?? units,
        status: "DRAFT",
        initiatedById: a.userId,
      },
    });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "RECALL_DRAFTED", resourceType: "Recall", resourceId: recall.id, ipHash: a.ipHash });
    return data.initiate ? this.transition(a, recall.id, { status: "INITIATED" }) : recall;
  }

  private async affectedProducts(recall: { organizationId: string; productId: string | null; batchId: string | null }) {
    return prisma.product.findMany({
      where: {
        organizationId: recall.organizationId,
        status: { not: "QUARANTINED" },
        ...(recall.productId ? { id: recall.productId } : { batchId: recall.batchId }),
      },
      include: { identity: true },
    });
  }

  async transition(a: Actor, recallId: string, input: unknown) {
    const { status } = z.object({ status: z.enum(["INITIATED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) }).parse(input);
    const recall = await prisma.recall.findFirst({ where: { id: recallId, organizationId: a.organizationId } });
    if (!recall) throw notFound("Recall");
    if (!TRANSITIONS[recall.status]?.includes(status)) {
      throw new AppError("INVALID_RECALL_TRANSITION", `A ${recall.status} recall cannot move to ${status}.`, 409);
    }
    const updated = await prisma.recall.update({
      where: { id: recall.id },
      data: {
        status,
        ...(status === "INITIATED" ? { initiatedAt: new Date(), initiatedById: a.userId } : {}),
        ...(["COMPLETED", "CANCELLED"].includes(status) ? { resolvedAt: new Date() } : {}),
      },
    });

    if (status === "INITIATED") await this.applyRecall(a, updated);
    if (status === "CANCELLED" && recall.status !== "DRAFT") await this.revertRecall(a, updated);
    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: status === "INITIATED" ? "RECALL_INITIATED" : `RECALL_${status}`,
      resourceType: "Recall",
      resourceId: recall.id,
      metadata: { from: recall.status, to: status },
      ipHash: a.ipHash,
    });
    return updated;
  }

  private async applyRecall(a: Actor, recall: { id: string; organizationId: string; productId: string | null; batchId: string | null; reason: string; incidentId: string | null }) {
    for (const product of await this.affectedProducts(recall)) {
      if (product.status !== "RECALLED") {
        await eventService.append({
          organizationId: a.organizationId,
          actorUserId: a.userId,
          productId: product.id,
          eventType: "RECALL_INITIATED",
          metadata: { recallId: recall.id, previousStatus: product.status, newStatus: "RECALLED", reason: recall.reason },
          anchor: true,
          ipHash: a.ipHash,
        });
        await prisma.product.update({ where: { id: product.id }, data: { status: "RECALLED", authenticityStatus: "RECALLED" } });
        await prisma.productIdentity.update({ where: { productId: product.id }, data: { status: "RECALLED" } });
        if (product.identity?.isCanonical) await blockchainService.anchorIdentityStatus(product.id, product.identity.identityHash, "RECALLED");
        await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "PRODUCT_RECALLED", resourceType: "Product", resourceId: product.id, metadata: { recallId: recall.id }, ipHash: a.ipHash });
      }
      await trustScoreService.calculate(product.id);
    }
    if (recall.incidentId) await prisma.incident.update({ where: { id: recall.incidentId }, data: { status: "RECALLED" } });
    // Inventory layer: quarantine every recorded unit of the affected batch at every holder.
    await inventoryService.allocateRecall({ userId: a.userId, organizationId: a.organizationId, ipHash: a.ipHash }, recall);
  }

  /** Cancelling an issued recall (e.g. issued in error) restores products not covered by another active recall. */
  private async revertRecall(a: Actor, recall: { id: string; organizationId: string; productId: string | null; batchId: string | null }) {
    // Inventory layer: lift the batch hold; quarantined stock is released by holders after inspection.
    await inventoryService.liftRecallHold(recall);
    for (const product of await this.affectedProducts(recall)) {
      const otherActive = await prisma.recall.findFirst({
        where: {
          id: { not: recall.id },
          status: { in: ACTIVE_RECALL_STATUS },
          OR: [{ productId: product.id }, ...(product.batchId ? [{ batchId: product.batchId }] : [])],
        },
      });
      if (otherActive || product.status !== "RECALLED") continue;
      const recallEvent = await prisma.productEvent.findFirst({
        where: { productId: product.id, eventType: "RECALL_INITIATED" },
        orderBy: { sequence: "desc" },
      });
      const previousStatus = json<{ previousStatus?: string }>(recallEvent?.metadataJson).previousStatus ?? "ACTIVE";
      await eventService.append({
        organizationId: a.organizationId,
        actorUserId: a.userId,
        productId: product.id,
        eventType: "STATUS_CHANGED",
        metadata: { recallId: recall.id, previousStatus: "RECALLED", newStatus: previousStatus, reason: "RECALL_CANCELLED" },
        anchor: true,
        ipHash: a.ipHash,
      });
      await prisma.product.update({ where: { id: product.id }, data: { status: previousStatus, authenticityStatus: "AUTHENTIC" } });
      await prisma.productIdentity.update({ where: { productId: product.id }, data: { status: "ACTIVE" } });
      if (product.identity?.isCanonical) await blockchainService.anchorIdentityStatus(product.id, product.identity.identityHash, "ACTIVE");
      await trustScoreService.calculate(product.id);
    }
  }

  async list(organizationId: string, q: Query) {
    return prisma.recall.findMany({
      where: { organizationId, ...(str(q, "status") ? { status: str(q, "status") } : {}) },
      orderBy: { createdAt: "desc" },
      include: { product: { select: { id: true, productCode: true, productName: true } }, batch: { select: { id: true, batchCode: true } } },
    });
  }

  async get(organizationId: string, id: string) {
    const recall = await prisma.recall.findFirst({
      where: { id, organizationId },
      include: { product: { select: { id: true, productCode: true, productName: true, status: true } }, batch: true, incident: true },
    });
    if (!recall) throw notFound("Recall");
    return recall;
  }
}

export const recallService = new RecallService();

export function assertBrandOwner(product: { organizationId: string }, organizationId: string) {
  if (product.organizationId !== organizationId) throw forbidden("Only the brand owner can do this.", "NOT_BRAND_OWNER");
}
