/**
 * Shipments between ORIGINX organizations.
 *
 * DRAFT → RESERVED → (READY_TO_DISPATCH) → DISPATCHED → PARTIALLY_RECEIVED → RECEIVED
 *        ↘ CANCELLED (before dispatch)          ↘ REJECTED → RETURNED (stock booked back by the sender)
 *
 * Dispatch and receipt each run in ONE database transaction holding a row lock on the shipment:
 * ledger entries, item quantities, status, provenance events, custody-transfer requests and audit
 * are committed together or not at all. Blockchain anchoring happens after commit.
 *
 * Custody: shipping stock is NOT a custody acceptance. With `transferCustody`, dispatch opens
 * custody-transfer *requests* (existing state machine) for batch passports the sender holds; they
 * are only accepted through the existing acceptance rules.
 */
import type { ProductEvent, ShipmentItem } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { prisma, type Db } from "../../lib/prisma.js";
import { paginate, str, type Query } from "../../lib/pagination.js";
import { hasPermission, type Actor } from "../../middleware/tenant.js";
import { writeAudit } from "../audit.service.js";
import { custodyService } from "../custody.service.js";
import { organizationService } from "../organization.service.js";
import { assertBatchDispatchable, getOwnedLocation, resolveSkuBatch } from "./access.js";
import { inventoryService } from "./inventory.service.js";
import { D, ensureBalance, parseQuantity, parseQuantityOrZero, postTransaction, runIdempotent, ZERO, type Dec, type Delta } from "./ledger.js";
import { anchorAfterCommit, publicPlace, recordInventoryEvent } from "./provenance.js";

const qty = z.union([z.number(), z.string()]);
const itemSchema = z.object({ skuId: z.string().min(1), batchId: z.string().min(1).optional().nullable(), fromLocationId: z.string().min(1), quantity: qty });
const createSchema = z.object({
  receiverOrganizationId: z.string().min(1),
  originWarehouseId: z.string().min(1),
  items: z.array(itemSchema).min(1).max(200),
  notes: z.string().trim().max(2000).optional(),
  transferCustody: z.boolean().optional(),
  purpose: z.enum(["STANDARD", "RECALL_RETURN"]).optional(),
  recallId: z.string().optional(),
});
const receiveSchema = z.object({
  locationId: z.string().min(1),
  items: z.array(z.object({ itemId: z.string().min(1), receivedQty: qty.optional(), damagedQty: qty.optional(), missingQty: qty.optional() })).min(1),
  notes: z.string().trim().max(2000).optional(),
  acceptCustody: z.boolean().optional(),
});

const outstanding = (i: ShipmentItem) => new D(i.dispatchedQty).minus(i.receivedQty).minus(i.damagedQty).minus(i.missingQty);
const reference = () => `SHP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;

function present<T extends { items?: ShipmentItem[] }>(s: T) {
  return {
    ...s,
    items: s.items?.map((i) => ({
      ...i,
      requestedQty: i.requestedQty.toString(),
      dispatchedQty: i.dispatchedQty.toString(),
      receivedQty: i.receivedQty.toString(),
      damagedQty: i.damagedQty.toString(),
      missingQty: i.missingQty.toString(),
      outstandingQty: outstanding(i).toString(),
    })),
  };
}

function need(a: Actor, permission: "shipments:manage" | "shipments:receive") {
  if (!hasPermission(a.role, permission)) throw forbidden(`Your role (${a.role}) does not allow ${permission}.`);
}

/** Locks the shipment row for the rest of the transaction (prevents double dispatch / receipt). */
async function lockShipment(tx: Db, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${id} FOR UPDATE`;
  return tx.shipment.findUniqueOrThrow({ where: { id }, include: { items: true } });
}

