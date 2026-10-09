/**
 * Inventory ledger core.
 *
 * Every stock change is a transaction header + signed bucket deltas ("entries") on balances.
 * Entries are the auditable source of truth; InventoryBalance rows are a cache that is updated in
 * the same database transaction and checked by reconciliation.
 *
 * Concurrency: balance rows are locked with SELECT … FOR UPDATE (sorted, to avoid deadlocks)
 * before invariants are checked, so concurrent dispatches cannot overspend stock. A database
 * CHECK constraint is the last line of defence (no negative bucket, reserved ≤ onHand).
 */
import { Prisma, type InventoryBalance } from "@prisma/client";
import { UNITS_OF_MEASURE, type BalanceBucket, type InventoryTxType } from "../../lib/constants.js";
import { AppError } from "../../lib/errors.js";
import { prisma, type Db } from "../../lib/prisma.js";

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export const ZERO = new D(0);

const FIELD: Record<BalanceBucket, "onHand" | "reserved" | "quarantined" | "damaged"> = {
  ON_HAND: "onHand",
  RESERVED: "reserved",
  QUARANTINED: "quarantined",
  DAMAGED: "damaged",
};

/** Parses a client quantity into an exact decimal, enforcing the unit's precision. */
export function parseQuantity(raw: unknown, unit: string, field = "quantity"): Dec {
  let value: Dec;
  try {
    value = new D(typeof raw === "number" || typeof raw === "string" ? raw : NaN);
  } catch {
    throw new AppError("INVALID_QUANTITY", `${field} must be a number.`, 422);
  }
  if (!value.isFinite() || value.lte(0)) throw new AppError("INVALID_QUANTITY", `${field} must be greater than zero.`, 422);
  if (value.decimalPlaces() > 4) throw new AppError("INVALID_QUANTITY", `${field} supports at most 4 decimal places.`, 422);
  const fractional = UNITS_OF_MEASURE[unit as keyof typeof UNITS_OF_MEASURE]?.fractional ?? false;
  if (!fractional && !value.isInteger()) throw new AppError("INVALID_QUANTITY", `${field} must be a whole number for unit ${unit}.`, 422);
  if (value.gt("999999999999")) throw new AppError("INVALID_QUANTITY", `${field} is too large.`, 422);
  return value;
}

/** Same, but zero is allowed (receipt lines may record 0 damaged / 0 missing). */
export function parseQuantityOrZero(raw: unknown, unit: string, field: string): Dec {
  if (raw === undefined || raw === null || raw === "" || raw === 0 || raw === "0") return ZERO;
  return parseQuantity(raw, unit, field);
}

export const available = (b: Pick<InventoryBalance, "onHand" | "reserved">) => new D(b.onHand).minus(b.reserved);

export type BalanceKey = { organizationId: string; locationId: string; skuId: string; batchId: string | null; unitOfMeasure: string };

/** Finds or creates the balance row for a key (inside the caller's transaction). */
export async function ensureBalance(tx: Db, key: BalanceKey): Promise<InventoryBalance> {
  const batchKey = key.batchId ?? "";
  const where = { organizationId_locationId_skuId_batchKey: { organizationId: key.organizationId, locationId: key.locationId, skuId: key.skuId, batchKey } };
  const existing = await tx.inventoryBalance.findUnique({ where });
  if (existing) {
    if (existing.unitOfMeasure !== key.unitOfMeasure) {
      throw new AppError("UNIT_MISMATCH", `Stock at this location is tracked in ${existing.unitOfMeasure}, not ${key.unitOfMeasure}.`, 422);
    }
    return existing;
  }
  const location = await tx.storageLocation.findUniqueOrThrow({ where: { id: key.locationId } });
  // INSERT … ON CONFLICT DO NOTHING keeps concurrent first-receipts from aborting the transaction.
  await tx.$executeRaw`
    INSERT INTO "InventoryBalance" ("id", "organizationId", "warehouseId", "locationId", "skuId", "batchId", "batchKey", "unitOfMeasure", "updatedAt")
    VALUES (${`bal_${crypto.randomUUID().replace(/-/g, "")}`}, ${key.organizationId}, ${location.warehouseId}, ${key.locationId}, ${key.skuId}, ${key.batchId}, ${batchKey}, ${key.unitOfMeasure}, now())
    ON CONFLICT ("organizationId", "locationId", "skuId", "batchKey") DO NOTHING`;
  return tx.inventoryBalance.findUniqueOrThrow({ where });
}

export type Delta = { balanceId: string; bucket: BalanceBucket; delta: Dec };

export type TxHeader = {
  organizationId: string;
  type: InventoryTxType;
  skuId: string;
  batchId: string | null;
  unitOfMeasure: string;
  quantity: Dec;
  fromWarehouseId?: string | null;
  fromLocationId?: string | null;
  toWarehouseId?: string | null;
  toLocationId?: string | null;
  shipmentId?: string | null;
  shipmentItemId?: string | null;
  reservationId?: string | null;
  incidentId?: string | null;
  recallId?: string | null;
  productEventId?: string | null;
  correlationId?: string | null;
  reason?: string | null;
  actorUserId?: string | null;
  idempotencyKey?: string | null;
};

