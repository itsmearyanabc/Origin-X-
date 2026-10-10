/**
 * Showcase tenants for live demos (e.g. hackathon judging) — runnable in production on purpose.
 *
 *   docker compose -f docker-compose.prod.yml run --rm -e SHOWCASE_PASSWORD='…' api \
 *     node dist/cli/seed-showcase.js --confirm
 *
 * Unlike prisma/seed.ts (local development only), this creates a small, clearly labelled set of
 * fictional "(Demo)" organizations through the real ORIGINX services: every passport, hash-chained
 * event, custody handoff, recall, counterfeit collision, stock movement and sale is processed by
 * the same code paths as real customers, and blockchain proofs are real transactions on the
 * configured chain (PENDING until a chain is configured — never faked). QR scans are genuine calls
 * to the public verification engine at run time; nothing is backdated except the business dates of
 * the demo supply-chain story.
 *
 * Idempotent: if the showcase already exists it only prints the accounts and verification links.
 * Remove later by suspending the "(Demo)" organizations in the admin console.
 */
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import type { EventType, OrgRole } from "../lib/constants.js";
import { canonicalIdentityHash, hashPassword } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import type { Actor } from "../middleware/tenant.js";
import { blockchainService } from "../services/blockchain.service.js";
import { custodyService } from "../services/custody.service.js";
import { eventService } from "../services/event.service.js";
import { catalogueService } from "../services/inventory/catalogue.service.js";
import { inventoryService } from "../services/inventory/inventory.service.js";
import { salesService } from "../services/inventory/sales.service.js";
import { shipmentService } from "../services/inventory/shipment.service.js";
import { warehouseService } from "../services/inventory/warehouse.service.js";
import { productService } from "../services/product.service.js";
import { recallService } from "../services/recall.service.js";
import { verificationService } from "../services/verification.service.js";

const MARKER_SLUG = "nova-pharma-demo";
const DONE_KEY = "showcase.completedAt";
/** Identities the showcase registers (product code + serial, or batch passport "batch:<code>"). */
const IDENTITIES: Array<[string, string]> = [["NVX-INF-05", "B21-000417"], ["NVX-INF-05", "B22-000088"], ["NVX-GLU-PEN", "C7-004512"], ["VW-AERO-X1", "AX1-7781-2201"], ["NVX-05-DOSE", "batch:B30"]];
const password = process.env.SHOWCASE_PASSWORD ?? "";

if (!process.argv.includes("--confirm")) {
  console.error("This writes clearly labelled demo organizations into the configured database. Re-run with --confirm.");
  process.exit(1);
}

const ORGS = [
  { slug: "nova-pharma-demo", name: "Nova Pharma (Demo)", type: "MANUFACTURER", industry: "Pharmaceuticals", city: "New Delhi", email: "owner@novapharma.example", owner: "Asha Mehra", plan: "GROWTH" },
  { slug: "swiftroute-logistics-demo", name: "SwiftRoute Logistics (Demo)", type: "LOGISTICS", industry: "Cold-chain logistics", city: "New Delhi", email: "owner@swiftroute.example", owner: "Nina Patel", plan: "STARTER" },
  { slug: "metrostore-warehousing-demo", name: "MetroStore Warehousing (Demo)", type: "WAREHOUSE", industry: "Healthcare distribution", city: "Gurugram", email: "owner@metrostore.example", owner: "Omar Siddiqui", plan: "STARTER" },
  { slug: "careplus-pharmacy-demo", name: "CarePlus Pharmacy (Demo)", type: "RETAILER", industry: "Pharmacy retail", city: "New Delhi", email: "owner@careplus.example", owner: "Priya Shah", plan: "STARTER" },
  { slug: "voltwear-electronics-demo", name: "VoltWear Electronics (Demo)", type: "BRAND", industry: "Consumer electronics", city: "Bengaluru", email: "owner@voltwear.example", owner: "Daniel Joseph", plan: "STARTER" },
  { slug: "unknown-traders-demo", name: "Unknown Traders (Demo)", type: "OTHER", industry: "Unverified seller", city: "Unverified", email: "owner@unknowntraders.example", owner: "Unverified Seller", plan: "FREE", unverified: true },
] as const;
const EXTRA_USERS = [
  { email: "manager@novapharma.example", name: "Neha Gupta", role: "ORG_MANAGER" as OrgRole },
  { email: "ops@novapharma.example", name: "Ravi Kumar", role: "ORG_OPERATOR" as OrgRole },
];

