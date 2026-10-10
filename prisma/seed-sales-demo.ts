/** Additive demo sales and map pins for the seeded HealthPlus test tenant. Never runs in production. */
import "../scripts/assert-local-db.js";
import { config } from "../src/config.js";
import { prisma } from "../src/lib/prisma.js";
import type { Actor } from "../src/middleware/tenant.js";
import type { OrgRole } from "../src/lib/constants.js";
import { salesService } from "../src/services/inventory/sales.service.js";

if (config.nodeEnv === "production") {
  console.error("Refusing to seed demo sales in production.");
  process.exit(1);
}

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: "healthplus-retail" } });
  const user = await prisma.user.findUnique({ where: { email: "owner@healthplus.local" } });
  if (!org || !user) throw new Error("Run `npm run db:seed` first to create the demo test user.");
  const member = await prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } } });
  const actor: Actor = { userId: user.id, organizationId: org.id, role: member.role as OrgRole, ipHash: null };

  const pins = [
    ["abc-pharma", "DEL-DC1", 28.5355, 77.2732],
    ["abc-pharma", "BAD-PLANT", 30.9578, 76.7914],
    ["healthplus-retail", "CP-STORE", 28.6315, 77.2167],
    ["metrocare-warehouse", "GGN-DC", 28.4595, 77.0266],
    ["xyz-electronics", "BLR-WH", 12.9716, 77.5946],
  ] as const;
  for (const [slug, code, latitude, longitude] of pins) {
    const owner = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
    if (owner) await prisma.warehouse.updateMany({ where: { organizationId: owner.id, code, latitude: null, longitude: null }, data: { latitude, longitude } });
  }

  const sku = await prisma.productSku.findFirst({ where: { sku: "OVX-05-DOSE" } });
  const warehouse = await prisma.warehouse.findFirst({ where: { organizationId: org.id, code: "CP-STORE" }, include: { locations: { where: { code: "MAIN" } } } });
  // Batch A95 is owned by ABC Pharma; resolve by the demo batch code and SKU instead of tenant.
  const sharedBatch = await prisma.productBatch.findFirst({ where: { batchCode: "A95", skuId: sku?.id } });
  if (!sku || !warehouse?.locations[0] || !sharedBatch) throw new Error("Run `npm run db:seed:inventory` first to create HealthPlus stock.");
  const balance = await prisma.inventoryBalance.findFirst({ where: { organizationId: org.id, locationId: warehouse.locations[0].id, skuId: sku.id, batchId: sharedBatch.id } });
  if (!balance) throw new Error("HealthPlus demo stock is missing; receive stock first.");

  const samples = [
    { reference: "DEMO-SALE-1", customerName: "Demo Customer · Connaught Place", quantity: 2, unitPrice: "1299.00" },
    { reference: "DEMO-SALE-2", customerName: "Demo Customer · Karol Bagh", quantity: 3, unitPrice: "1249.00" },
    { reference: "DEMO-SALE-3", customerName: "Demo Customer · South Delhi Clinic", quantity: 4, unitPrice: "1350.00" },
  ];
  let created = 0;
  let available = balance.onHand.minus(balance.reserved);
  for (const [index, sample] of samples.entries()) {
    if (await prisma.sale.findUnique({ where: { organizationId_reference: { organizationId: org.id, reference: sample.reference } } })) continue;
    if (available.lt(sample.quantity)) throw new Error(`HealthPlus demo stock is too low for ${sample.reference}.`);
    await salesService.create(actor, { ...sample, currency: "INR", items: [{ skuId: sku.id, batchId: sharedBatch.id, locationId: warehouse.locations[0].id, quantity: sample.quantity, unitPrice: sample.unitPrice }] }, `seed-healthplus-sale-${index + 1}-20261010`);
    available = available.minus(sample.quantity);
    created++;
  }
  console.log(`Added ${created} demo sale(s); missing warehouse map pins were filled. Demo test tenant: ${org.name}.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