/** Locks the given balance rows in a stable order and returns them keyed by id. */
export async function lockBalances(tx: Db, ids: string[]) {
  const unique = [...new Set(ids)].sort();
  if (unique.length) await tx.$queryRaw`SELECT "id" FROM "InventoryBalance" WHERE "id" IN (${Prisma.join(unique)}) ORDER BY "id" FOR UPDATE`;
  const rows = await tx.inventoryBalance.findMany({ where: { id: { in: unique } } });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Applies deltas atomically and writes the immutable ledger record.
 * Throws INSUFFICIENT_STOCK if any bucket would go negative or reservations would exceed on-hand.
 */
export async function postTransaction(tx: Db, header: TxHeader, deltas: Delta[]) {
  const balances = await lockBalances(tx, deltas.map((d) => d.balanceId));
  const next = new Map<string, Record<string, Dec>>();
  for (const d of deltas) {
    const bal = balances.get(d.balanceId);
    if (!bal) throw new AppError("BALANCE_NOT_FOUND", "Inventory balance not found.", 404);
    if (bal.organizationId !== header.organizationId) throw new AppError("FORBIDDEN", "Balance belongs to another organization.", 403);
    const state = next.get(d.balanceId) ?? { onHand: new D(bal.onHand), reserved: new D(bal.reserved), quarantined: new D(bal.quarantined), damaged: new D(bal.damaged) };
    state[FIELD[d.bucket]] = state[FIELD[d.bucket]].plus(d.delta);
    next.set(d.balanceId, state);
  }
  for (const [id, s] of next) {
    const negative = Object.entries(s).find(([, v]) => v.lt(0));
    if (negative || s.reserved.gt(s.onHand)) {
      const bal = balances.get(id)!;
      throw new AppError(
        "INSUFFICIENT_STOCK",
        negative
          ? `Not enough ${negative[0] === "onHand" ? "available" : negative[0]} stock for this ${header.type.toLowerCase().replace(/_/g, " ")}.`
          : "Reservations would exceed on-hand stock.",
        409,
        { balanceId: id, onHand: bal.onHand.toString(), reserved: bal.reserved.toString(), available: available(bal).toString(), quarantined: bal.quarantined.toString(), damaged: bal.damaged.toString() },
      );
    }
  }
  for (const [id, s] of next) {
    await tx.inventoryBalance.update({ where: { id }, data: { onHand: s.onHand, reserved: s.reserved, quarantined: s.quarantined, damaged: s.damaged } });
  }
  try {
    return await tx.inventoryTransaction.create({
      data: {
        ...header,
        quantity: header.quantity,
        entries: { create: deltas.filter((d) => !d.delta.isZero()).map((d) => ({ organizationId: header.organizationId, balanceId: d.balanceId, bucket: d.bucket, delta: d.delta })) },
      },
      include: { entries: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("DUPLICATE_REQUEST", "This operation was already processed (idempotency key reused).", 409);
    }
    throw error;
  }
}

/**
 * Runs an operation at most once per (organization, Idempotency-Key). The record is written in the
 * same DB transaction as the work, so concurrent retries cannot both succeed; a retry after success
 * receives the original response.
 */
export async function runIdempotent<T>(
  organizationId: string,
  key: string | undefined | null,
  operation: string,
  work: (tx: Db) => Promise<{ response: T; afterCommit?: () => Promise<void> }>,
): Promise<T & { idempotentReplay?: boolean }> {
  if (key && (key.length < 8 || key.length > 128)) throw new AppError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8–128 characters.", 422);
  const replay = async () => {
    if (!key) return null;
    const existing = await prisma.idempotencyRecord.findUnique({ where: { organizationId_key: { organizationId, key } } });
    if (!existing) return null;
    if (existing.operation !== operation) throw new AppError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for a different operation.", 409);
    return { ...(JSON.parse(existing.responseJson) as T), idempotentReplay: true };
  };
  const first = await replay();
  if (first) return first;
  let afterCommit: (() => Promise<void>) | undefined;
  try {
    const response = await prisma.$transaction(
      async (tx) => {
        const result = await work(tx);
        afterCommit = result.afterCommit;
        if (key) await tx.idempotencyRecord.create({ data: { organizationId, key, operation, responseJson: JSON.stringify(result.response) } });
        return result.response;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    if (afterCommit) await afterCommit();
    return response as T & { idempotentReplay?: boolean };
  } catch (error) {
    if (key && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await replay();
      if (again) return again;
      throw new AppError("REQUEST_IN_PROGRESS", "An identical request is still being processed. Retry shortly.", 409);
    }
    throw error;
  }
}

/** Serializes balances for API responses (Decimals as strings + derived available). */
export function presentBalance<T extends InventoryBalance>(b: T) {
  return {
    ...b,
    onHand: b.onHand.toString(),
    reserved: b.reserved.toString(),
    quarantined: b.quarantined.toString(),
    damaged: b.damaged.toString(),
    available: available(b).toString(),
  };
}
