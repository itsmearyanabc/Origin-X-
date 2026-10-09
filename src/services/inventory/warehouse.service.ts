import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import type { Actor } from "../../middleware/tenant.js";
import { writeAudit } from "../audit.service.js";
import { presentBalance } from "./ledger.js";

const code = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9._\-]*$/, "Letters, digits and . _ - only.");
const warehouseSchema = z.object({
  code,
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  country: z.string().trim().max(60).optional(),
});
const locationSchema = z.object({
  code,
  zone: z.string().trim().max(40).optional(),
  aisle: z.string().trim().max(40).optional(),
  shelf: z.string().trim().max(40).optional(),
  bin: z.string().trim().max(40).optional(),
});

function conflict(error: unknown, message: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AppError("CODE_IN_USE", message, 409);
  throw error;
}

export class WarehouseService {
  async list(organizationId: string) {
    const warehouses = await prisma.warehouse.findMany({
      where: { organizationId },
      orderBy: { code: "asc" },
      include: { locations: { orderBy: { code: "asc" } } },
    });
    const totals = await prisma.inventoryBalance.groupBy({
      by: ["warehouseId"],
      where: { organizationId },
      _count: { _all: true },
    });
    const count = new Map(totals.map((t) => [t.warehouseId, t._count._all]));
    return warehouses.map((w) => ({ ...w, balanceCount: count.get(w.id) ?? 0 }));
  }

  /** Every warehouse gets a default "MAIN" location so stock always has a place. */
  async create(a: Actor, input: unknown) {
    const data = warehouseSchema.parse(input);
    try {
      const warehouse = await prisma.warehouse.create({
        data: { ...data, organizationId: a.organizationId, locations: { create: { code: "MAIN", organizationId: a.organizationId } } },
        include: { locations: true },
      });
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "WAREHOUSE_CREATED", resourceType: "Warehouse", resourceId: warehouse.id, metadata: { code: data.code }, ipHash: a.ipHash });
      return warehouse;
    } catch (error) {
      conflict(error, "A warehouse with this code already exists.");
    }
  }

  async get(organizationId: string, id: string) {
    const warehouse = await prisma.warehouse.findFirst({ where: { id, organizationId }, include: { locations: { orderBy: { code: "asc" } } } });
    if (!warehouse) throw notFound("Warehouse");
    const balances = await prisma.inventoryBalance.findMany({
      where: { organizationId, warehouseId: id },
      include: { sku: { select: { id: true, sku: true, name: true } }, batch: { select: { id: true, batchCode: true, holdStatus: true, expiryDate: true } }, location: { select: { id: true, code: true } } },
      orderBy: { updatedAt: "desc" },
    });
    return { ...warehouse, balances: balances.map(presentBalance) };
  }

  async update(a: Actor, id: string, input: unknown) {
    const patch = warehouseSchema.omit({ code: true }).extend({ status: z.enum(["ACTIVE", "INACTIVE"]) }).partial().parse(input);
    const warehouse = await prisma.warehouse.findFirst({ where: { id, organizationId: a.organizationId } });
    if (!warehouse) throw notFound("Warehouse");
    if (patch.status === "INACTIVE") {
      const stock = await prisma.inventoryBalance.findFirst({ where: { warehouseId: id, OR: [{ onHand: { gt: 0 } }, { quarantined: { gt: 0 } }, { damaged: { gt: 0 } }] } });
      if (stock) throw new AppError("WAREHOUSE_HAS_STOCK", "Move or resolve all stock before deactivating this warehouse.", 409);
    }
    const updated = await prisma.warehouse.update({ where: { id }, data: patch });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "WAREHOUSE_UPDATED", resourceType: "Warehouse", resourceId: id, metadata: { fields: Object.keys(patch) }, ipHash: a.ipHash });
    return updated;
  }

  async addLocation(a: Actor, warehouseId: string, input: unknown) {
    const data = locationSchema.parse(input);
    const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, organizationId: a.organizationId } });
    if (!warehouse) throw notFound("Warehouse");
    try {
      const location = await prisma.storageLocation.create({ data: { ...data, warehouseId, organizationId: a.organizationId } });
      await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "LOCATION_CREATED", resourceType: "StorageLocation", resourceId: location.id, metadata: { warehouseId, code: data.code }, ipHash: a.ipHash });
      return location;
    } catch (error) {
      conflict(error, "A location with this code already exists in this warehouse.");
    }
  }

  async updateLocation(a: Actor, id: string, input: unknown) {
    const patch = locationSchema.omit({ code: true }).extend({ status: z.enum(["ACTIVE", "INACTIVE"]) }).partial().parse(input);
    const location = await prisma.storageLocation.findFirst({ where: { id, organizationId: a.organizationId } });
    if (!location) throw notFound("StorageLocation", "LOCATION_NOT_FOUND");
    if (patch.status === "INACTIVE") {
      const stock = await prisma.inventoryBalance.findFirst({ where: { locationId: id, OR: [{ onHand: { gt: 0 } }, { quarantined: { gt: 0 } }, { damaged: { gt: 0 } }] } });
      if (stock) throw new AppError("LOCATION_HAS_STOCK", "Move or resolve all stock before deactivating this location.", 409);
    }
    const updated = await prisma.storageLocation.update({ where: { id }, data: patch });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "LOCATION_UPDATED", resourceType: "StorageLocation", resourceId: id, metadata: { fields: Object.keys(patch) }, ipHash: a.ipHash });
    return updated;
  }
}

export const warehouseService = new WarehouseService();