const now = Date.now();
const ago = (days: number, hours = 0) => new Date(now - days * 86_400_000 - hours * 3_600_000);
const iso = (d: Date) => d.toISOString();
const verifyUrl = (token: string) => `${config.publicVerifyBaseUrl}/${token}`;

async function printSummary() {
  const orgs = await prisma.organization.findMany({ where: { slug: { in: ORGS.map((o) => o.slug) } }, include: { members: { include: { user: { select: { email: true } } } } } });
  console.log("\nShowcase accounts (all use the SHOWCASE_PASSWORD you chose):");
  console.table(orgs.flatMap((o) => o.members.map((m) => ({ organization: o.name, login: m.user.email, role: m.role.replace("ORG_", ""), status: `${o.status}/${o.verificationStatus}` }))));
  const products = await prisma.product.findMany({ where: { organizationId: { in: orgs.map((o) => o.id) } }, orderBy: { createdAt: "asc" }, include: { organization: { select: { name: true } } } });
  console.log("Products and their public QR / verification links:");
  for (const p of products) console.log(`  • ${p.productName} [${p.productCode}] — ${p.organization.name} — ${p.status}\n    ${verifyUrl(p.publicVerificationToken)}`);
  const proofs = await prisma.blockchainProof.groupBy({ by: ["status"], where: { productId: { in: products.map((p) => p.id) } }, _count: { _all: true } });
  console.log("Blockchain proofs:", Object.fromEntries(proofs.map((p) => [p.status, p._count._all])));
}