export class ShipmentService {
  async list(organizationId: string, q: Query) {
    const direction = str(q, "direction");
    const where = {
      ...(direction === "incoming" ? { receiverOrganizationId: organizationId } : direction === "outgoing" ? { senderOrganizationId: organizationId } : { OR: [{ senderOrganizationId: organizationId }, { receiverOrganizationId: organizationId }] }),
      ...(str(q, "status") ? { status: { in: str(q, "status")!.split(",") } } : {}),
    };
    const result = await paginate(q, () => prisma.shipment.count({ where }), (page) => prisma.shipment.findMany({ where, ...page, orderBy: { createdAt: "desc" }, include: { items: true } }));
    const orgIds = [...new Set(result.items.flatMap((s) => [s.senderOrganizationId, s.receiverOrganizationId]))];
    const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, verificationStatus: true } });
    return {
      ...result,
      items: result.items.map((s) => ({ ...present(s), sender: orgs.find((o) => o.id === s.senderOrganizationId), receiver: orgs.find((o) => o.id === s.receiverOrganizationId), direction: s.senderOrganizationId === organizationId ? "outgoing" : "incoming" })),
    };
  }

  async get(organizationId: string, id: string) {
    const s = await prisma.shipment.findFirst({
      where: { id, OR: [{ senderOrganizationId: organizationId }, { receiverOrganizationId: organizationId }] },
      include: { items: { include: { batch: { select: { id: true, batchCode: true, holdStatus: true, qualityStatus: true, expiryDate: true, passportProductId: true } } } }, custodyTransfers: { select: { id: true, productId: true, status: true, fromOrganizationId: true, toOrganizationId: true } } },
    });
    if (!s) throw notFound("Shipment");
    const isSender = s.senderOrganizationId === organizationId;
    const [skus, orgs, origin, destination, transactions] = await Promise.all([
      prisma.productSku.findMany({ where: { id: { in: s.items.map((i) => i.skuId) } }, select: { id: true, sku: true, name: true, unitOfMeasure: true } }),
      prisma.organization.findMany({ where: { id: { in: [s.senderOrganizationId, s.receiverOrganizationId] } }, select: { id: true, name: true, verificationStatus: true } }),
      // Each side only sees its own warehouse details.
      isSender ? prisma.warehouse.findUnique({ where: { id: s.originWarehouseId }, select: { id: true, code: true, name: true, city: true } }) : prisma.warehouse.findUnique({ where: { id: s.originWarehouseId }, select: { city: true, country: true } }),
      s.destinationWarehouseId ? (isSender ? prisma.warehouse.findUnique({ where: { id: s.destinationWarehouseId }, select: { city: true, country: true } }) : prisma.warehouse.findUnique({ where: { id: s.destinationWarehouseId }, select: { id: true, code: true, name: true, city: true } })) : null,
      prisma.inventoryTransaction.findMany({ where: { shipmentId: s.id, organizationId }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, quantity: true, createdAt: true, shipmentItemId: true, productEventId: true } }),
    ]);
    const locations = isSender ? await prisma.storageLocation.findMany({ where: { id: { in: s.items.map((i) => i.fromLocationId) } }, select: { id: true, code: true } }) : [];
    return {
      ...present(s),
      direction: isSender ? "outgoing" : "incoming",
      sender: orgs.find((o) => o.id === s.senderOrganizationId),
      receiver: orgs.find((o) => o.id === s.receiverOrganizationId),
      originWarehouse: origin,
      destinationWarehouse: destination,
      items: present(s).items!.map((i) => ({ ...i, sku: skus.find((k) => k.id === i.skuId), fromLocation: isSender ? locations.find((l) => l.id === i.fromLocationId) ?? null : null, fromLocationId: isSender ? i.fromLocationId : null })),
      transactions: transactions.map((t) => ({ ...t, quantity: t.quantity.toString() })),
    };
  }

  async create(a: Actor, input: unknown) {
    need(a, "shipments:manage");
    const data = createSchema.parse(input);
    const purpose = data.purpose ?? "STANDARD";
    if (data.receiverOrganizationId === a.organizationId) throw new AppError("INVALID_RECEIVER", "Use an internal transfer to move stock between your own locations.", 422);
    const receiver = await prisma.organization.findUnique({ where: { id: data.receiverOrganizationId } });
    if (!receiver || receiver.status !== "ACTIVE") throw notFound("Organization");
    const warehouse = await prisma.warehouse.findFirst({ where: { id: data.originWarehouseId, organizationId: a.organizationId, status: "ACTIVE" } });
    if (!warehouse) throw notFound("Warehouse");

    const items = [];
    for (const raw of data.items) {
      const { sku, batch } = await resolveSkuBatch(a.organizationId, raw.skuId, raw.batchId);
      const location = await getOwnedLocation(a.organizationId, raw.fromLocationId);
      if (location.warehouseId !== warehouse.id) throw new AppError("LOCATION_NOT_IN_WAREHOUSE", "Every item must ship from a location in the origin warehouse.", 422);
      if (purpose === "STANDARD") assertBatchDispatchable(batch);
      if (purpose === "RECALL_RETURN") {
        if (!batch || batch.holdStatus !== "RECALLED") throw new AppError("NOT_RECALLED", "Recall returns can only contain recalled batches.", 422);
        if (sku.organizationId !== receiver.id) throw new AppError("INVALID_RECEIVER", "Recalled stock is returned to the SKU owner.", 422);
      }
      items.push({ skuId: sku.id, batchId: batch?.id ?? null, fromLocationId: location.id, unitOfMeasure: sku.unitOfMeasure, requestedQty: parseQuantity(raw.quantity, sku.unitOfMeasure) });
    }
    if (purpose === "STANDARD" && !(await organizationService.arePartners(a.organizationId, receiver.id))) {
      throw forbidden("Shipments can only be sent to an accepted supply-chain partner.", "NOT_A_PARTNER");
    }
    if (data.recallId && !(await prisma.recall.findFirst({ where: { id: data.recallId, status: { in: ["INITIATED", "IN_PROGRESS"] } } }))) throw notFound("Recall");

    const shipment = await prisma.shipment.create({
      data: {
        reference: reference(),
        senderOrganizationId: a.organizationId,
        receiverOrganizationId: receiver.id,
        originWarehouseId: warehouse.id,
        purpose,
        recallId: data.recallId ?? null,
        transferCustody: Boolean(data.transferCustody) && purpose === "STANDARD",
        notes: data.notes,
        createdById: a.userId,
        items: { create: items },
      },
      include: { items: true },
    });
    for (const orgId of [a.organizationId, receiver.id]) {
      await writeAudit({ organizationId: orgId, actorUserId: a.userId, action: "SHIPMENT_CREATED", resourceType: "Shipment", resourceId: shipment.id, metadata: { reference: shipment.reference, items: items.length, purpose }, ipHash: a.ipHash });
    }
    return present(shipment);
  }

  /** Reserves stock for every item (validates availability atomically). */
  async reserve(a: Actor, id: string, idempotencyKey?: string) {
    need(a, "shipments:manage");
    return runIdempotent(a.organizationId, idempotencyKey, `shipment-reserve:${id}`, async (tx) => {
      const s = await lockShipment(tx, id);
      if (s.senderOrganizationId !== a.organizationId) throw notFound("Shipment");
      if (s.status !== "DRAFT") throw new AppError("INVALID_SHIPMENT_STATE", `A ${s.status.toLowerCase()} shipment cannot be reserved.`, 409);
      if (s.purpose !== "STANDARD") throw new AppError("NO_RESERVATION", "Recall returns ship quarantined stock and are not reserved.", 409);
      await this.reserveItems(tx, a, s.items);
      const updated = await tx.shipment.update({ where: { id }, data: { status: "RESERVED" }, include: { items: true } });
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "SHIPMENT_RESERVED", resourceType: "Shipment", resourceId: id, ipHash: a.ipHash }, tx);
      return { response: present(updated) };
    });
  }

  private async reserveItems(tx: Db, a: Actor, items: ShipmentItem[]) {
    for (const item of items) {
      const batch = item.batchId ? await tx.productBatch.findUnique({ where: { id: item.batchId } }) : null;
      assertBatchDispatchable(batch);
      await inventoryService.reserve(tx, a, { ...item, requestedQty: new D(item.requestedQty) });
    }
  }

  async markReady(a: Actor, id: string) {
    need(a, "shipments:manage");
    const s = await prisma.shipment.findFirst({ where: { id, senderOrganizationId: a.organizationId } });
    if (!s) throw notFound("Shipment");
    if (s.status !== "RESERVED") throw new AppError("INVALID_SHIPMENT_STATE", "Only reserved shipments can be marked ready.", 409);
    const updated = await prisma.shipment.update({ where: { id }, data: { status: "READY_TO_DISPATCH" }, include: { items: true } });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "SHIPMENT_READY", resourceType: "Shipment", resourceId: id, ipHash: a.ipHash });
    return present(updated);
  }

  async cancel(a: Actor, id: string, input: unknown) {
    need(a, "shipments:manage");
    const { reason } = z.object({ reason: z.string().trim().min(3).max(1000) }).parse(input ?? {});
    return runIdempotent(a.organizationId, null, `shipment-cancel:${id}`, async (tx) => {
      const s = await lockShipment(tx, id);
      if (s.senderOrganizationId !== a.organizationId) throw notFound("Shipment");
      if (!["DRAFT", "RESERVED", "READY_TO_DISPATCH"].includes(s.status)) throw new AppError("INVALID_SHIPMENT_STATE", "Dispatched shipments cannot be cancelled; the receiver can reject them.", 409);
      const reservations = await tx.inventoryReservation.findMany({ where: { shipmentId: id, status: "ACTIVE" } });
      for (const r of reservations) await inventoryService.releaseReservation(tx, r.id, a.userId, `Shipment cancelled: ${reason}`);
      const updated = await tx.shipment.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), notes: reason }, include: { items: true } });
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "SHIPMENT_CANCELLED", resourceType: "Shipment", resourceId: id, metadata: { reason, releasedReservations: reservations.length }, ipHash: a.ipHash }, tx);
      return { response: present(updated) };
    });
  }

  async dispatch(a: Actor, id: string, idempotencyKey?: string) {
    need(a, "shipments:manage");
    return runIdempotent(a.organizationId, idempotencyKey, `shipment-dispatch:${id}`, async (tx) => {
      const s = await lockShipment(tx, id);
      if (s.senderOrganizationId !== a.organizationId) throw notFound("Shipment");
      if (!["DRAFT", "RESERVED", "READY_TO_DISPATCH"].includes(s.status)) {
        throw new AppError("INVALID_SHIPMENT_STATE", s.status === "DISPATCHED" ? "This shipment was already dispatched." : `A ${s.status.toLowerCase()} shipment cannot be dispatched.`, 409);
      }
      const recall = s.purpose === "RECALL_RETURN";
      if (!recall && s.status === "DRAFT") await this.reserveItems(tx, a, s.items);
      const warehouse = await tx.warehouse.findUniqueOrThrow({ where: { id: s.originWarehouseId } });

      for (const item of s.items) {
        const batch = item.batchId ? await tx.productBatch.findUnique({ where: { id: item.batchId } }) : null;
        const quantity = new D(item.requestedQty);
        const balance = await tx.inventoryBalance.findUnique({ where: { organizationId_locationId_skuId_batchKey: { organizationId: a.organizationId, locationId: item.fromLocationId, skuId: item.skuId, batchKey: item.batchId ?? "" } } });
        if (!balance) throw new AppError("INSUFFICIENT_STOCK", "There is no stock of this item at its source location.", 409);
        let deltas: Delta[];
        let reservationId: string | null = null;
        if (recall) {
          deltas = [{ balanceId: balance.id, bucket: "QUARANTINED", delta: quantity.neg() }];
        } else {
          assertBatchDispatchable(batch);
          const reservation = await tx.inventoryReservation.findUnique({ where: { shipmentItemId: item.id } });
          if (!reservation || reservation.status !== "ACTIVE") throw new AppError("RESERVATION_MISSING", "Stock for this shipment is no longer reserved. Reserve it again before dispatch.", 409);
          reservationId = reservation.id;
          deltas = [
            { balanceId: balance.id, bucket: "RESERVED", delta: quantity.neg() },
            { balanceId: balance.id, bucket: "ON_HAND", delta: quantity.neg() },
          ];
          await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: "CONSUMED", consumedAt: new Date() } });
        }
        await postTransaction(
          tx,
          { organizationId: a.organizationId, type: recall ? "RECALL_RETURN" : "DISPATCH", skuId: item.skuId, batchId: item.batchId, unitOfMeasure: item.unitOfMeasure, quantity, fromWarehouseId: warehouse.id, fromLocationId: item.fromLocationId, shipmentId: s.id, shipmentItemId: item.id, reservationId, recallId: s.recallId, actorUserId: a.userId },
          deltas,
        );
        await tx.shipmentItem.update({ where: { id: item.id }, data: { dispatchedQty: quantity } });
      }

      // Provenance: one DISPATCHED event per batch passport.
      const events: ProductEvent[] = [];
      for (const [batchId, total] of this.totalsByBatch(s.items, (i) => new D(i.requestedQty))) {
        const batch = await tx.productBatch.findUniqueOrThrow({ where: { id: batchId } });
        const event = await recordInventoryEvent(tx, {
          batch,
          organizationId: a.organizationId,
          actorUserId: a.userId,
          eventType: "DISPATCHED",
          publicLocation: publicPlace(warehouse),
          metadata: { inventoryShipmentId: s.id, shipmentReference: s.reference, shipmentRole: "DISPATCH", purpose: s.purpose, quantity: total.quantity.toString(), unitOfMeasure: total.unit, toOrganizationId: s.receiverOrganizationId },
        });
        if (event) events.push(event);
      }

      // Custody: open transfer REQUESTS for batch passports the sender currently holds.
      const custodyRequests: string[] = [];
      if (s.transferCustody) {
        const passports = await tx.product.findMany({ where: { batchPassportOf: { id: { in: s.items.map((i) => i.batchId).filter(Boolean) as string[] } }, currentOwnerOrganizationId: a.organizationId, status: { notIn: ["QUARANTINED", "RECALLED", "ARCHIVED", "SUSPENDED", "DELIVERED"] } } });
        for (const p of passports) {
          const pending = await tx.custodyTransfer.findFirst({ where: { productId: p.id, status: "TRANSFER_REQUESTED" } });
          if (pending) continue;
          const transfer = await tx.custodyTransfer.create({ data: { productId: p.id, fromOrganizationId: a.organizationId, toOrganizationId: s.receiverOrganizationId, status: "TRANSFER_REQUESTED", requestedByUserId: a.userId, shipmentId: s.id, note: `Opened by shipment ${s.reference}` } });
          custodyRequests.push(transfer.id);
        }
      }

      const updated = await tx.shipment.update({ where: { id: s.id }, data: { status: "DISPATCHED", dispatchedAt: new Date(), dispatchedById: a.userId }, include: { items: true } });
      for (const orgId of [s.senderOrganizationId, s.receiverOrganizationId]) {
        await writeAudit({ organizationId: orgId, actorUserId: a.userId, action: "SHIPMENT_DISPATCHED", resourceType: "Shipment", resourceId: s.id, metadata: { reference: s.reference, items: s.items.length, provenanceEvents: events.map((e) => e.id), custodyRequests }, ipHash: a.ipHash }, tx);
      }
      return { response: { ...present(updated), provenanceEvents: events.length, custodyRequests }, afterCommit: () => anchorAfterCommit(events, a.ipHash) };
    });
  }

  async receive(a: Actor, id: string, input: unknown, idempotencyKey?: string) {
    need(a, "shipments:receive");
    const data = receiveSchema.parse(input);
    let custodyToAccept: string[] = [];
    const result = await runIdempotent(a.organizationId, idempotencyKey, `shipment-receive:${id}`, async (tx) => {
      const s = await lockShipment(tx, id);
      if (s.receiverOrganizationId !== a.organizationId) throw notFound("Shipment");
      if (!["DISPATCHED", "PARTIALLY_RECEIVED"].includes(s.status)) throw new AppError("INVALID_SHIPMENT_STATE", `A ${s.status.toLowerCase().replace(/_/g, " ")} shipment cannot be received.`, 409);
      const location = await getOwnedLocation(a.organizationId, data.locationId, tx);
      const recall = s.purpose === "RECALL_RETURN";
      const seen = new Set<string>();
      const lines: Array<{ item: ShipmentItem; received: Dec; damaged: Dec; missing: Dec }> = [];
      for (const line of data.items) {
        if (seen.has(line.itemId)) throw new AppError("DUPLICATE_LINE", "Each shipment item can appear once per receipt.", 422);
        seen.add(line.itemId);
        const item = s.items.find((i) => i.id === line.itemId);
        if (!item) throw new AppError("ITEM_NOT_IN_SHIPMENT", "An item does not belong to this shipment.", 422);
        const received = parseQuantityOrZero(line.receivedQty, item.unitOfMeasure, "receivedQty");
        const damaged = parseQuantityOrZero(line.damagedQty, item.unitOfMeasure, "damagedQty");
        const missing = parseQuantityOrZero(line.missingQty, item.unitOfMeasure, "missingQty");
        const total = received.plus(damaged).plus(missing);
        if (total.isZero()) continue;
        if (total.gt(outstanding(item))) {
          throw new AppError("RECEIPT_EXCEEDS_OUTSTANDING", `Only ${outstanding(item)} ${item.unitOfMeasure} remain outstanding for an item; ${total} was entered.`, 409, { itemId: item.id, outstanding: outstanding(item).toString() });
        }
        lines.push({ item, received, damaged, missing });
      }
      if (!lines.length) throw new AppError("EMPTY_RECEIPT", "Enter at least one received, damaged or missing quantity.", 422);

      const events: ProductEvent[] = [];
      const perBatch = new Map<string, { received: Dec; damaged: Dec; missing: Dec; unit: string }>();
      for (const { item, received, damaged, missing } of lines) {
        const batch = item.batchId ? await tx.productBatch.findUnique({ where: { id: item.batchId } }) : null;
        const balance = await ensureBalance(tx, { organizationId: a.organizationId, locationId: location.id, skuId: item.skuId, batchId: item.batchId, unitOfMeasure: item.unitOfMeasure });
        const held = recall || Boolean(batch && batch.holdStatus !== "NONE");
        const deltas: Delta[] = [];
        if (received.gt(0)) deltas.push({ balanceId: balance.id, bucket: held ? "QUARANTINED" : "ON_HAND", delta: received });
        if (damaged.gt(0)) deltas.push({ balanceId: balance.id, bucket: "DAMAGED", delta: damaged });
        const common = { organizationId: a.organizationId, skuId: item.skuId, batchId: item.batchId, unitOfMeasure: item.unitOfMeasure, shipmentId: s.id, shipmentItemId: item.id, recallId: s.recallId, actorUserId: a.userId };
        if (deltas.length) {
          await postTransaction(tx, { ...common, type: recall ? "RECALL_RETURN" : "RECEIPT", quantity: received.plus(damaged), toWarehouseId: location.warehouseId, toLocationId: location.id, reason: damaged.gt(0) ? `${damaged} received damaged` : null }, deltas);
        }
        if (missing.gt(0)) {
          // Never arrived: recorded for traceability, no stock is created anywhere.
          await postTransaction(tx, { ...common, type: "LOSS", quantity: missing, reason: `Missing from shipment ${s.reference}` }, []);
        }
        await tx.shipmentItem.update({ where: { id: item.id }, data: { receivedQty: { increment: received }, damagedQty: { increment: damaged }, missingQty: { increment: missing } } });
        if (item.batchId) {
          const agg = perBatch.get(item.batchId) ?? { received: ZERO, damaged: ZERO, missing: ZERO, unit: item.unitOfMeasure };
          perBatch.set(item.batchId, { received: agg.received.plus(received), damaged: agg.damaged.plus(damaged), missing: agg.missing.plus(missing), unit: item.unitOfMeasure });
        }
        if (damaged.gt(0) || missing.gt(0)) {
          for (const orgId of [s.senderOrganizationId, s.receiverOrganizationId]) {
            await inventoryService.flag(tx, {
              organizationId: orgId,
              type: missing.gt(0) ? "SHIPMENT_SHORTAGE" : "SHIPMENT_DAMAGE",
              severity: "HIGH",
              message: `Shipment ${s.reference}: ${missing.gt(0) ? `${missing} ${item.unitOfMeasure} missing` : ""}${missing.gt(0) && damaged.gt(0) ? ", " : ""}${damaged.gt(0) ? `${damaged} ${item.unitOfMeasure} damaged` : ""} on receipt.`,
              details: { itemId: item.id, damaged: damaged.toString(), missing: missing.toString() },
              skuId: item.skuId,
              batchId: item.batchId,
              shipmentId: s.id,
              fingerprint: `receipt:${s.id}:${item.id}:${Date.now()}`,
            });
          }
        }
      }

      const warehouse = await tx.warehouse.findUniqueOrThrow({ where: { id: location.warehouseId } });
      for (const [batchId, agg] of perBatch) {
        const batch = await tx.productBatch.findUniqueOrThrow({ where: { id: batchId } });
        const event = await recordInventoryEvent(tx, {
          batch,
          organizationId: a.organizationId,
          actorUserId: a.userId,
          eventType: recall ? "RECALL_RETURN_RECEIVED" : "RECEIVED",
          publicLocation: publicPlace(warehouse),
          metadata: { inventoryShipmentId: s.id, shipmentReference: s.reference, shipmentRole: "RECEIPT", receivedQty: agg.received.toString(), damagedQty: agg.damaged.toString(), missingQty: agg.missing.toString(), unitOfMeasure: agg.unit, fromOrganizationId: s.senderOrganizationId },
        });
        if (event) events.push(event);
      }

      const items = await tx.shipmentItem.findMany({ where: { shipmentId: s.id } });
      const complete = items.every((i) => outstanding(i).isZero());
      const discrepancy = items.some((i) => new D(i.damagedQty).gt(0) || new D(i.missingQty).gt(0));
      const updated = await tx.shipment.update({
        where: { id: s.id },
        data: { status: complete ? "RECEIVED" : "PARTIALLY_RECEIVED", destinationWarehouseId: location.warehouseId, receivedAt: complete ? new Date() : null, receivedById: a.userId, hasDiscrepancy: discrepancy, ...(data.notes ? { notes: data.notes } : {}) },
        include: { items: true },
      });
      const pendingCustody = await tx.custodyTransfer.findMany({ where: { shipmentId: s.id, status: "TRANSFER_REQUESTED" } });
      custodyToAccept = complete && data.acceptCustody ? pendingCustody.map((t) => t.id) : [];
      for (const orgId of [s.senderOrganizationId, s.receiverOrganizationId]) {
        await writeAudit({ organizationId: orgId, actorUserId: a.userId, action: complete ? "SHIPMENT_RECEIVED" : "SHIPMENT_PARTIALLY_RECEIVED", resourceType: "Shipment", resourceId: s.id, metadata: { reference: s.reference, lines: lines.length, discrepancy }, ipHash: a.ipHash }, tx);
      }
      return {
        response: {
          ...present(updated),
          provenanceEvents: events.length,
          custody: {
            pendingTransfers: pendingCustody.length,
            acceptedNow: custodyToAccept.length,
            note: pendingCustody.length && !custodyToAccept.length ? (complete ? "Custody transfers stay pending until the receiver accepts them." : "Custody can only be accepted once the shipment is fully received.") : undefined,
          },
        },
        afterCommit: () => anchorAfterCommit(events, a.ipHash),
      };
    });
    // Custody acceptance goes through the existing custody workflow (its own checks and event).
    for (const transferId of custodyToAccept) {
      await custodyService.accept(a, transferId, { location: undefined });
    }
    return result;
  }

  /** Receiver refuses a dispatched shipment before receiving anything. */
  async reject(a: Actor, id: string, input: unknown) {
    need(a, "shipments:receive");
    const { reason } = z.object({ reason: z.string().trim().min(3).max(1000) }).parse(input ?? {});
    let transfers: string[] = [];
    const result = await runIdempotent(a.organizationId, null, `shipment-reject:${id}`, async (tx) => {
      const s = await lockShipment(tx, id);
      if (s.receiverOrganizationId !== a.organizationId) throw notFound("Shipment");
      if (s.status !== "DISPATCHED") throw new AppError("INVALID_SHIPMENT_STATE", "Only a dispatched shipment that has not been partly received can be rejected.", 409);
      const updated = await tx.shipment.update({ where: { id }, data: { status: "REJECTED", notes: reason }, include: { items: true } });
      transfers = (await tx.custodyTransfer.findMany({ where: { shipmentId: id, status: "TRANSFER_REQUESTED" } })).map((t) => t.id);
      for (const orgId of [s.senderOrganizationId, s.receiverOrganizationId]) {
        await writeAudit({ organizationId: orgId, actorUserId: a.userId, action: "SHIPMENT_REJECTED", resourceType: "Shipment", resourceId: id, metadata: { reason }, ipHash: a.ipHash }, tx);
      }
      return { response: present(updated) };
    });
    for (const t of transfers) await custodyService.reject(a, t, { reason: `Shipment rejected: ${reason}` });
    return result;
  }

  /** Sender books the stock of a rejected shipment back into a location. */
  async bookReturn(a: Actor, id: string, input: unknown, idempotencyKey?: string) {
    need(a, "shipments:manage");
    const { locationId } = z.object({ locationId: z.string().min(1) }).parse(input);
    return runIdempotent(a.organizationId, idempotencyKey, `shipment-return:${id}`, async (tx) => {
      const s = await lockShipment(tx, id);
      if (s.senderOrganizationId !== a.organizationId) throw notFound("Shipment");
      if (s.status !== "REJECTED") throw new AppError("INVALID_SHIPMENT_STATE", "Only rejected shipments can be booked back.", 409);
      const location = await getOwnedLocation(a.organizationId, locationId, tx);
      const events: ProductEvent[] = [];
      for (const item of s.items) {
        const qty = outstanding(item);
        if (qty.isZero()) continue;
        const batch = item.batchId ? await tx.productBatch.findUnique({ where: { id: item.batchId } }) : null;
        const balance = await ensureBalance(tx, { organizationId: a.organizationId, locationId: location.id, skuId: item.skuId, batchId: item.batchId, unitOfMeasure: item.unitOfMeasure });
        const held = s.purpose === "RECALL_RETURN" || Boolean(batch && batch.holdStatus !== "NONE");
        await postTransaction(tx, { organizationId: a.organizationId, type: "CUSTOMER_RETURN", skuId: item.skuId, batchId: item.batchId, unitOfMeasure: item.unitOfMeasure, quantity: qty, toWarehouseId: location.warehouseId, toLocationId: location.id, shipmentId: s.id, shipmentItemId: item.id, reason: `Returned: shipment ${s.reference} rejected`, actorUserId: a.userId }, [{ balanceId: balance.id, bucket: held ? "QUARANTINED" : "ON_HAND", delta: qty }]);
        // Booked back: the item is resolved (counted as received by its own sender).
        await tx.shipmentItem.update({ where: { id: item.id }, data: { receivedQty: { increment: qty } } });
        if (batch) {
          const event = await recordInventoryEvent(tx, { batch, organizationId: a.organizationId, actorUserId: a.userId, eventType: "RECEIVED", publicLocation: null, metadata: { inventoryShipmentId: s.id, shipmentReference: s.reference, shipmentRole: "RETURN", receivedQty: qty.toString(), unitOfMeasure: item.unitOfMeasure } });
          if (event) events.push(event);
        }
      }
      const updated = await tx.shipment.update({ where: { id }, data: { status: "RETURNED", destinationWarehouseId: location.warehouseId }, include: { items: true } });
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "SHIPMENT_RETURN_BOOKED", resourceType: "Shipment", resourceId: id, ipHash: a.ipHash }, tx);
      return { response: present(updated), afterCommit: () => anchorAfterCommit(events, a.ipHash) };
    });
  }

  private totalsByBatch(items: ShipmentItem[], amount: (i: ShipmentItem) => Dec) {
    const map = new Map<string, { quantity: Dec; unit: string }>();
    for (const i of items) {
      if (!i.batchId) continue;
      const prev = map.get(i.batchId);
      map.set(i.batchId, { quantity: (prev?.quantity ?? ZERO).plus(amount(i)), unit: i.unitOfMeasure });
    }
    return map;
  }
}

export const shipmentService = new ShipmentService();
