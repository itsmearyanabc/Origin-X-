import { Prisma, type InventoryBalance, type ProductBatch } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ACTIVE_RECALL_STATUS, BALANCE_BUCKETS, INVENTORY_TX_TYPES, type BalanceBucket, type InventoryTxType, type OrgPermission } from "../../lib/constants.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { json, prisma, type Db } from "../../lib/prisma.js";
import { paginate, str, type Query } from "../../lib/pagination.js";
import { hasPermission, type Actor } from "../../middleware/tenant.js";
import { writeAudit } from "../audit.service.js";
import { assertBatchDispatchable, assertOwner, getOwnedLocation, getReadableBatch, resolveSkuBatch } from "./access.js";
import { available, D, ensureBalance, parseQuantity, postTransaction, presentBalance, runIdempotent, ZERO, type Dec, type Delta } from "./ledger.js";
import { anchorAfterCommit, recordInventoryEvent } from "./provenance.js";

const qty = z.union([z.number(), z.string()]);

const movementSchema = z.object({
  type: z.enum(["OPENING_BALANCE", "RECEIPT", "CUSTOMER_RETURN", "SUPPLIER_RETURN", "DISPATCH", "DAMAGE", "LOSS", "STOCK_ADJUSTMENT"]),
  skuId: z.string().min(1),
  batchId: z.string().min(1).optional().nullable(),
  locationId: z.string().min(1),
  quantity: qty,
  bucket: z.enum(["ON_HAND", "QUARANTINED", "DAMAGED"]).optional(),
  direction: z.enum(["INCREASE", "DECREASE"]).optional(),
  reason: z.string().trim().max(1000).optional(),
  incidentId: z.string().optional(),
});

/** Who may record each movement type. */
const MOVEMENT_PERMISSION: Record<string, OrgPermission> = {
  OPENING_BALANCE: "inventory:receive",
  RECEIPT: "inventory:receive",
  CUSTOMER_RETURN: "inventory:receive",
  DAMAGE: "inventory:receive",
  SUPPLIER_RETURN: "inventory:dispatch",
  DISPATCH: "inventory:dispatch",
  LOSS: "inventory:adjust",
  STOCK_ADJUSTMENT: "inventory:adjust",
};
const REASON_REQUIRED = new Set(["SUPPLIER_RETURN", "DISPATCH", "DAMAGE", "LOSS", "STOCK_ADJUSTMENT", "CUSTOMER_RETURN"]);

