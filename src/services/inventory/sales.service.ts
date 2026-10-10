import { randomUUID } from "node:crypto";
import { Prisma, type ProductEvent } from "@prisma/client";
import { z } from "zod";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../middleware/tenant.js";
import { hasPermission } from "../../middleware/tenant.js";
import { writeAudit } from "../audit.service.js";
import { assertBatchDispatchable, getOwnedLocation, resolveSkuBatch } from "./access.js";
import { D, ensureBalance, parseQuantity, postTransaction, runIdempotent } from "./ledger.js";
import { anchorAfterCommit, publicPlace, recordInventoryEvent } from "./provenance.js";

const schema = z.object({
  customerName: z.string().trim().min(2).max(160),
  reference: z.string().trim().min(2).max(80).optional(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).default("INR"),
  items: z.array(z.object({ skuId: z.string().min(1), batchId: z.string().min(1).nullable().optional(), locationId: z.string().min(1), quantity: z.union([z.string(), z.number()]), unitPrice: z.union([z.string(), z.number()]) })).min(1).max(50),
});

const include = { items: { include: { inventoryTransaction: { select: { id: true, createdAt: true } } } } } satisfies Prisma.SaleInclude;

export class SalesService {
  async list(organizationId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, page || 1);
    const safeSize = Math.min(100, Math.max(1, pageSize || 20));
    const [total, items] = await Promise.all([
      prisma.sale.count({ where: { organizationId } }),
      prisma.sale.findMany({ where: { organizationId }, include, orderBy: { soldAt: "desc" }, skip: (safePage - 1) * safeSize, take: safeSize }),
    ]);
    return { items: items.map(presentSale), meta: { total, page: safePage, pageSize: safeSize, pageCount: Math.max(1, Math.ceil(total / safeSize)) } };
  }

  async create(actor: Actor, raw: unknown, idempotencyKey?: string) {
    if (!hasPermission(actor.role, "inventory:dispatch")) throw forbidden(`Your role (${actor.role}) does not allow inventory:dispatch.`);
    const data = schema.parse(raw);
    if (!idempotencyKey) throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "A unique Idempotency-Key is required for sales.", 422);
    const reference = data.reference || `SALE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    return runIdempotent(actor.organizationId, idempotencyKey, "sale:create", async (tx) => {
      const sale = await tx.sale.create({ data: { organizationId: actor.organizationId, reference, customerName: data.customerName, currency: data.currency, createdById: actor.userId } });
      const events: Array<ProductEvent | null> = [];
      const items = [];
      for (const item of data.items) {
        const { sku, batch } = await resolveSkuBatch(actor.organizationId, item.skuId, item.batchId, tx);
        const quantity = parseQuantity(item.quantity, sku.unitOfMeasure);
        let unitPrice: Prisma.Decimal;
        try { unitPrice = new D(item.unitPrice); } catch { throw new AppError("INVALID_PRICE", "Unit price must be a valid amount.", 422); }
        if (!unitPrice.isFinite() || unitPrice.lte(0) || unitPrice.decimalPlaces() > 2 || unitPrice.gt("9999999999999999")) throw new AppError("INVALID_PRICE", "Unit price must be positive and support at most 2 decimal places.", 422);
        assertBatchDispatchable(batch);
        const location = await getOwnedLocation(actor.organizationId, item.locationId, tx);
        const balance = await ensureBalance(tx, { organizationId: actor.organizationId, locationId: location.id, skuId: sku.id, batchId: batch?.id ?? null, unitOfMeasure: sku.unitOfMeasure });
        const transaction = await postTransaction(tx, {
          organizationId: actor.organizationId, type: "DISPATCH", skuId: sku.id, batchId: batch?.id ?? null,
          unitOfMeasure: sku.unitOfMeasure, quantity, fromWarehouseId: location.warehouseId, fromLocationId: location.id,
          reason: `Sale ${reference}`, actorUserId: actor.userId,
        }, [{ balanceId: balance.id, bucket: "ON_HAND", delta: quantity.neg() }]);
        const lineTotal = unitPrice.mul(quantity).toDecimalPlaces(2);
        if (lineTotal.gt("999999999999999999.99")) throw new AppError("SALE_TOTAL_TOO_LARGE", "This sale line exceeds the supported amount.", 422);
        const line = await tx.saleItem.create({ data: {
          saleId: sale.id, skuId: sku.id, batchId: batch?.id ?? null, warehouseId: location.warehouseId,
          locationId: location.id, inventoryTransactionId: transaction.id, sku: sku.sku,
          productName: sku.name, unitOfMeasure: sku.unitOfMeasure, quantity, unitPrice, lineTotal,
        } });
        items.push(line);
        events.push(await recordInventoryEvent(tx, { batch, organizationId: actor.organizationId, actorUserId: actor.userId, eventType: "DISPATCHED", publicLocation: publicPlace(location.warehouse), metadata: { saleReference: reference, quantity: quantity.toString(), unitOfMeasure: sku.unitOfMeasure } }));
      }
      await writeAudit({ organizationId: actor.organizationId, actorUserId: actor.userId, action: "SALE_RECORDED", resourceType: "Sale", resourceId: sale.id, metadata: { reference, currency: data.currency, items: items.length }, ipHash: actor.ipHash }, tx);
      const result = { ...sale, items: items.map((line) => ({ ...line, quantity: line.quantity.toString(), unitPrice: line.unitPrice.toString(), lineTotal: line.lineTotal.toString() })), total: items.reduce((sum, line) => sum.plus(line.lineTotal), new D(0)).toString() };
      return { response: result, afterCommit: () => anchorAfterCommit(events, actor.ipHash) };
    });
  }

  async monitoring(organizationId: string, period: string) {
    const periodSpec = { "7d": [7, "day"], "30d": [30, "day"], "90d": [90, "week"], "12m": [365, "month"] } as const;
    if (!(period in periodSpec)) throw new AppError("INVALID_PERIOD", "Choose a supported sales period.", 400);
    const [days, bucket] = periodSpec[period as keyof typeof periodSpec];
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400000);
    const previousFrom = new Date(from.getTime() - days * 86400000);
    const [current, previous, trend, recent] = await Promise.all([
      prisma.sale.findMany({ where: { organizationId, soldAt: { gte: from, lt: to } }, include, orderBy: { soldAt: "desc" } }),
      prisma.sale.findMany({ where: { organizationId, soldAt: { gte: previousFrom, lt: from } }, include }),
      prisma.$queryRaw<Array<{ period: Date; currency: string; revenue: string; orders: number }>>(Prisma.sql`
        SELECT date_trunc(${bucket}, s."soldAt") AS period, s.currency, SUM(i."lineTotal")::text AS revenue, COUNT(DISTINCT s.id)::int AS orders
        FROM "Sale" s JOIN "SaleItem" i ON i."saleId" = s.id
        WHERE s."organizationId" = ${organizationId} AND s."soldAt" >= ${from} AND s."soldAt" < ${to}
        GROUP BY 1, 2 ORDER BY 1 ASC`),
      prisma.sale.findMany({ where: { organizationId }, include, orderBy: { soldAt: "desc" }, take: 8 }),
    ]);
    const summarize = (sales: typeof current) => {
      const map = new Map<string, { revenue: Prisma.Decimal; orders: number; units: Prisma.Decimal }>();
      for (const sale of sales) {
        const total = sale.items.reduce((sum, item) => sum.plus(item.lineTotal), new D(0));
        const units = sale.items.reduce((sum, item) => sum.plus(item.quantity), new D(0));
        const old = map.get(sale.currency) ?? { revenue: new D(0), orders: 0, units: new D(0) };
        map.set(sale.currency, { revenue: old.revenue.plus(total), orders: old.orders + 1, units: old.units.plus(units) });
      }
      return [...map].map(([currency, value]) => ({ currency, revenue: value.revenue.toString(), orders: value.orders, units: value.units.toString() }));
    };
    const products = new Map<string, { skuId: string; sku: string; name: string; unitOfMeasure: string; quantity: Prisma.Decimal; revenue: Prisma.Decimal; currency: string }>();
    for (const sale of current) for (const item of sale.items) {
      const key = `${item.skuId}:${sale.currency}`;
      const old = products.get(key) ?? { skuId: item.skuId, sku: item.sku, name: item.productName, unitOfMeasure: item.unitOfMeasure, quantity: new D(0), revenue: new D(0), currency: sale.currency };
      products.set(key, { ...old, quantity: old.quantity.plus(item.quantity), revenue: old.revenue.plus(item.lineTotal) });
    }
    return { period, from: from.toISOString(), to: to.toISOString(), previousFrom: previousFrom.toISOString(), totals: summarize(current), previousTotals: summarize(previous), trend: trend.map((row) => ({ ...row, period: row.period.toISOString(), orders: Number(row.orders) })), orders: current.length, topProducts: [...products.values()].sort((a, b) => b.revenue.comparedTo(a.revenue)).slice(0, 8).map((p) => ({ ...p, quantity: p.quantity.toString(), revenue: p.revenue.toString() })), recent: recent.map(presentSale) };
  }
}

function presentSale(sale: Prisma.SaleGetPayload<{ include: typeof include }>) {
  const { items, ...header } = sale;
  return { ...header, items: items.map(({ inventoryTransaction, ...item }) => ({ ...item, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), lineTotal: item.lineTotal.toString(), inventoryTransaction })) };
}

export const salesService = new SalesService();