async function main() {
  if (await prisma.organization.findUnique({ where: { slug: MARKER_SLUG } })) {
    if (!(await prisma.platformSetting.findUnique({ where: { key: DONE_KEY } }))) {
      console.error("A previous showcase run started but did not finish. Its partial \"(Demo)\" organizations remain; suspend them in the admin console. Nothing new was created.");
      process.exit(1);
    }
    console.log("Showcase already present — nothing created.");
    return printSummary();
  }
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    console.error("Set SHOWCASE_PASSWORD (at least 10 characters, letters and digits) — it becomes the password of every showcase account.");
    process.exit(1);
  }
  // Pre-flight: fail before writing anything, so a run never stops half-way for a predictable reason.
  const emails = [...ORGS.map((o) => o.email), ...EXTRA_USERS.map((u) => u.email)];
  const takenEmails = await prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } });
  const takenSlugs = await prisma.organization.findMany({ where: { slug: { in: ORGS.map((o) => o.slug) } }, select: { slug: true } });
  if (takenEmails.length || takenSlugs.length) {
    console.error(`Showcase accounts already exist (${[...takenEmails.map((u) => u.email), ...takenSlugs.map((o) => o.slug)].join(", ")}). Nothing was created.`);
    process.exit(1);
  }
  const chain = await blockchainService.status();
  if (chain.available) {
    for (const [code, serial] of IDENTITIES) {
      if ((await blockchainService.lookupIdentity(canonicalIdentityHash(code, serial)))?.exists) {
        console.error(`Identity ${code}/${serial} is already registered on ${chain.network} by an earlier run against this contract, so the showcase would be flagged as counterfeit. Use a fresh contract or database. Nothing was created.`);
        process.exit(1);
      }
    }
  }
  console.log(chain.available ? `Blockchain: ${chain.network} (chain ${chain.chainId}) — proofs will be anchored for real.` : `Blockchain not active (${chain.reason}) — proofs stay PENDING and are anchored automatically once it is.`);
  const passwordHash = await hashPassword(password);
  const limits = { FREE: [100, 3], STARTER: [1000, 10], GROWTH: [10000, 50] } as const;

  // --- Organizations, owners, members, partnerships -------------------------------------------
  const actors: Record<string, Actor> = {};
  for (const o of ORGS) {
    const unverified = "unverified" in o && o.unverified;
    const org = await prisma.organization.create({
      data: {
        slug: o.slug, name: o.name, legalName: `${o.name.replace(" (Demo)", "")} — ORIGINX demo tenant`, organizationType: o.type, industry: o.industry, country: "IN",
        address: o.city, contactEmail: o.email, status: "ACTIVE", verificationStatus: unverified ? "PENDING" : "VERIFIED", verifiedAt: unverified ? null : new Date(),
        subscriptionPlan: o.plan, subscriptionStatus: "ACTIVE", subscriptionStartedAt: new Date(), productLimit: limits[o.plan][0], userLimit: limits[o.plan][1],
      },
    });
    const user = await prisma.user.create({ data: { email: o.email, fullName: o.owner, passwordHash, emailVerifiedAt: new Date() } });
    await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "ORG_OWNER" } });
    actors[o.slug] = { userId: user.id, organizationId: org.id, role: "ORG_OWNER", ipHash: null };
  }
  const nova = actors["nova-pharma-demo"]!, swift = actors["swiftroute-logistics-demo"]!, metro = actors["metrostore-warehousing-demo"]!;
  const care = actors["careplus-pharmacy-demo"]!, volt = actors["voltwear-electronics-demo"]!, grey = actors["unknown-traders-demo"]!;
  const novaStaff: Record<string, Actor> = {};
  for (const u of EXTRA_USERS) {
    const user = await prisma.user.create({ data: { email: u.email, fullName: u.name, passwordHash, emailVerifiedAt: new Date() } });
    await prisma.organizationMember.create({ data: { organizationId: nova.organizationId, userId: user.id, role: u.role } });
    novaStaff[u.role] = { userId: user.id, organizationId: nova.organizationId, role: u.role, ipHash: null };
  }
  const manager = novaStaff.ORG_MANAGER!, operator = novaStaff.ORG_OPERATOR!;
  for (const [s, t, type] of [[nova, swift, "LOGISTICS_PROVIDER"], [swift, metro, "WAREHOUSE"], [metro, care, "RETAILER"], [nova, care, "CUSTOMER"]] as const) {
    await prisma.organizationRelationship.create({ data: { sourceOrganizationId: s.organizationId, targetOrganizationId: t.organizationId, relationshipType: type, status: "ACCEPTED", approvedAt: new Date() } });
  }
  console.log("✓ 6 organizations, 8 users, 4 partnerships");

  const event = (a: Actor, productId: string, eventType: EventType, location: string, at: Date, metadata: Record<string, unknown> = {}) =>
    eventService.append({ organizationId: a.organizationId, actorUserId: a.userId, productId, eventType, location, metadata, occurredAt: at });
  const handoff = async (from: Actor, to: Actor, productId: string, at: Date, location: string, receiptEventType?: "WAREHOUSE_RECEIVED" | "RETAILER_RECEIVED") => {
    const transfer = await custodyService.request(from, { productId, toOrganizationId: to.organizationId });
    await custodyService.accept(to, transfer.id, { location, receiptEventType }, { occurredAt: at });
  };
  const vaccine = { productName: "NovaVax Influenza Vaccine 0.5 ml", category: "Vaccine", description: "Inactivated quadrivalent influenza vaccine, pre-filled syringe. Store at 2–8 °C.", originCountry: "IN", originLocation: "New Delhi, India" };

  // --- 1. Genuine product, full verified lifecycle (scan → HISTORY VERIFIED) ------------------
  const genuine = (await productService.create(nova, { ...vaccine, productCode: "NVX-INF-05", serialNumber: "B21-000417", batchCode: "B21", manufacturingDate: iso(ago(12)), expiryDate: iso(ago(-360)), currentLocation: "Nova Pharma Plant 1, New Delhi" }, { occurredAt: ago(12) })).product;
  await event(operator, genuine.id, "MANUFACTURED", "Nova Pharma Plant 1, New Delhi", ago(12, -2), { line: "Fill-finish line 3" });
  await event(manager, genuine.id, "QUALITY_APPROVED", "Nova Pharma QC Lab, New Delhi", ago(11), { certificate: "QC-B21-001" });
  await event(operator, genuine.id, "SHIPMENT_CREATED", "Nova Pharma Dispatch, New Delhi", ago(10), { carrier: "SwiftRoute Logistics", coldChain: true });
  await handoff(manager, swift, genuine.id, ago(10, -2), "SwiftRoute Delhi Hub");
  await handoff(swift, metro, genuine.id, ago(9), "MetroStore DC, Gurugram", "WAREHOUSE_RECEIVED");
  await handoff(metro, care, genuine.id, ago(8), "CarePlus Connaught Place", "RETAILER_RECEIVED");
  await event(care, genuine.id, "DELIVERED", "CarePlus Connaught Place, New Delhi", ago(8, -1));
  await prisma.product.update({ where: { id: genuine.id }, data: { status: "DELIVERED" } });
  console.log("✓ Genuine vaccine: full custody chain manufacturer → logistics → warehouse → pharmacy");

  // --- 2. Product in transit (custody handed to logistics, still moving) ----------------------
  const transit = (await productService.create(nova, { ...vaccine, productCode: "NVX-INF-05", serialNumber: "B22-000088", batchCode: "B22", manufacturingDate: iso(ago(4)), expiryDate: iso(ago(-360)) }, { occurredAt: ago(4) })).product;
  await event(operator, transit.id, "MANUFACTURED", "Nova Pharma Plant 1, New Delhi", ago(4, -2));
  await event(manager, transit.id, "QUALITY_APPROVED", "Nova Pharma QC Lab, New Delhi", ago(3));
  await handoff(manager, swift, transit.id, ago(2), "SwiftRoute Delhi Hub");
  console.log("✓ In-transit vaccine with SwiftRoute Logistics");

  // --- 3. Recalled product (scan → RECALLED) ----------------------------------------------------
  const recalled = (await productService.create(nova, { productCode: "NVX-GLU-PEN", serialNumber: "C7-004512", productName: "NovaGlu Insulin Pen 100 IU/ml", category: "Insulin", description: "Pre-filled insulin glargine pen.", batchCode: "C7", originCountry: "IN", originLocation: "Baddi, Himachal Pradesh", manufacturingDate: iso(ago(30)), expiryDate: iso(ago(-700)) }, { occurredAt: ago(30) })).product;
  await event(operator, recalled.id, "MANUFACTURED", "Nova Pharma Baddi Plant", ago(30, -3));
  await event(manager, recalled.id, "QUALITY_APPROVED", "Nova Pharma QC Lab, Baddi", ago(29));
  await handoff(manager, care, recalled.id, ago(25), "CarePlus Connaught Place", "RETAILER_RECEIVED");
  await recallService.create(nova, { productId: recalled.id, reason: "Demo recall: potency below specification in stability testing of batch C7.", affectedUnits: 1, initiate: true });
  console.log("✓ Recalled insulin pen (recall status anchored on-chain)");

  // --- 4. Counterfeit: an unverified seller registers the genuine vaccine's identity ----------
  const fake = await productService.create(grey, { ...vaccine, productCode: "NVX-INF-05", serialNumber: "B21-000417", batchCode: "B21", originLocation: "Unverified" });
  console.log(`✓ Counterfeit attempt by Unknown Traders → ${fake.collision ? "identity collision detected, record quarantined" : "registered (no collision?)"}`);

  // --- 5. A second industry ---------------------------------------------------------------------
  const earbuds = (await productService.create(volt, { productCode: "VW-AERO-X1", serialNumber: "AX1-7781-2201", productName: "VoltWear Aero X1 Wireless Earbuds", category: "Audio", batchCode: "AX1-L7", originCountry: "IN", originLocation: "Bengaluru, India", manufacturingDate: iso(ago(6)) }, { occurredAt: ago(6) })).product;
  await event(volt, earbuds.id, "MANUFACTURED", "VoltWear Factory, Bengaluru", ago(6, -3));
  await event(volt, earbuds.id, "QUALITY_APPROVED", "VoltWear QA, Bengaluru", ago(5));
  console.log("✓ Electronics product (second industry)");

  // --- 6. Inventory: warehouses on the map, SKUs, batch passports, stock, shipment, sales -------
  const novaDc = (await warehouseService.create(nova, { code: "DEL-DC1", name: "Delhi Distribution Centre", city: "New Delhi", country: "IN", address: "Okhla Phase II", latitude: 28.5355, longitude: 77.2732 }))!;
  const cold = (await warehouseService.addLocation(nova, novaDc.id, { code: "COLD-01", zone: "Cold room", aisle: "1", shelf: "A" }))!.id;
  const novaPlant = (await warehouseService.create(nova, { code: "BAD-PLANT", name: "Baddi Plant Store", city: "Baddi", country: "IN", latitude: 30.9578, longitude: 76.7914 }))!;
  const careStore = (await warehouseService.create(care, { code: "CP-STORE", name: "Connaught Place Store", city: "New Delhi", country: "IN", latitude: 28.6315, longitude: 77.2167 }))!;
  await warehouseService.create(metro, { code: "GGN-DC", name: "Gurugram DC", city: "Gurugram", country: "IN", latitude: 28.4595, longitude: 77.0266 });
  await warehouseService.create(swift, { code: "DEL-HUB", name: "Delhi Cross-dock Hub", city: "New Delhi", country: "IN", latitude: 28.5562, longitude: 77.1 });
  const voltWh = (await warehouseService.create(volt, { code: "BLR-WH", name: "Bengaluru Warehouse", city: "Bengaluru", country: "IN", latitude: 12.9716, longitude: 77.5946 }))!;
  const mainOf = (w: { locations: Array<{ id: string; code: string }> }) => w.locations.find((l) => l.code === "MAIN")!.id;

  const vaxSku = await catalogueService.createSku(nova, { sku: "NVX-05-DOSE", name: "NovaVax Influenza Vaccine 0.5 ml", unitOfMeasure: "DOSE", category: "Vaccine", brand: "NovaVax" });
  const salineSku = await catalogueService.createSku(nova, { sku: "NS-500ML", name: "Normal Saline 0.9% 500 ml", unitOfMeasure: "L", category: "IV fluids", brand: "Nova Pharma" });
  const audioSku = await catalogueService.createSku(volt, { sku: "AERO-X1", name: "VoltWear Aero X1 Earbuds", unitOfMeasure: "PCS", category: "Audio", brand: "VoltWear" });
  const mkBatch = async (a: Actor, skuId: string, code: string, made: Date, expiry: Date | null, planned: number) => {
    const batch = await prisma.productBatch.create({ data: { organizationId: a.organizationId, batchCode: code, name: code, manufacturedAt: made, expiryDate: expiry } });
    await catalogueService.updateBatch(a, batch.id, { skuId, plannedQuantity: planned, qualityStatus: "APPROVED" });
    return batch;
  };
  const b30 = await mkBatch(nova, vaxSku.id, "B30", ago(20), ago(-340), 5000);
  await catalogueService.createBatchPassport(nova, b30.id, { originCountry: "IN", originLocation: "New Delhi, India" });
  const b31 = await mkBatch(nova, vaxSku.id, "B31", ago(9), ago(-40), 2000);
  const s14 = await mkBatch(nova, salineSku.id, "S14", ago(40), ago(-700), 800);
  const x7 = await mkBatch(volt, audioSku.id, "AX1-L8", ago(15), null, 1500);
  await inventoryService.recordMovement(nova, { type: "RECEIPT", skuId: vaxSku.id, batchId: b30.id, locationId: cold, quantity: 5000 });
  await inventoryService.recordMovement(nova, { type: "RECEIPT", skuId: vaxSku.id, batchId: b31.id, locationId: cold, quantity: 2000 });
  await inventoryService.recordMovement(nova, { type: "RECEIPT", skuId: salineSku.id, batchId: s14.id, locationId: mainOf(novaPlant), quantity: "780.5" });
  await inventoryService.recordMovement(volt, { type: "OPENING_BALANCE", skuId: audioSku.id, batchId: x7.id, locationId: mainOf(voltWh), quantity: 1450 });
  await inventoryService.recordMovement(nova, { type: "DAMAGE", skuId: vaxSku.id, batchId: b30.id, locationId: cold, quantity: 12, reason: "Syringe plungers cracked during QC handling" });
  const shipment = await shipmentService.create(nova, { receiverOrganizationId: care.organizationId, originWarehouseId: novaDc.id, items: [{ skuId: vaxSku.id, batchId: b30.id, fromLocationId: cold, quantity: 600 }], notes: "Cold chain 2–8 °C", transferCustody: false });
  await shipmentService.reserve(nova, shipment.id);
  await shipmentService.dispatch(nova, shipment.id);
  await shipmentService.receive(care, shipment.id, { locationId: mainOf(careStore), items: [{ itemId: shipment.items![0]!.id, receivedQty: 580, damagedQty: 10, missingQty: 10 }] });
  const pending = await shipmentService.create(nova, { receiverOrganizationId: care.organizationId, originWarehouseId: novaDc.id, items: [{ skuId: vaxSku.id, batchId: b31.id, fromLocationId: cold, quantity: 400 }] });
  await shipmentService.reserve(nova, pending.id);
  const sales = [["Walk-in customers, morning", 6, "1299.00"], ["City Clinic, Karol Bagh", 14, "1249.00"], ["South Delhi Health Centre", 9, "1350.00"], ["Walk-in customers, evening", 5, "1299.00"], ["Corporate vaccination drive", 40, "1199.00"]] as const;
  for (const [i, [customerName, quantity, unitPrice]] of sales.entries()) {
    await salesService.create(care, { reference: `SHOWCASE-${i + 1}`, customerName, currency: "INR", items: [{ skuId: vaxSku.id, batchId: b30.id, locationId: mainOf(careStore), quantity, unitPrice }] }, `showcase-careplus-sale-${i + 1}`);
  }
  await catalogueService.setReorderRule(nova, salineSku.id, { threshold: 1000 });
  await catalogueService.setReorderRule(care, vaxSku.id, { threshold: 600 });
  console.log("✓ 6 mapped warehouses, 3 SKUs, stock ledger, shipment with partial receipt, 5 recorded sales, low-stock alerts");

  // --- 7. Genuine public scans through the real verification engine (now, not backdated) -------
  const scan = (token: string) => verificationService.verifyPublic(token, { ipHash: randomBytes(16).toString("hex"), userAgent: "ORIGINX showcase scan", source: "PUBLIC" });
  for (let i = 0; i < 6; i++) await scan(genuine.publicVerificationToken);
  for (let i = 0; i < 3; i++) await scan(recalled.publicVerificationToken);
  for (let i = 0; i < 2; i++) await scan(fake.product.publicVerificationToken);
  await scan(earbuds.publicVerificationToken);
  await scan(transit.publicVerificationToken);
  console.log("✓ 13 public verification scans recorded");
  await prisma.platformSetting.create({ data: { key: DONE_KEY, valueJson: JSON.stringify(new Date().toISOString()) } });

  await printSummary();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
