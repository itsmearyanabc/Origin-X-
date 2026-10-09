import { z } from "zod";
import { HANDOFF_EVENT_TYPES } from "../lib/constants.js";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { str, type Query } from "../lib/pagination.js";
import type { Actor } from "../middleware/tenant.js";
import { writeAudit } from "./audit.service.js";
import { eventService } from "./event.service.js";
import { organizationService } from "./organization.service.js";
import { getReadableProduct, orgSummarySelect } from "./product-access.js";
import { trustScoreService } from "./trust.service.js";

const NON_TRANSFERABLE = ["QUARANTINED", "RECALLED", "ARCHIVED", "SUSPENDED", "DELIVERED"];

/**
 * Two-party custody transfer:
 *   current custodian requests  -> TRANSFER_REQUESTED
 *   receiver accepts            -> TRANSFER_ACCEPTED + hash-chained handoff event (CUSTODY_TRANSFERRED
 *                                  or a receipt type such as WAREHOUSE_RECEIVED), ownership moves
 *   receiver rejects            -> TRANSFER_REJECTED
 *   sender cancels              -> TRANSFER_CANCELLED
 * Nobody can assign custody to another organization without that organization accepting it, and
 * transfers are only possible between organizations with an ACCEPTED supply-chain relationship.
 */
export class CustodyService {
  private async auditBoth(a: Actor, transfer: { id: string; fromOrganizationId: string; toOrganizationId: string; productId: string }, action: string, metadata: Record<string, unknown> = {}) {
    for (const organizationId of [transfer.fromOrganizationId, transfer.toOrganizationId]) {
      await writeAudit({
        organizationId,
        actorUserId: a.userId,
        action,
        resourceType: "CustodyTransfer",
        resourceId: transfer.id,
        metadata: { productId: transfer.productId, ...metadata },
        ipHash: a.ipHash,
      });
    }
  }

  async request(a: Actor, input: unknown) {
    const data = z
      .object({ productId: z.string().min(1), toOrganizationId: z.string().min(1), note: z.string().trim().max(1_000).optional() })
      .parse(input);
    const product = await getReadableProduct(a.organizationId, data.productId);
    if (product.currentOwnerOrganizationId !== a.organizationId) {
      throw forbidden("Only the current custodian can initiate a custody transfer.", "NOT_CURRENT_CUSTODIAN");
    }
    if (NON_TRANSFERABLE.includes(product.status)) {
      throw new AppError("PRODUCT_NOT_TRANSFERABLE", `A ${product.status.toLowerCase()} product cannot change custody.`, 409);
    }
    if (data.toOrganizationId === a.organizationId) {
      throw new AppError("INVALID_TRANSFER", "Custody is already held by your organization.", 422);
    }
    const target = await prisma.organization.findUnique({ where: { id: data.toOrganizationId } });
    if (!target || target.status !== "ACTIVE") throw notFound("Organization");
    if (!(await organizationService.arePartners(a.organizationId, target.id))) {
      throw forbidden("Custody can only be transferred to an accepted supply-chain partner.", "NOT_A_PARTNER");
    }
    const pending = await prisma.custodyTransfer.findFirst({ where: { productId: product.id, status: "TRANSFER_REQUESTED" } });
    if (pending) throw new AppError("TRANSFER_PENDING", "This product already has a pending custody transfer.", 409);

    const transfer = await prisma.custodyTransfer.create({
      data: {
        productId: product.id,
        fromOrganizationId: a.organizationId,
        toOrganizationId: target.id,
        status: "TRANSFER_REQUESTED",
        requestedByUserId: a.userId,
        note: data.note,
      },
    });
    await this.auditBoth(a, transfer, "CUSTODY_TRANSFER_REQUESTED");
    return transfer;
  }