const balanceInclude = {
  sku: { select: { id: true, sku: true, name: true, organizationId: true } },
  batch: { select: { id: true, batchCode: true, holdStatus: true, qualityStatus: true, expiryDate: true, passportProductId: true } },
  location: { select: { id: true, code: true, warehouse: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.InventoryBalanceInclude;

function requirePermission(a: Actor, permission: OrgPermission) {
  if (!hasPermission(a.role, permission)) throw forbidden(`Your role (${a.role}) does not allow ${permission}.`);
}

export class InventoryService {
  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async balances(organizationId: string, q: Query) {
    const where: Prisma.InventoryBalanceWhereInput = {
      organizationId,
      ...(str(q, "skuId") ? { skuId: str(q, "skuId") } : {}),
      ...(str(q, "batchId") ? { batchId: str(q, "batchId") } : {}),
      ...(str(q, "warehouseId") ? { warehouseId: str(q, "warehouseId") } : {}),
      ...(str(q, "locationId") ? { locationId: str(q, "locationId") } : {}),
      ...(str(q, "held") === "true" ? { quarantined: { gt: 0 } } : {}),
      ...(str(q, "includeEmpty") === "true" ? {} : { OR: [{ onHand: { gt: 0 } }, { quarantined: { gt: 0 } }, { damaged: { gt: 0 } }, { reserved: { gt: 0 } }] }),
    };
    const result = await paginate(
      q,
      () => prisma.inventoryBalance.count({ where }),
      (page) => prisma.inventoryBalance.findMany({ where, ...page, include: balanceInclude, orderBy: { updatedAt: "desc" } }),
    );
    return { ...result, items: result.items.map(presentBalance) };
  }

  /** Per-SKU roll-up of the organization's stock (unit-consistent because a SKU has one unit). */
  async productInventory(organizationId: string, q: Query) {
    const search = str(q, "q");
    const grouped = await prisma.inventoryBalance.groupBy({
      by: ["skuId"],
      where: { organizationId },
      _sum: { onHand: true, reserved: true, quarantined: true, damaged: true },
    });
    const ownedSkus = await prisma.productSku.findMany({ where: { organizationId }, select: { id: true } });
    const ids = [...new Set([...grouped.map((g) => g.skuId), ...ownedSkus.map((s) => s.id)])];
    const skus = await prisma.productSku.findMany({
      where: { id: { in: ids }, ...(search ? { OR: [{ sku: { contains: search, mode: "insensitive" } }, { name: { contains: search, mode: "insensitive" } }, { category: { contains: search, mode: "insensitive" } }] } : {}) },
      orderBy: { sku: "asc" },
    });
    const [batchCounts, rules] = await Promise.all([
      prisma.inventoryBalance.groupBy({ by: ["skuId", "batchKey"], where: { organizationId, skuId: { in: ids }, batchKey: { not: "" } } }),
      prisma.reorderRule.findMany({ where: { organizationId, skuId: { in: ids } } }),
    ]);
    const sums = new Map(grouped.map((g) => [g.skuId, g._sum]));
    return skus.map((s) => {
      const sum = sums.get(s.id);
      const onHand = new D(sum?.onHand ?? 0);
      const reserved = new D(sum?.reserved ?? 0);
      const rule = rules.find((r) => r.skuId === s.id);
      const avail = onHand.minus(reserved);
      return {
        ...s,
        owned: s.organizationId === organizationId,
        onHand: onHand.toString(),
        reserved: reserved.toString(),
        available: avail.toString(),
        quarantined: new D(sum?.quarantined ?? 0).toString(),
        damaged: new D(sum?.damaged ?? 0).toString(),
        batchCount: batchCounts.filter((b) => b.skuId === s.id).length,
        reorderThreshold: rule?.threshold.toString() ?? null,
        lowStock: rule ? avail.lte(rule.threshold) : false,
      };
    });
  }

  async summary(organizationId: string) {
    const [byUnit, skuCount, batchKeys, incoming, outgoing, openDiscrepancies, recent, held] = await Promise.all([
      prisma.inventoryBalance.groupBy({ by: ["unitOfMeasure"], where: { organizationId }, _sum: { onHand: true, reserved: true, quarantined: true, damaged: true } }),
      prisma.inventoryBalance.groupBy({ by: ["skuId"], where: { organizationId, OR: [{ onHand: { gt: 0 } }, { quarantined: { gt: 0 } }] } }),
      prisma.inventoryBalance.groupBy({ by: ["batchKey"], where: { organizationId, batchKey: { not: "" }, OR: [{ onHand: { gt: 0 } }, { quarantined: { gt: 0 } }] } }),
      prisma.shipment.count({ where: { receiverOrganizationId: organizationId, status: { in: ["DISPATCHED", "PARTIALLY_RECEIVED"] } } }),
      prisma.shipment.count({ where: { senderOrganizationId: organizationId, status: { in: ["DRAFT", "RESERVED", "READY_TO_DISPATCH", "DISPATCHED", "PARTIALLY_RECEIVED", "REJECTED"] } } }),
      prisma.inventoryDiscrepancy.count({ where: { organizationId, status: "OPEN" } }),
      this.transactions(organizationId, { pageSize: "8" }),
      prisma.inventoryBalance.count({ where: { organizationId, quarantined: { gt: 0 } } }),
    ]);
    const products = await this.productInventory(organizationId, {});
    return {
      activeSkus: skuCount.length,
      trackedBatches: batchKeys.length,
      totalsByUnit: byUnit.map((u) => {
        const onHand = new D(u._sum.onHand ?? 0);
        const reserved = new D(u._sum.reserved ?? 0);
        return {
          unitOfMeasure: u.unitOfMeasure,
          onHand: onHand.toString(),
          reserved: reserved.toString(),
          available: onHand.minus(reserved).toString(),
          quarantined: new D(u._sum.quarantined ?? 0).toString(),
          damaged: new D(u._sum.damaged ?? 0).toString(),
        };
      }),
      incomingShipments: incoming,
      outgoingShipments: outgoing,
      lowStockSkus: products.filter((p) => p.lowStock).length,
      heldBalances: held,
      openDiscrepancies,
      recentMovements: recent.items,
    };
  }

  /**
   * Sales activity is derived only from completed external dispatch movements.
   * ORIGINX does not store order prices, so this deliberately reports quantities
   * and dispatch counts rather than inventing revenue.
   */
  async salesMonitoring(organizationId: string, q: Query) {
    const requestedPeriod = str(q, "period") ?? "30d";
    const periods = {
      "7d": { days: 7, bucket: "day" },
      "30d": { days: 30, bucket: "day" },
      "90d": { days: 90, bucket: "week" },
      "12m": { days: 365, bucket: "month" },
    } as const;
    if (!(requestedPeriod in periods)) throw new AppError("INVALID_PERIOD", "Choose a supported sales period.", 400);
    const period = periods[requestedPeriod as keyof typeof periods];
    const to = new Date();
    const from = new Date(to.getTime() - period.days * 24 * 60 * 60 * 1000);
    const previousFrom = new Date(from.getTime() - period.days * 24 * 60 * 60 * 1000);
    const currentWhere: Prisma.InventoryTransactionWhereInput = {
      organizationId,
      type: "DISPATCH",
      status: "COMPLETED",
      shipmentId: null,
      createdAt: { gte: from, lt: to },
    };
    const previousWhere: Prisma.InventoryTransactionWhereInput = {
      ...currentWhere,
      createdAt: { gte: previousFrom, lt: from },
    };

    const [trendRows, currentBySku, currentByUnit, previousByUnit] = await Promise.all([
      prisma.$queryRaw<Array<{ period: Date; unitOfMeasure: string; quantity: string; dispatches: number }>>(Prisma.sql`
        SELECT date_trunc(${period.bucket}, "createdAt") AS "period",
               "unitOfMeasure",
               SUM("quantity")::text AS "quantity",
               COUNT(*)::int AS "dispatches"
        FROM "InventoryTransaction"
        WHERE "organizationId" = ${organizationId}
          AND "type" = 'DISPATCH'
          AND "status" = 'COMPLETED'
          AND "shipmentId" IS NULL
          AND "createdAt" >= ${from}
          AND "createdAt" < ${to}
        GROUP BY 1, 2
        ORDER BY 1 ASC
      `),
      prisma.inventoryTransaction.groupBy({
        by: ["skuId", "unitOfMeasure"],
        where: currentWhere,
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      prisma.inventoryTransaction.groupBy({
        by: ["unitOfMeasure"],
        where: currentWhere,
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      prisma.inventoryTransaction.groupBy({
        by: ["unitOfMeasure"],
        where: previousWhere,
        _sum: { quantity: true },
        _count: { _all: true },
      }),
    ]);

    const topRows = [...currentBySku].sort((a, b) =>
      (b._sum.quantity ?? new Prisma.Decimal(0)).comparedTo(a._sum.quantity ?? new Prisma.Decimal(0)),
    ).slice(0, 8);
    const skus = await prisma.productSku.findMany({
      where: { organizationId, id: { in: topRows.map((row) => row.skuId) } },
      select: { id: true, sku: true, name: true },
    });
    const skuMap = new Map(skus.map((sku) => [sku.id, sku]));
    const mapUnit = (row: (typeof currentByUnit)[number]) => ({
      unitOfMeasure: row.unitOfMeasure,
      quantity: (row._sum.quantity ?? new Prisma.Decimal(0)).toString(),
      dispatches: row._count._all,
    });

    return {
      period: requestedPeriod,
      from: from.toISOString(),
      to: to.toISOString(),
      previousFrom: previousFrom.toISOString(),
      trend: trendRows.map((row) => ({ ...row, period: row.period.toISOString(), dispatches: Number(row.dispatches) })),
      totalsByUnit: currentByUnit.map(mapUnit),
      previousTotalsByUnit: previousByUnit.map(mapUnit),
      dispatches: currentByUnit.reduce((total, row) => total + row._count._all, 0),
      uniqueProducts: currentBySku.length,
      topProducts: topRows.map((row) => ({
        skuId: row.skuId,
        sku: skuMap.get(row.skuId)?.sku ?? "—",
        name: skuMap.get(row.skuId)?.name ?? "Unknown product",
        unitOfMeasure: row.unitOfMeasure,
        quantity: (row._sum.quantity ?? new Prisma.Decimal(0)).toString(),
        dispatches: row._count._all,
      })),
    };
  }

  async transactions(organizationId: string, q: Query) {
    const from = str(q, "from");
    const to = str(q, "to");
    const where: Prisma.InventoryTransactionWhereInput = {
      organizationId,
      ...(str(q, "type") ? { type: str(q, "type") } : {}),
      ...(str(q, "skuId") ? { skuId: str(q, "skuId") } : {}),
      ...(str(q, "batchId") ? { batchId: str(q, "batchId") } : {}),
      ...(str(q, "shipmentId") ? { shipmentId: str(q, "shipmentId") } : {}),
      ...(str(q, "warehouseId") ? { OR: [{ fromWarehouseId: str(q, "warehouseId") }, { toWarehouseId: str(q, "warehouseId") }] } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    };
    const result = await paginate(
      q,
      () => prisma.inventoryTransaction.count({ where }),
      (page) => prisma.inventoryTransaction.findMany({ where, ...page, orderBy: { createdAt: "desc" }, include: { entries: true } }),
    );
    const skuIds = [...new Set(result.items.map((t) => t.skuId))];
    const batchIds = [...new Set(result.items.map((t) => t.batchId).filter(Boolean) as string[])];
    const locIds = [...new Set(result.items.flatMap((t) => [t.fromLocationId, t.toLocationId]).filter(Boolean) as string[])];
    const actorIds = [...new Set(result.items.map((t) => t.actorUserId).filter(Boolean) as string[])];
    const [skus, batches, locations, members, shipments] = await Promise.all([
      prisma.productSku.findMany({ where: { id: { in: skuIds } }, select: { id: true, sku: true, name: true } }),
      prisma.productBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, batchCode: true } }),
      prisma.storageLocation.findMany({ where: { id: { in: locIds }, organizationId }, select: { id: true, code: true, warehouse: { select: { code: true, name: true } } } }),
      prisma.organizationMember.findMany({ where: { organizationId, userId: { in: actorIds } }, select: { userId: true, user: { select: { fullName: true } } } }),
      prisma.shipment.findMany({ where: { id: { in: result.items.map((t) => t.shipmentId).filter(Boolean) as string[] } }, select: { id: true, reference: true } }),
    ]);
    const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
    const skuMap = byId(skus);
    const batchMap = byId(batches);
    const locMap = byId(locations);
    const shipMap = byId(shipments);
    const memberMap = new Map(members.map((m) => [m.userId, m.user.fullName]));
    return {
      ...result,
      items: result.items.map((t) => ({
        ...t,
        quantity: t.quantity.toString(),
        entries: t.entries.map((e) => ({ ...e, delta: e.delta.toString() })),
        sku: skuMap.get(t.skuId) ?? null,
        batch: t.batchId ? batchMap.get(t.batchId) ?? null : null,
        fromLocation: t.fromLocationId ? locMap.get(t.fromLocationId) ?? null : null,
        toLocation: t.toLocationId ? locMap.get(t.toLocationId) ?? null : null,
        shipment: t.shipmentId ? shipMap.get(t.shipmentId) ?? null : null,
        // Actors from another organization (e.g. a brand placing a batch hold) are not named.
        actorName: t.actorUserId ? memberMap.get(t.actorUserId) ?? "Another organization" : "System",
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Movements
  // -------------------------------------------------------------------------

  async recordMovement(a: Actor, input: unknown, idempotencyKey?: string) {
    const data = movementSchema.parse(input);
    requirePermission(a, MOVEMENT_PERMISSION[data.type]);
    if (REASON_REQUIRED.has(data.type) && (!data.reason || data.reason.length < 3)) {
      throw new AppError("REASON_REQUIRED", `A reason is required for ${data.type.toLowerCase().replace(/_/g, " ")}.`, 422);
    }
    if (data.type === "STOCK_ADJUSTMENT" && !data.direction) throw new AppError("DIRECTION_REQUIRED", "Choose INCREASE or DECREASE for an adjustment.", 422);

    return runIdempotent(a.organizationId, idempotencyKey, `movement:${data.type}`, async (tx) => {
      const { sku, batch } = await resolveSkuBatch(a.organizationId, data.skuId, data.batchId, tx);
      if (data.type === "RECEIPT" && sku.organizationId !== a.organizationId) {
        throw forbidden("Receipts of new stock are recorded by the SKU owner. Partners receive stock through shipments.", "NOT_SKU_OWNER");
      }
      if (["CUSTOMER_RETURN", "OPENING_BALANCE"].includes(data.type) && sku.organizationId !== a.organizationId) {
        const held = await tx.inventoryBalance.count({ where: { organizationId: a.organizationId, skuId: sku.id } });
        if (!held) throw forbidden("You can only book stock of SKUs your organization owns or has received.", "NOT_SKU_HOLDER");
      }
      const unit = sku.unitOfMeasure;
      const quantity = parseQuantity(data.quantity, unit);
      const location = await getOwnedLocation(a.organizationId, data.locationId, tx);
      const balance = await ensureBalance(tx, { organizationId: a.organizationId, locationId: location.id, skuId: sku.id, batchId: batch?.id ?? null, unitOfMeasure: unit });
      const held = Boolean(batch && batch.holdStatus !== "NONE");
      const deltas: Delta[] = [];
      const inbound = (bucket: BalanceBucket) => deltas.push({ balanceId: balance.id, bucket, delta: quantity });
      const outbound = (bucket: BalanceBucket) => deltas.push({ balanceId: balance.id, bucket, delta: quantity.neg() });

      switch (data.type) {
        case "OPENING_BALANCE":
        case "RECEIPT":
          inbound(held ? "QUARANTINED" : "ON_HAND");
          break;
        case "CUSTOMER_RETURN":
          inbound(held ? "QUARANTINED" : (data.bucket ?? "ON_HAND"));
          break;
        case "SUPPLIER_RETURN":
          outbound("ON_HAND");
          break;
        case "DISPATCH":
          assertBatchDispatchable(batch);
          outbound("ON_HAND");
          break;
        case "DAMAGE":
          outbound("ON_HAND");
          inbound("DAMAGED");
          break;
        case "LOSS":
          outbound(data.bucket ?? "ON_HAND");
          break;
        case "STOCK_ADJUSTMENT":
          if (data.direction === "INCREASE") inbound(data.bucket ?? "ON_HAND");
          else outbound(data.bucket ?? "ON_HAND");
          break;
      }
      const isInbound = deltas.every((d) => d.delta.gt(0));
      const transaction = await postTransaction(
        tx,
        {
          organizationId: a.organizationId,
          type: data.type,
          skuId: sku.id,
          batchId: batch?.id ?? null,
          unitOfMeasure: unit,
          quantity,
          ...(isInbound ? { toWarehouseId: location.warehouseId, toLocationId: location.id } : { fromWarehouseId: location.warehouseId, fromLocationId: location.id }),
          incidentId: data.incidentId ?? null,
          reason: data.reason ?? null,
          actorUserId: a.userId,
          idempotencyKey: idempotencyKey ?? null,
        },
        deltas,
      );
      if (data.type === "LOSS" || (data.type === "STOCK_ADJUSTMENT" && data.direction === "DECREASE")) {
        await this.flag(tx, {
          organizationId: a.organizationId,
          type: "STOCK_LOSS",
          severity: "MEDIUM",
          message: `${data.type === "LOSS" ? "Loss" : "Downward adjustment"} of ${quantity} ${unit} of ${sku.sku}${batch ? ` batch ${batch.batchCode}` : ""}: ${data.reason}`,
          details: { transactionId: transaction.id, actorUserId: a.userId },
          skuId: sku.id,
          batchId: batch?.id,
          balanceId: balance.id,
          fingerprint: `tx:${transaction.id}`,
        });
      }
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: `INVENTORY_${data.type}`, resourceType: "InventoryTransaction", resourceId: transaction.id, metadata: { quantity: quantity.toString(), unit, skuId: sku.id, batchId: batch?.id, locationId: location.id, reason: data.reason, heldBatch: held }, ipHash: a.ipHash }, tx);
      const after = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } });
      return { response: { transaction: { ...transaction, quantity: transaction.quantity.toString(), entries: transaction.entries.map((e) => ({ ...e, delta: e.delta.toString() })) }, balance: presentBalance(after), heldBatch: held } };
    });
  }

  /** Moves stock between locations/warehouses of the same organization (never a custody change). */
  async transfer(a: Actor, input: unknown, idempotencyKey?: string) {
    requirePermission(a, "inventory:move");
    const data = z.object({ skuId: z.string(), batchId: z.string().optional().nullable(), fromLocationId: z.string(), toLocationId: z.string(), quantity: qty, reason: z.string().trim().max(1000).optional() }).parse(input);
    if (data.fromLocationId === data.toLocationId) throw new AppError("SAME_LOCATION", "Source and destination are the same location.", 422);
    return runIdempotent(a.organizationId, idempotencyKey, "transfer", async (tx) => {
      const { sku, batch } = await resolveSkuBatch(a.organizationId, data.skuId, data.batchId, tx);
      const quantity = parseQuantity(data.quantity, sku.unitOfMeasure);
      const [from, to] = await Promise.all([getOwnedLocation(a.organizationId, data.fromLocationId, tx), getOwnedLocation(a.organizationId, data.toLocationId, tx)]);
      const key = { organizationId: a.organizationId, skuId: sku.id, batchId: batch?.id ?? null, unitOfMeasure: sku.unitOfMeasure };
      const source = await tx.inventoryBalance.findUnique({ where: { organizationId_locationId_skuId_batchKey: { organizationId: a.organizationId, locationId: from.id, skuId: sku.id, batchKey: batch?.id ?? "" } } });
      if (!source) throw new AppError("INSUFFICIENT_STOCK", "There is no stock of this item at the source location.", 409);
      const target = await ensureBalance(tx, { ...key, locationId: to.id });
      const correlationId = randomUUID();
      const common = { organizationId: a.organizationId, skuId: sku.id, batchId: batch?.id ?? null, unitOfMeasure: sku.unitOfMeasure, quantity, fromWarehouseId: from.warehouseId, fromLocationId: from.id, toWarehouseId: to.warehouseId, toLocationId: to.id, correlationId, reason: data.reason ?? null, actorUserId: a.userId };
      const out = await postTransaction(tx, { ...common, type: "TRANSFER_OUT", idempotencyKey: idempotencyKey ?? null }, [{ balanceId: source.id, bucket: "ON_HAND", delta: quantity.neg() }]);
      const inn = await postTransaction(tx, { ...common, type: "TRANSFER_IN" }, [{ balanceId: target.id, bucket: "ON_HAND", delta: quantity }]);
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "INVENTORY_TRANSFER", resourceType: "InventoryTransaction", resourceId: out.id, metadata: { correlationId, from: from.id, to: to.id, quantity: quantity.toString() }, ipHash: a.ipHash }, tx);
      return { response: { correlationId, transferOutId: out.id, transferInId: inn.id, quantity: quantity.toString() } };
    });
  }

  // -------------------------------------------------------------------------
  // Quarantine (local) and batch holds (brand, across all holders)
  // -------------------------------------------------------------------------

  async quarantine(a: Actor, input: unknown, release = false, idempotencyKey?: string) {
    requirePermission(a, "inventory:quarantine");
    const data = z.object({ balanceId: z.string(), quantity: qty, reason: z.string().trim().min(3).max(1000), incidentId: z.string().optional() }).parse(input);
    return runIdempotent(a.organizationId, idempotencyKey, release ? "quarantine-release" : "quarantine", async (tx) => {
      const balance = await tx.inventoryBalance.findFirst({ where: { id: data.balanceId, organizationId: a.organizationId }, include: { batch: true } });
      if (!balance) throw notFound("InventoryBalance", "BALANCE_NOT_FOUND");
      if (release && balance.batch && balance.batch.holdStatus !== "NONE") {
        throw new AppError("BATCH_ON_HOLD", `Batch ${balance.batch.batchCode} is ${balance.batch.holdStatus.toLowerCase()}; stock cannot be released until the hold is lifted.`, 409);
      }
      const quantity = parseQuantity(data.quantity, balance.unitOfMeasure);
      const deltas: Delta[] = release
        ? [{ balanceId: balance.id, bucket: "QUARANTINED", delta: quantity.neg() }, { balanceId: balance.id, bucket: "ON_HAND", delta: quantity }]
        : [{ balanceId: balance.id, bucket: "ON_HAND", delta: quantity.neg() }, { balanceId: balance.id, bucket: "QUARANTINED", delta: quantity }];
      const transaction = await postTransaction(
        tx,
        { organizationId: a.organizationId, type: release ? "QUARANTINE_RELEASE" : "QUARANTINE", skuId: balance.skuId, batchId: balance.batchId, unitOfMeasure: balance.unitOfMeasure, quantity, fromLocationId: balance.locationId, toLocationId: balance.locationId, fromWarehouseId: balance.warehouseId, toWarehouseId: balance.warehouseId, incidentId: data.incidentId ?? null, reason: data.reason, actorUserId: a.userId, idempotencyKey: idempotencyKey ?? null },
        deltas,
      );
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: release ? "INVENTORY_QUARANTINE_RELEASE" : "INVENTORY_QUARANTINE", resourceType: "InventoryBalance", resourceId: balance.id, metadata: { quantity: quantity.toString(), reason: data.reason, transactionId: transaction.id }, ipHash: a.ipHash }, tx);
      return { response: { transactionId: transaction.id, balance: presentBalance(await tx.inventoryBalance.findUniqueOrThrow({ where: { id: balance.id } })) } };
    });
  }

  /**
   * Places every recorded unit of a batch — at every holder — into quarantine and releases its
   * reservations. Used for brand quarantine holds and recalls. Works only from recorded balances.
   */
  async holdBatch(tx: Db, batch: ProductBatch, opts: { hold: "QUARANTINED" | "RECALLED"; type: InventoryTxType; actorUserId: string; actorOrganizationId: string; reason: string; recallId?: string; incidentId?: string }) {
    await tx.$queryRaw`SELECT "id" FROM "ProductBatch" WHERE "id" = ${batch.id} FOR UPDATE`;
    await tx.productBatch.update({ where: { id: batch.id }, data: { holdStatus: opts.hold } });
    const correlationId = randomUUID();
    // 1. Release active reservations (shipments revert to DRAFT so nobody dispatches held stock).
    const reservations = await tx.inventoryReservation.findMany({ where: { batchId: batch.id, status: "ACTIVE" } });
    for (const r of reservations) await this.releaseReservation(tx, r.id, opts.actorUserId, `Batch ${opts.hold.toLowerCase()}: ${opts.reason}`, correlationId);
    // 2. Move all on-hand stock of the batch into quarantine, per holder.
    const balances = await tx.inventoryBalance.findMany({ where: { batchId: batch.id, onHand: { gt: 0 } } });
    const allocations: Array<{ organizationId: string; balanceId: string; quantity: string }> = [];
    for (const b of balances) {
      const locked = (await tx.inventoryBalance.findUniqueOrThrow({ where: { id: b.id } })) as InventoryBalance;
      const amount = new D(locked.onHand).minus(locked.reserved);
      if (amount.lte(0)) continue;
      await postTransaction(
        tx,
        { organizationId: b.organizationId, type: opts.type, skuId: b.skuId, batchId: batch.id, unitOfMeasure: b.unitOfMeasure, quantity: amount, fromLocationId: b.locationId, toLocationId: b.locationId, fromWarehouseId: b.warehouseId, toWarehouseId: b.warehouseId, recallId: opts.recallId ?? null, incidentId: opts.incidentId ?? null, correlationId, reason: opts.reason, actorUserId: opts.actorUserId },
        [
          { balanceId: b.id, bucket: "ON_HAND", delta: amount.neg() },
          { balanceId: b.id, bucket: "QUARANTINED", delta: amount },
        ],
      );
      allocations.push({ organizationId: b.organizationId, balanceId: b.id, quantity: amount.toString() });
      if (b.organizationId !== opts.actorOrganizationId) {
        await writeAudit({ organizationId: b.organizationId, actorUserId: opts.actorUserId, action: `INVENTORY_${opts.type}`, resourceType: "InventoryBalance", resourceId: b.id, metadata: { batchId: batch.id, quantity: amount.toString(), reason: opts.reason, imposedBy: opts.actorOrganizationId }, ipHash: null }, tx);
      }
    }
    const event = await recordInventoryEvent(tx, {
      batch,
      organizationId: opts.actorOrganizationId,
      actorUserId: opts.actorUserId,
      eventType: "STATUS_CHANGED",
      publicLocation: null,
      metadata: { previousStatus: `HOLD_${batch.holdStatus}`, newStatus: `HOLD_${opts.hold}`, reason: opts.reason, recallId: opts.recallId, holders: new Set(allocations.map((x) => x.organizationId)).size },
    });
    return { correlationId, allocations, releasedReservations: reservations.length, event };
  }

  /** Brand places or lifts a quarantine hold on a whole batch. Recall holds are lifted only by the recall workflow. */
  async setBatchHold(a: Actor, batchId: string, input: unknown) {
    requirePermission(a, "inventory:quarantine");
    const data = z.object({ status: z.enum(["QUARANTINED", "NONE"]), reason: z.string().trim().min(3).max(1000), incidentId: z.string().optional() }).parse(input);
    const batch = await getReadableBatch(a.organizationId, batchId);
    assertOwner(batch.organizationId, a.organizationId, "batch");
    if (batch.holdStatus === "RECALLED") throw new AppError("BATCH_RECALLED", "This batch is under recall; the hold is managed by the recall.", 409);
    let anchor: Parameters<typeof anchorAfterCommit>[0] = [];
    const result = await prisma.$transaction(
      async (tx) => {
        if (data.status === "QUARANTINED") {
          if (batch.holdStatus === "QUARANTINED") throw new AppError("ALREADY_HELD", "Batch is already quarantined.", 409);
          const r = await this.holdBatch(tx, batch, { hold: "QUARANTINED", type: "QUARANTINE", actorUserId: a.userId, actorOrganizationId: a.organizationId, reason: data.reason, incidentId: data.incidentId });
          anchor = [r.event];
          return { holdStatus: "QUARANTINED", allocations: r.allocations, releasedReservations: r.releasedReservations };
        }
        if (batch.holdStatus === "NONE") throw new AppError("NOT_HELD", "Batch is not on hold.", 409);
        await tx.productBatch.update({ where: { id: batch.id }, data: { holdStatus: "NONE" } });
        const event = await recordInventoryEvent(tx, { batch, organizationId: a.organizationId, actorUserId: a.userId, eventType: "STATUS_CHANGED", publicLocation: null, metadata: { previousStatus: `HOLD_${batch.holdStatus}`, newStatus: "HOLD_NONE", reason: data.reason } });
        anchor = [event];
        // Quarantined stock stays quarantined until each holder inspects and releases it explicitly.
        return { holdStatus: "NONE", note: "Holders must release their quarantined stock explicitly after inspection." };
      },
      { timeout: 30_000 },
    );
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: data.status === "QUARANTINED" ? "BATCH_HOLD_PLACED" : "BATCH_HOLD_LIFTED", resourceType: "ProductBatch", resourceId: batchId, metadata: { reason: data.reason, incidentId: data.incidentId }, ipHash: a.ipHash });
    await anchorAfterCommit(anchor, a.ipHash);
    return result;
  }

  // -------------------------------------------------------------------------
  // Reservations (used by shipments)
  // -------------------------------------------------------------------------

  async reserve(tx: Db, a: Actor, item: { id: string; shipmentId: string; skuId: string; batchId: string | null; fromLocationId: string; requestedQty: Dec; unitOfMeasure: string }) {
    const existing = await tx.inventoryReservation.findUnique({ where: { shipmentItemId: item.id } });
    if (existing?.status === "ACTIVE") return existing;
    const balance = await tx.inventoryBalance.findUnique({ where: { organizationId_locationId_skuId_batchKey: { organizationId: a.organizationId, locationId: item.fromLocationId, skuId: item.skuId, batchKey: item.batchId ?? "" } } });
    if (!balance) throw new AppError("INSUFFICIENT_STOCK", "There is no stock of this item at the selected location.", 409);
    const reservation = existing
      ? await tx.inventoryReservation.update({ where: { id: existing.id }, data: { status: "ACTIVE", quantity: item.requestedQty, balanceId: balance.id, releasedAt: null, consumedAt: null } })
      : await tx.inventoryReservation.create({ data: { organizationId: a.organizationId, balanceId: balance.id, skuId: item.skuId, batchId: item.batchId, quantity: item.requestedQty, shipmentId: item.shipmentId, shipmentItemId: item.id, createdById: a.userId } });
    await postTransaction(
      tx,
      { organizationId: a.organizationId, type: "RESERVATION", skuId: item.skuId, batchId: item.batchId, unitOfMeasure: item.unitOfMeasure, quantity: item.requestedQty, fromLocationId: item.fromLocationId, fromWarehouseId: balance.warehouseId, shipmentId: item.shipmentId, shipmentItemId: item.id, reservationId: reservation.id, actorUserId: a.userId },
      [{ balanceId: balance.id, bucket: "RESERVED", delta: item.requestedQty }],
    );
    return reservation;
  }

  async releaseReservation(tx: Db, reservationId: string, actorUserId: string | null, reason: string, correlationId?: string) {
    const r = await tx.inventoryReservation.findUniqueOrThrow({ where: { id: reservationId } });
    if (r.status !== "ACTIVE") return r;
    const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: r.balanceId } });
    await postTransaction(
      tx,
      { organizationId: r.organizationId, type: "RESERVATION_RELEASE", skuId: r.skuId, batchId: r.batchId, unitOfMeasure: balance.unitOfMeasure, quantity: new D(r.quantity), fromLocationId: balance.locationId, fromWarehouseId: balance.warehouseId, shipmentId: r.shipmentId, shipmentItemId: r.shipmentItemId, reservationId: r.id, correlationId: correlationId ?? null, reason, actorUserId },
      [{ balanceId: r.balanceId, bucket: "RESERVED", delta: new D(r.quantity).neg() }],
    );
    const released = await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: "RELEASED", releasedAt: new Date() } });
    if (r.shipmentId) {
      await tx.shipment.updateMany({ where: { id: r.shipmentId, status: { in: ["RESERVED", "READY_TO_DISPATCH"] } }, data: { status: "DRAFT", notes: reason } });
    }
    return released;
  }

  async reservations(organizationId: string, q: Query) {
    const where = { organizationId, ...(str(q, "status") ? { status: str(q, "status") } : {}), ...(str(q, "shipmentId") ? { shipmentId: str(q, "shipmentId") } : {}) };
    const result = await paginate(q, () => prisma.inventoryReservation.count({ where }), (page) => prisma.inventoryReservation.findMany({ where, ...page, orderBy: { createdAt: "desc" } }));
    return { ...result, items: result.items.map((r) => ({ ...r, quantity: r.quantity.toString() })) };
  }

  // -------------------------------------------------------------------------
  // Recall integration
  // -------------------------------------------------------------------------

  /** Batches affected by a recall: the recalled batch, or the batch whose passport was recalled. */
  async recallBatches(recall: { batchId: string | null; productId: string | null }, db: Db = prisma) {
    if (recall.batchId) return db.productBatch.findMany({ where: { id: recall.batchId } });
    if (recall.productId) return db.productBatch.findMany({ where: { passportProductId: recall.productId } });
    return [];
  }

  async allocateRecall(actor: { userId: string; organizationId: string; ipHash?: string | null }, recall: { id: string; batchId: string | null; productId: string | null; reason: string; incidentId: string | null }) {
    const events = await prisma.$transaction(
      async (tx) => {
        const batches = await this.recallBatches(recall, tx);
        const out = [];
        for (const batch of batches) {
          if (batch.holdStatus === "RECALLED") continue;
          const r = await this.holdBatch(tx, batch, { hold: "RECALLED", type: "RECALL_ALLOCATION", actorUserId: actor.userId, actorOrganizationId: actor.organizationId, reason: recall.reason, recallId: recall.id, incidentId: recall.incidentId ?? undefined });
          out.push(r.event);
        }
        return out;
      },
      { timeout: 30_000 },
    );
    await anchorAfterCommit(events, actor.ipHash);
  }

  /** On recall cancellation the hold is lifted; quarantined stock stays held until holders release it. */
  async liftRecallHold(recall: { id: string; batchId: string | null; productId: string | null }) {
    for (const batch of await this.recallBatches(recall)) {
      const other = await prisma.recall.findFirst({ where: { id: { not: recall.id }, status: { in: ACTIVE_RECALL_STATUS }, OR: [{ batchId: batch.id }, ...(batch.passportProductId ? [{ productId: batch.passportProductId }] : [])] } });
      if (!other && batch.holdStatus === "RECALLED") await prisma.productBatch.update({ where: { id: batch.id }, data: { holdStatus: "NONE" } });
    }
  }

  /**
   * Recall traceability from recorded data only. Quantities that left the recorded network
   * (external dispatches, losses) are reported as not traceable rather than assumed.
   */
  async recallInventory(organizationId: string, recallId: string) {
    const recall = await prisma.recall.findFirst({ where: { id: recallId, organizationId } });
    if (!recall) throw notFound("Recall");
    const batches = await this.recallBatches(recall);
    const out = [];
    for (const batch of batches) {
      const [balances, allocations, transit, external, returned] = await Promise.all([
        prisma.inventoryBalance.groupBy({ by: ["organizationId", "unitOfMeasure"], where: { batchId: batch.id }, _sum: { onHand: true, quarantined: true, damaged: true, reserved: true } }),
        prisma.inventoryTransaction.groupBy({ by: ["organizationId"], where: { batchId: batch.id, recallId: recall.id, type: "RECALL_ALLOCATION" }, _sum: { quantity: true } }),
        prisma.shipmentItem.findMany({ where: { batchId: batch.id, shipment: { status: { in: ["DISPATCHED", "PARTIALLY_RECEIVED", "REJECTED"] } } }, include: { shipment: { select: { id: true, reference: true, senderOrganizationId: true, receiverOrganizationId: true, status: true, purpose: true } } } }),
        prisma.inventoryTransaction.groupBy({ by: ["type"], where: { batchId: batch.id, type: { in: ["DISPATCH", "LOSS", "SUPPLIER_RETURN"] }, shipmentId: null }, _sum: { quantity: true } }),
        prisma.inventoryTransaction.aggregate({ where: { batchId: batch.id, type: "RECALL_RETURN", toLocationId: { not: null } }, _sum: { quantity: true } }),
      ]);
      const orgIds = [...new Set([...balances.map((b) => b.organizationId), ...transit.flatMap((t) => [t.shipment.senderOrganizationId, t.shipment.receiverOrganizationId])])];
      const orgs = await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
      const name = (id: string) => orgs.find((o) => o.id === id)?.name ?? "Unknown";
      out.push({
        batch: { id: batch.id, batchCode: batch.batchCode, holdStatus: batch.holdStatus },
        holders: balances.map((b) => ({
          organizationId: b.organizationId,
          organizationName: name(b.organizationId),
          unitOfMeasure: b.unitOfMeasure,
          onHand: new D(b._sum.onHand ?? 0).toString(),
          quarantined: new D(b._sum.quarantined ?? 0).toString(),
          damaged: new D(b._sum.damaged ?? 0).toString(),
          allocatedByThisRecall: new D(allocations.find((x) => x.organizationId === b.organizationId)?._sum.quantity ?? 0).toString(),
        })),
        inTransit: transit.map((t) => {
          const outstanding = new D(t.dispatchedQty).minus(t.receivedQty).minus(t.damagedQty).minus(t.missingQty);
          return { shipmentId: t.shipment.id, reference: t.shipment.reference, purpose: t.shipment.purpose, status: t.shipment.status, from: name(t.shipment.senderOrganizationId), to: name(t.shipment.receiverOrganizationId), outstanding: outstanding.toString(), unitOfMeasure: t.unitOfMeasure };
        }),
        returnedToBrand: new D(returned._sum.quantity ?? 0).toString(),
        leftRecordedNetwork: external.map((e) => ({ type: e.type, quantity: new D(e._sum.quantity ?? 0).toString() })),
        note: "Based on recorded ORIGINX inventory only. Stock never recorded in ORIGINX, or dispatched to parties outside it, cannot be located.",
      });
    }
    return { recallId: recall.id, status: recall.status, batches: out };
  }

  // -------------------------------------------------------------------------
  // Alerts, discrepancies, reconciliation
  // -------------------------------------------------------------------------

  async alerts(organizationId: string, q: Query) {
    const days = Math.min(365, Math.max(1, Number(str(q, "expiringWithinDays") ?? 30) || 30));
    const staleDays = Math.min(90, Math.max(1, Number(str(q, "unconfirmedAfterDays") ?? 3) || 3));
    const products = await this.productInventory(organizationId, {});
    const now = new Date();
    const [expiring, unconfirmed, held, discrepancies] = await Promise.all([
      prisma.inventoryBalance.findMany({
        where: { organizationId, OR: [{ onHand: { gt: 0 } }, { quarantined: { gt: 0 } }], batch: { expiryDate: { not: null, lte: new Date(now.getTime() + days * 86_400_000) } } },
        include: balanceInclude,
      }),
      prisma.shipment.findMany({ where: { receiverOrganizationId: organizationId, status: { in: ["DISPATCHED", "PARTIALLY_RECEIVED"] }, dispatchedAt: { lte: new Date(now.getTime() - staleDays * 86_400_000) } }, select: { id: true, reference: true, status: true, dispatchedAt: true, senderOrganizationId: true } }),
      prisma.inventoryBalance.findMany({ where: { organizationId, quarantined: { gt: 0 } }, include: balanceInclude }),
      prisma.inventoryDiscrepancy.findMany({ where: { organizationId, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return {
      parameters: { expiringWithinDays: days, unconfirmedAfterDays: staleDays },
      lowStock: products.filter((p) => p.lowStock).map((p) => ({ skuId: p.id, sku: p.sku, name: p.name, available: p.available, threshold: p.reorderThreshold, unitOfMeasure: p.unitOfMeasure })),
      expiring: expiring.map((b) => ({ ...presentBalance(b), expired: Boolean(b.batch?.expiryDate && b.batch.expiryDate < now) })),
      unconfirmedIncoming: unconfirmed,
      heldStock: held.map(presentBalance),
      discrepancies: discrepancies.map(({ detailsJson, ...d }) => ({ ...d, details: json(detailsJson) })),
    };
  }

  async flag(db: Db, d: { organizationId: string; type: string; severity: string; message: string; details?: Record<string, unknown>; skuId?: string | null; batchId?: string | null; balanceId?: string | null; shipmentId?: string | null; fingerprint: string }) {
    const existing = await db.inventoryDiscrepancy.findFirst({ where: { organizationId: d.organizationId, fingerprint: d.fingerprint, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
    if (existing) return existing;
    return db.inventoryDiscrepancy.create({
      data: { organizationId: d.organizationId, type: d.type, severity: d.severity, message: d.message, detailsJson: JSON.stringify(d.details ?? {}), skuId: d.skuId ?? null, batchId: d.batchId ?? null, balanceId: d.balanceId ?? null, shipmentId: d.shipmentId ?? null, fingerprint: d.fingerprint },
    });
  }

  async discrepancies(organizationId: string, q: Query) {
    const where = { organizationId, ...(str(q, "status") ? { status: str(q, "status") } : {}), ...(str(q, "type") ? { type: str(q, "type") } : {}) };
    const result = await paginate(q, () => prisma.inventoryDiscrepancy.count({ where }), (page) => prisma.inventoryDiscrepancy.findMany({ where, ...page, orderBy: { createdAt: "desc" } }));
    return { ...result, items: result.items.map(({ detailsJson, ...d }) => ({ ...d, details: json(detailsJson) })) };
  }

  async updateDiscrepancy(a: Actor, id: string, input: unknown) {
    requirePermission(a, "inventory:adjust");
    const data = z.object({ status: z.enum(["ACKNOWLEDGED", "RESOLVED"]), note: z.string().trim().min(3).max(1000) }).parse(input);
    const d = await prisma.inventoryDiscrepancy.findFirst({ where: { id, organizationId: a.organizationId } });
    if (!d) throw notFound("InventoryDiscrepancy", "DISCREPANCY_NOT_FOUND");
    const updated = await prisma.inventoryDiscrepancy.update({ where: { id }, data: { status: data.status, resolutionNote: data.note, ...(data.status === "RESOLVED" ? { resolvedById: a.userId, resolvedAt: new Date() } : {}) } });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: `INVENTORY_DISCREPANCY_${data.status}`, resourceType: "InventoryDiscrepancy", resourceId: id, metadata: { note: data.note }, ipHash: a.ipHash });
    return updated;
  }

  /**
   * Recomputes every balance bucket from the ledger and checks shipment quantities against their
   * ledger records. Never repairs anything — mismatches become discrepancies for people to review.
   */
  async reconcile(a: Actor) {
    const organizationId = a.organizationId;
    const [balances, sums] = await Promise.all([
      prisma.inventoryBalance.findMany({ where: { organizationId }, include: { batch: true } }),
      prisma.inventoryLedgerEntry.groupBy({ by: ["balanceId", "bucket"], where: { organizationId }, _sum: { delta: true } }),
    ]);
    const ledger = new Map(sums.map((s) => [`${s.balanceId}:${s.bucket}`, new D(s._sum.delta ?? 0)]));
    const findings: Array<{ type: string; message: string }> = [];
    for (const b of balances) {
      for (const bucket of BALANCE_BUCKETS) {
        const field = { ON_HAND: b.onHand, RESERVED: b.reserved, QUARANTINED: b.quarantined, DAMAGED: b.damaged }[bucket];
        const expected = ledger.get(`${b.id}:${bucket}`) ?? ZERO;
        if (!expected.equals(field)) {
          const message = `Balance ${b.id} ${bucket} is ${field} but the ledger totals ${expected}.`;
          findings.push({ type: "LEDGER_MISMATCH", message });
          await this.flag(prisma, { organizationId, type: "LEDGER_MISMATCH", severity: "CRITICAL", message, details: { bucket, cached: field.toString(), ledger: expected.toString() }, skuId: b.skuId, batchId: b.batchId, balanceId: b.id, fingerprint: `mismatch:${b.id}:${bucket}` });
        }
        if (new D(field).lt(0)) {
          findings.push({ type: "NEGATIVE_BALANCE", message: `Balance ${b.id} ${bucket} is negative.` });
          await this.flag(prisma, { organizationId, type: "NEGATIVE_BALANCE", severity: "CRITICAL", message: `Negative ${bucket} on balance ${b.id}.`, balanceId: b.id, fingerprint: `negative:${b.id}:${bucket}` });
        }
      }
      if (b.batch && b.batch.holdStatus !== "NONE" && new D(b.onHand).gt(0)) {
        const message = `Batch ${b.batch.batchCode} is ${b.batch.holdStatus.toLowerCase()} but ${b.onHand} ${b.unitOfMeasure} are still available at a location.`;
        findings.push({ type: "HELD_STOCK", message });
        await this.flag(prisma, { organizationId, type: "HELD_STOCK", severity: "HIGH", message, skuId: b.skuId, batchId: b.batchId, balanceId: b.id, fingerprint: `held:${b.id}` });
      }
    }
    // Shipment quantities vs. their ledger records (sender side).
    const shipments = await prisma.shipment.findMany({ where: { senderOrganizationId: organizationId, status: { notIn: ["DRAFT", "CANCELLED"] } }, include: { items: true } });
    for (const s of shipments) {
      const dispatchTypes = s.purpose === "RECALL_RETURN" ? ["RECALL_RETURN"] : ["DISPATCH"];
      const dispatched = await prisma.inventoryTransaction.aggregate({ where: { organizationId, shipmentId: s.id, type: { in: dispatchTypes }, fromLocationId: { not: null } }, _sum: { quantity: true } });
      const itemsDispatched = s.items.reduce((acc, i) => acc.plus(i.dispatchedQty), ZERO);
      if (!new D(dispatched._sum.quantity ?? 0).equals(itemsDispatched)) {
        const message = `Shipment ${s.reference}: items show ${itemsDispatched} dispatched but the ledger records ${dispatched._sum.quantity ?? 0}.`;
        findings.push({ type: "TRANSIT_MISMATCH", message });
        await this.flag(prisma, { organizationId, type: "TRANSIT_MISMATCH", severity: "HIGH", message, shipmentId: s.id, fingerprint: `transit:${s.id}` });
      }
    }
    await writeAudit({ organizationId, actorUserId: a.userId, action: "INVENTORY_RECONCILED", resourceType: "Organization", resourceId: organizationId, metadata: { balancesChecked: balances.length, shipmentsChecked: shipments.length, findings: findings.length }, ipHash: a.ipHash });
    return { balancesChecked: balances.length, shipmentsChecked: shipments.length, consistent: findings.length === 0, findings };
  }
}

export const inventoryService = new InventoryService();
export { INVENTORY_TX_TYPES, available };
