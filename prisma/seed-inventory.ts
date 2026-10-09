/**
 * Additive demo inventory for an already-seeded database (no reset, nothing deleted).
 * Runs every operation through the real inventory services, so ledgers, balances, provenance
 * events and blockchain proofs are genuine.
 *
 *   npm run db:seed:inventory
 */
import { config } from "../src/config.js";
import { prisma } from "../src/lib/prisma.js";
import type { Actor } from "../src/middleware/tenant.js";
import type { OrgRole } from "../src/lib/constants.js";
import { catalogueService } from "../src/services/inventory/catalogue.service.js";
import { inventoryService } from "../src/services/inventory/inventory.service.js";
import { shipmentService } from "../src/services/inventory/shipment.service.js";
import { warehouseService } from "../src/services/inventory/warehouse.service.js";

if (config.nodeEnv === "production") {
  console.error("Refusing to seed demo inventory in production.");
  process.exit(1);
}

async function actorFor(slug: string, email: string): Promise<Actor> {
  const org = await prisma.organization.findUnique({ where: { slug } });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!org || !user) throw new Error(`Run the base seed first (missing ${slug} / ${email}).`);
  const member = await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } } });
  return { userId: user.id, organizationId: org.id, role: member.role as OrgRole, ipHash: null };
}

async function main() {
  const abc = await actorFor("abc-pharma", "owner@abcpharma.local");
  if (await prisma.productSku.findUnique({ where: { organizationId_sku: { organizationId: abc.organizationId, sku: "OVX-05-DOSE" } } })) {
    console.log("Demo inventory already present.");
    return;
  }
  const health = await actorFor("healthplus-retail", "owner@healthplus.local");
  const metro = await actorFor("metrocare-warehouse", "owner@metrocare.local");
  const xyz = await actorFor("xyz-electronics", "owner@xyz.local");

  // Warehouses
  const abcDc = await warehouseService.create(abc, { code: "DEL-DC1", name: "Delhi Distribution Centre", city: "New Delhi", country: "IN", address: "Okhla Phase II" });
  const coldRoom = await warehouseService.addLocation(abc, abcDc!.id, { code: "COLD-01", zone: "Cold room", aisle: "1", shelf: "A" });
  const abcPlant = await warehouseService.create(abc, { code: "BAD-PLANT", name: "Baddi Plant Store", city: "Baddi", country: "IN" });
  const hpStore = await warehouseService.create(health, { code: "CP-STORE", name: "Connaught Place Store", city: "New Delhi", country: "IN" });
  const metroDc = await warehouseService.create(metro, { code: "GGN-DC", name: "Gurugram DC", city: "Gurugram", country: "IN" });
  const xyzWh = await warehouseService.create(xyz, { code: "BLR-WH", name: "Bengaluru Warehouse", city: "Bengaluru", country: "IN" });

  // Catalogue
  const vaccine = await catalogueService.createSku(abc, { sku: "OVX-05-DOSE", name: "OrigiVax Influenza Vaccine 0.5 ml", unitOfMeasure: "DOSE", category: "Vaccine", brand: "OrigiVax", description: "Inactivated quadrivalent influenza vaccine, pre-filled syringe." });
  const saline = await catalogueService.createSku(abc, { sku: "NS-500ML", name: "Normal Saline 0.9% 500 ml", unitOfMeasure: "L", category: "IV fluids", brand: "ABC Pharma" });
  const earbuds = await catalogueService.createSku(xyz, { sku: "AERO-X1", name: "Aero X1 Wireless Earbuds", unitOfMeasure: "PCS", category: "Audio", brand: "XYZ" });

  // Batches (through the existing /batches resource) + batch passports
  const mkBatch = async (a: Actor, skuId: string, code: string, made: string, expiry: string | null, planned: number) => {
    const batch = await prisma.productBatch.create({ data: { organizationId: a.organizationId, batchCode: code, name: code, manufacturedAt: new Date(made), expiryDate: expiry ? new Date(expiry) : null } });
    await catalogueService.updateBatch(a, batch.id, { skuId, plannedQuantity: planned, qualityStatus: "APPROVED" });
    return batch;
  };
  const a95 = await mkBatch(abc, vaccine.id, "A95", "2026-09-01", "2027-08-31", 5000);
  await catalogueService.createBatchPassport(abc, a95.id, { originCountry: "IN", originLocation: "Delhi, India" });
  const a96 = await mkBatch(abc, vaccine.id, "A96", "2026-09-20", "2026-11-15", 2000);
  await catalogueService.createBatchPassport(abc, a96.id, { originCountry: "IN", originLocation: "Delhi, India" });
  const s14 = await mkBatch(abc, saline.id, "S14", "2026-08-10", "2028-08-09", 800);
  const x7 = await mkBatch(xyz, earbuds.id, "AX1-L7", "2026-08-12", null, 1500);

  // Production receipts
  const cold = coldRoom!.id;
  const main = (w: { locations: Array<{ id: string; code: string }> } | undefined) => w!.locations.find((l) => l.code === "MAIN")!.id;
  await inventoryService.recordMovement(abc, { type: "RECEIPT", skuId: vaccine.id, batchId: a95.id, locationId: cold, quantity: 5000 });
  await inventoryService.recordMovement(abc, { type: "RECEIPT", skuId: vaccine.id, batchId: a96.id, locationId: cold, quantity: 2000 });
  await inventoryService.recordMovement(abc, { type: "RECEIPT", skuId: saline.id, batchId: s14.id, locationId: main(abcPlant), quantity: "780.5" });
  await inventoryService.recordMovement(xyz, { type: "OPENING_BALANCE", skuId: earbuds.id, batchId: x7.id, locationId: main(xyzWh), quantity: 1450 });
  await inventoryService.recordMovement(abc, { type: "DAMAGE", skuId: vaccine.id, batchId: a95.id, locationId: cold, quantity: 12, reason: "Syringe plungers cracked during QC handling" });

  // Shipment ABC → HealthPlus (customer partner): dispatched, partially received with damage.
  const s1 = await shipmentService.create(abc, { receiverOrganizationId: health.organizationId, originWarehouseId: abcDc!.id, items: [{ skuId: vaccine.id, batchId: a95.id, fromLocationId: cold, quantity: 600 }], notes: "Cold chain 2–8 °C", transferCustody: false });
  await shipmentService.reserve(abc, s1.id);
  await shipmentService.dispatch(abc, s1.id);
  await shipmentService.receive(health, s1.id, { locationId: main(hpStore), items: [{ itemId: s1.items![0].id, receivedQty: 480, damagedQty: 10 }] });

  // Shipment ABC → HealthPlus awaiting dispatch (reserved) and one draft.
  const s2 = await shipmentService.create(abc, { receiverOrganizationId: health.organizationId, originWarehouseId: abcDc!.id, items: [{ skuId: vaccine.id, batchId: a96.id, fromLocationId: cold, quantity: 400 }] });
  await shipmentService.reserve(abc, s2.id);
  await shipmentService.create(abc, { receiverOrganizationId: health.organizationId, originWarehouseId: abcDc!.id, items: [{ skuId: vaccine.id, batchId: a95.id, fromLocationId: cold, quantity: 250 }], notes: "Draft for next week" });

  // HealthPlus sells to consumers (external dispatch) — leaves the recorded network.
  await inventoryService.recordMovement(health, { type: "DISPATCH", skuId: vaccine.id, batchId: a95.id, locationId: main(hpStore), quantity: 35, reason: "Retail sales, week 41" });

  // Reorder thresholds explicitly configured by each organization.
  await catalogueService.setReorderRule(abc, saline.id, { threshold: 1000 });
  await catalogueService.setReorderRule(health, vaccine.id, { threshold: 500 });

  console.log("Demo inventory created:");
  console.table((await prisma.inventoryBalance.findMany({ include: { sku: true, batch: true, location: { include: { warehouse: true } } } })).map((b) => ({ org: b.organizationId.slice(-6), warehouse: b.location.warehouse.code, location: b.location.code, sku: b.sku.sku, batch: b.batch?.batchCode ?? "—", onHand: b.onHand.toString(), reserved: b.reserved.toString(), damaged: b.damaged.toString(), unit: b.unitOfMeasure })));
  void metroDc;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