  async accept(a: Actor, transferId: string, input: unknown, opts: { occurredAt?: Date } = {}) {
    const data = z
      .object({ receiptEventType: z.enum(HANDOFF_EVENT_TYPES).optional(), location: z.string().trim().max(200).optional() })
      .parse(input ?? {});
    const transfer = await prisma.custodyTransfer.findFirst({ where: { id: transferId, toOrganizationId: a.organizationId } });
    if (!transfer) throw notFound("CustodyTransfer", "TRANSFER_NOT_FOUND");
    if (transfer.status !== "TRANSFER_REQUESTED") throw new AppError("TRANSFER_NOT_PENDING", "This transfer is no longer pending.", 409);
    if (!(await organizationService.arePartners(transfer.fromOrganizationId, transfer.toOrganizationId))) {
      throw forbidden("The supply-chain relationship is no longer active.", "NOT_A_PARTNER");
    }
    const eventType = data.receiptEventType ?? "CUSTODY_TRANSFERRED";

    const stale = new AppError("STALE_TRANSFER", "The sender no longer holds custody of this product; the transfer was cancelled.", 409);
    const { event } = await eventService.inTransaction(async (tx) => {
      const product = await tx.product.findUniqueOrThrow({ where: { id: transfer.productId } });
      if (product.currentOwnerOrganizationId !== transfer.fromOrganizationId || NON_TRANSFERABLE.includes(product.status)) {
        throw stale;
      }
      const inserted = await eventService.insert(tx, {
        organizationId: a.organizationId,
        actorUserId: a.userId,
        productId: transfer.productId,
        eventType,
        location: data.location ?? null,
        occurredAt: opts.occurredAt,
        metadata: {
          custodyTransferId: transfer.id,
          fromOrganizationId: transfer.fromOrganizationId,
          toOrganizationId: transfer.toOrganizationId,
          requestedByUserId: transfer.requestedByUserId,
          acceptedByUserId: a.userId,
        },
      });
      await tx.custodyTransfer.update({
        where: { id: transfer.id },
        data: { status: "TRANSFER_ACCEPTED", respondedAt: new Date(), respondedByUserId: a.userId, receiptEventType: eventType, custodyEventId: inserted.id },
      });
      await tx.product.update({
        where: { id: transfer.productId },
        data: { currentOwnerOrganizationId: a.organizationId, ...(data.location ? { currentLocation: data.location } : {}) },
      });
      return { event: inserted };
    }).catch(async (error) => {
      if (error === stale) {
        await prisma.custodyTransfer.update({ where: { id: transfer.id }, data: { status: "TRANSFER_CANCELLED", respondedAt: new Date() } });
      }
      throw error;
    });
    await eventService.afterCommit(event, { ipHash: a.ipHash });
    await this.auditBoth(a, transfer, "CUSTODY_TRANSFER_ACCEPTED", { eventId: event.id, eventType });
    await trustScoreService.calculate(transfer.productId);
    return prisma.custodyTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
  }

  async reject(a: Actor, transferId: string, input: unknown) {
    const { reason } = z.object({ reason: z.string().trim().max(1_000).optional() }).parse(input ?? {});
    const transfer = await prisma.custodyTransfer.findFirst({ where: { id: transferId, toOrganizationId: a.organizationId } });
    if (!transfer) throw notFound("CustodyTransfer", "TRANSFER_NOT_FOUND");
    if (transfer.status !== "TRANSFER_REQUESTED") throw new AppError("TRANSFER_NOT_PENDING", "This transfer is no longer pending.", 409);
    const updated = await prisma.custodyTransfer.update({
      where: { id: transfer.id },
      data: { status: "TRANSFER_REJECTED", respondedAt: new Date(), respondedByUserId: a.userId, note: reason ?? transfer.note },
    });
    await this.auditBoth(a, transfer, "CUSTODY_TRANSFER_REJECTED", { reason });
    return updated;
  }

  async cancel(a: Actor, transferId: string) {
    const transfer = await prisma.custodyTransfer.findFirst({ where: { id: transferId, fromOrganizationId: a.organizationId } });
    if (!transfer) throw notFound("CustodyTransfer", "TRANSFER_NOT_FOUND");
    if (transfer.status !== "TRANSFER_REQUESTED") throw new AppError("TRANSFER_NOT_PENDING", "This transfer is no longer pending.", 409);
    const updated = await prisma.custodyTransfer.update({ where: { id: transfer.id }, data: { status: "TRANSFER_CANCELLED", respondedAt: new Date() } });
    await this.auditBoth(a, transfer, "CUSTODY_TRANSFER_CANCELLED");
    return updated;
  }

  async list(organizationId: string, q: Query) {
    const direction = str(q, "direction");
    const status = str(q, "status");
    const productId = str(q, "productId");
    const sides =
      direction === "incoming"
        ? [{ toOrganizationId: organizationId }]
        : direction === "outgoing"
          ? [{ fromOrganizationId: organizationId }]
          : [{ toOrganizationId: organizationId }, { fromOrganizationId: organizationId }];
    return prisma.custodyTransfer.findMany({
      where: { OR: sides, ...(status ? { status } : {}), ...(productId ? { productId } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: { id: true, productCode: true, productName: true, status: true } },
        fromOrg: { select: orgSummarySelect },
        toOrg: { select: orgSummarySelect },
      },
    });
  }
}

export const custodyService = new CustodyService();
