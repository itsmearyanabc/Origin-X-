import type { Prisma } from "@prisma/client";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { prisma, type Db } from "../../lib/prisma.js";

/**
 * Tenant read scope for catalogue data:
 *  - the brand organization that owns the SKU / batch,
 *  - organizations that hold (or held) stock of it,
 *  - organizations that are party to a shipment containing it.
 * Writes are always restricted to the owner.
 */
export function readableSkuWhere(organizationId: string): Prisma.ProductSkuWhereInput {
  return {
    OR: [{ organizationId }, { balances: { some: { organizationId } } }],
  };
}

export async function getReadableSku(organizationId: string, skuId: string, db: Db = prisma) {
  const sku = await db.productSku.findFirst({ where: { AND: [{ id: skuId }, readableSkuWhere(organizationId)] } });
  if (sku) return sku;
  // Party to a shipment that contains it (e.g. receiver before first receipt).
  const viaShipment = await db.shipmentItem.findFirst({
    where: { skuId, shipment: { OR: [{ senderOrganizationId: organizationId }, { receiverOrganizationId: organizationId }] } },
  });
  if (viaShipment) return db.productSku.findUniqueOrThrow({ where: { id: skuId } });
  throw notFound("ProductSku", "SKU_NOT_FOUND");
}

export async function getOwnedSku(organizationId: string, skuId: string, db: Db = prisma) {
  const sku = await db.productSku.findFirst({ where: { id: skuId, organizationId } });
  if (!sku) throw notFound("ProductSku", "SKU_NOT_FOUND");
  return sku;
}

export async function getReadableBatch(organizationId: string, batchId: string, db: Db = prisma) {
  const batch = await db.productBatch.findFirst({
    where: {
      id: batchId,
      OR: [{ organizationId }, { balances: { some: { organizationId } } }, { shipmentItems: { some: { shipment: { OR: [{ senderOrganizationId: organizationId }, { receiverOrganizationId: organizationId }] } } } }],
    },
  });
  if (!batch) throw notFound("ProductBatch", "BATCH_NOT_FOUND");
  return batch;
}

export async function getOwnedLocation(organizationId: string, locationId: string, db: Db = prisma) {
  const location = await db.storageLocation.findFirst({ where: { id: locationId, organizationId }, include: { warehouse: true } });
  if (!location) throw notFound("StorageLocation", "LOCATION_NOT_FOUND");
  if (location.status !== "ACTIVE" || location.warehouse.status !== "ACTIVE") {
    throw new AppError("LOCATION_INACTIVE", "This storage location or its warehouse is inactive.", 409);
  }
  return location;
}

/** Batch is part of the SKU (or the stock is SKU-level). */
export async function resolveSkuBatch(organizationId: string, skuId: string, batchId: string | null | undefined, db: Db = prisma) {
  const sku = await getReadableSku(organizationId, skuId, db);
  if (!batchId) return { sku, batch: null };
  const batch = await getReadableBatch(organizationId, batchId, db);
  if (batch.skuId !== sku.id) throw new AppError("BATCH_SKU_MISMATCH", "This batch does not belong to the selected SKU.", 422);
  return { sku, batch };
}

/** Ordinary dispatch / reservation is blocked for held or quality-rejected batches. */
export function assertBatchDispatchable(batch: { batchCode: string; holdStatus: string; qualityStatus: string } | null) {
  if (!batch) return;
  if (batch.holdStatus !== "NONE") {
    throw new AppError("BATCH_ON_HOLD", `Batch ${batch.batchCode} is ${batch.holdStatus.toLowerCase()} and cannot be dispatched.`, 409);
  }
  if (batch.qualityStatus === "REJECTED") {
    throw new AppError("BATCH_QUALITY_REJECTED", `Batch ${batch.batchCode} failed quality approval and cannot be dispatched.`, 409);
  }
}

export function assertOwner(resourceOrgId: string, organizationId: string, what: string) {
  if (resourceOrgId !== organizationId) throw forbidden(`Only the owning organization can change this ${what}.`, "NOT_OWNER");
}
