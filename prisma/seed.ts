/**
 * Demo data — built exclusively through the real ORIGINX services, so every event hash, custody
 * handoff, trust score and blockchain proof is genuine. Nothing is inserted "by hand".
 *
 *   npm run chain && npm run chain:deploy   # local blockchain (otherwise proofs stay PENDING)
 *   npm run db:seed                          # on a freshly migrated database
 *
 * Refuses to run when NODE_ENV=production (use src/cli/create-admin.ts there).
 */
import "../scripts/assert-local-db.js"; // must stay first: refuses non-local databases
import fs from "node:fs";
import { config } from "../src/config.js";
import { hashPassword } from "../src/lib/crypto.js";
import { prisma } from "../src/lib/prisma.js";
import type { Actor } from "../src/middleware/tenant.js";
import { blockchainService } from "../src/services/blockchain.service.js";
import { custodyService } from "../src/services/custody.service.js";
import { eventService } from "../src/services/event.service.js";
import { productService } from "../src/services/product.service.js";
import type { EventType, OrgRole } from "../src/lib/constants.js";

if (config.nodeEnv === "production") {
  console.error("Refusing to seed demo data in production. Use `npm run admin:create` instead.");
  process.exit(1);
}

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "OriginX-Demo-2026";
const at = (iso: string) => new Date(iso);

async function user(email: string, fullName: string, platformRole = "NONE") {
  return prisma.user.create({
    data: { email, fullName, platformRole, passwordHash: await hashPassword(DEMO_PASSWORD), emailVerifiedAt: new Date() },
  });
}

async function org(data: {
  slug: string;
  name: string;
  legalName: string;
  organizationType: string;
  industry: string;
  address: string;
  contactEmail: string;
  plan: "FREE" | "STARTER" | "GROWTH" | "ENTERPRISE";
  verified?: boolean;
  status?: string;
}) {
  const limits = { FREE: [100, 3], STARTER: [1000, 10], GROWTH: [10000, 50], ENTERPRISE: [250000, 500] }[data.plan];
  return prisma.organization.create({
    data: {
      slug: data.slug,
      name: data.name,
      legalName: data.legalName,
      organizationType: data.organizationType,
      industry: data.industry,
      country: "IN",
      address: data.address,
      contactEmail: data.contactEmail,
      status: data.status ?? "ACTIVE",
      verificationStatus: data.verified === false ? "PENDING" : "VERIFIED",
      verifiedAt: data.verified === false ? null : new Date(),
      subscriptionPlan: data.plan,
      subscriptionStatus: "ACTIVE",
      subscriptionStartedAt: new Date(),
      productLimit: limits[0],
      userLimit: limits[1],
    },
  });
}

async function member(organizationId: string, userId: string, role: OrgRole): Promise<Actor> {
  await prisma.organizationMember.create({ data: { organizationId, userId, role } });
  return { userId, organizationId, role, ipHash: null };
}

async function relate(sourceOrganizationId: string, targetOrganizationId: string, relationshipType: string) {
  await prisma.organizationRelationship.create({
    data: { sourceOrganizationId, targetOrganizationId, relationshipType, status: "ACCEPTED", approvedAt: new Date() },
  });
}

async function event(a: Actor, productId: string, eventType: EventType, location: string, occurredAt: string, metadata: Record<string, unknown> = {}) {
  await eventService.append({ organizationId: a.organizationId, actorUserId: a.userId, productId, eventType, location, metadata, occurredAt: at(occurredAt) });
}

async function handoff(from: Actor, to: Actor, productId: string, occurredAt: string, location: string, receiptEventType?: "WAREHOUSE_RECEIVED" | "RETAILER_RECEIVED") {
  const transfer = await custodyService.request(from, { productId, toOrganizationId: to.organizationId });
  await custodyService.accept(to, transfer.id, { location, receiptEventType }, { occurredAt: at(occurredAt) });
}

async function main() {
  if (await prisma.organization.findUnique({ where: { slug: "abc-pharma" } })) {
    console.log("Demo data already present. To start over: npm run db:reset");
    return;
  }
  const chain = await blockchainService.status();
  console.log(chain.available ? `Blockchain: ${chain.network} (chain ${chain.chainId}) at ${chain.contractAddress}` : `Blockchain unavailable (${chain.reason}). Proofs will be PENDING until anchored.`);

  // --- Platform administrators -------------------------------------------------
  await user("admin@originx.local", "ORIGINX Super Admin", "SUPER_ADMIN");
  await user("compliance@originx.local", "Compliance Officer", "COMPLIANCE_ADMIN");
  await user("support@originx.local", "Support Desk", "SUPPORT_ADMIN");

  // --- Organizations -------------------------------------------------------------
  const abc = await org({ slug: "abc-pharma", name: "ABC Pharma", legalName: "ABC Pharmaceuticals Pvt Ltd", organizationType: "MANUFACTURER", industry: "Pharmaceuticals", address: "Okhla Industrial Area, New Delhi", contactEmail: "quality@abcpharma.example", plan: "GROWTH" });
  const swift = await org({ slug: "swiftlogix", name: "SwiftLogix", legalName: "SwiftLogix Logistics Ltd", organizationType: "LOGISTICS", industry: "Cold-chain logistics", address: "Bhiwandi, Maharashtra", contactEmail: "ops@swiftlogix.example", plan: "STARTER" });
  const metro = await org({ slug: "metrocare-warehouse", name: "MetroCare Warehouse", legalName: "MetroCare Warehousing Pvt Ltd", organizationType: "WAREHOUSE", industry: "Healthcare distribution", address: "Gurugram, Haryana", contactEmail: "dock@metrocare.example", plan: "STARTER" });
  const health = await org({ slug: "healthplus-retail", name: "HealthPlus Retail", legalName: "HealthPlus Retail Stores Pvt Ltd", organizationType: "RETAILER", industry: "Pharmacy retail", address: "Connaught Place, New Delhi", contactEmail: "store@healthplus.example", plan: "FREE" });
  const xyz = await org({ slug: "xyz-electronics", name: "XYZ Electronics", legalName: "XYZ Electronics Ltd", organizationType: "BRAND", industry: "Consumer electronics", address: "Electronic City, Bengaluru", contactEmail: "brand@xyz.example", plan: "STARTER" });
  const shadow = await org({ slug: "shadow-pharma-traders", name: "Shadow Pharma Traders", legalName: "Shadow Pharma Traders", organizationType: "OTHER", industry: "Unknown", address: "Unverified address", contactEmail: "sales@shadow.example", plan: "FREE", verified: false });
  await org({ slug: "novamed-distributors", name: "NovaMed Distributors", legalName: "NovaMed Distributors LLP", organizationType: "DISTRIBUTOR", industry: "Pharma distribution", address: "Ahmedabad, Gujarat", contactEmail: "hello@novamed.example", plan: "FREE", verified: false, status: "PENDING" });

  // --- Members (all roles at ABC Pharma) ----------------------------------------
  const abcOwner = await member(abc.id, (await user("owner@abcpharma.local", "Asha Mehra")).id, "ORG_OWNER");
  await member(abc.id, (await user("admin@abcpharma.local", "Vikram Rao")).id, "ORG_ADMIN");
  const abcManager = await member(abc.id, (await user("manager@abcpharma.local", "Neha Gupta")).id, "ORG_MANAGER");
  const abcOperator = await member(abc.id, (await user("ops@abcpharma.local", "Ravi Kumar")).id, "ORG_OPERATOR");
  await member(abc.id, (await user("viewer@abcpharma.local", "Auditor View")).id, "ORG_VIEWER");
  const swiftOwner = await member(swift.id, (await user("owner@swiftlogix.local", "Nina Patel")).id, "ORG_OWNER");
  const metroOwner = await member(metro.id, (await user("owner@metrocare.local", "Omar Siddiqui")).id, "ORG_OWNER");
  const healthOwner = await member(health.id, (await user("owner@healthplus.local", "Priya Shah")).id, "ORG_OWNER");
  const xyzOwner = await member(xyz.id, (await user("owner@xyz.local", "Daniel Joseph")).id, "ORG_OWNER");
  await member(shadow.id, (await user("owner@shadow.local", "Unknown Seller")).id, "ORG_OWNER");

  // --- Supply-chain relationships ---------------------------------------------------
  await relate(abc.id, swift.id, "LOGISTICS_PROVIDER");
  await relate(swift.id, metro.id, "WAREHOUSE");
  await relate(metro.id, health.id, "RETAILER");
  await relate(abc.id, health.id, "CUSTOMER");

  const vaccine = {
    productName: "OrigiVax Influenza Vaccine",
    category: "Vaccine",
    description: "Inactivated quadrivalent influenza vaccine, 0.5 ml pre-filled syringe. Store at 2–8 °C.",
    originCountry: "IN",
    originLocation: "Delhi, India",
  };

  // --- Scenario 1: Vaccine Batch A92 — complete, verified lifecycle ---------------
  const a92 = (
    await productService.create(abcOwner, { ...vaccine, productCode: "RX-29481", serialNumber: "A92-000417", batchCode: "A92", manufacturingDate: "2026-08-01T06:00:00.000Z", expiryDate: "2027-07-31T00:00:00.000Z", currentLocation: "ABC Pharma Plant 1, Delhi" }, { occurredAt: at("2026-08-01T06:05:00.000Z") })
  ).product;
  await event(abcOperator, a92.id, "MANUFACTURED", "ABC Pharma Plant 1, Delhi", "2026-08-01T08:00:00.000Z", { line: "Fill-finish line 3" });
  await event(abcManager, a92.id, "QUALITY_APPROVED", "ABC Pharma QC Lab, Delhi", "2026-08-01T12:00:00.000Z", { certificate: "QC-A92-2026-08-01" });
  await event(abcOperator, a92.id, "SHIPMENT_CREATED", "ABC Pharma Dispatch, Delhi", "2026-08-02T04:00:00.000Z", { carrier: "SwiftLogix", coldChain: true });
  await handoff(abcManager, swiftOwner, a92.id, "2026-08-02T06:00:00.000Z", "SwiftLogix Delhi Hub");
  await handoff(swiftOwner, metroOwner, a92.id, "2026-08-03T09:00:00.000Z", "MetroCare DC, Gurugram", "WAREHOUSE_RECEIVED");
  await handoff(metroOwner, healthOwner, a92.id, "2026-08-04T11:00:00.000Z", "HealthPlus Connaught Place", "RETAILER_RECEIVED");
  await event(healthOwner, a92.id, "DELIVERED", "HealthPlus Connaught Place, New Delhi", "2026-08-04T11:30:00.000Z");
  await prisma.product.update({ where: { id: a92.id }, data: { status: "DELIVERED" } });

  // --- Scenario 2: tamper demos (A93 naive edit, A94 full re-hash) -----------------
  const tamperTargets = [];
  for (const [code, serial, batch] of [["RX-29493", "A93-000101", "A93"], ["RX-29494", "A94-000202", "A94"]]) {
    const p = (await productService.create(abcOwner, { ...vaccine, productCode: code, serialNumber: serial, batchCode: batch, manufacturingDate: "2026-08-05T06:00:00.000Z", expiryDate: "2027-08-04T00:00:00.000Z" }, { occurredAt: at("2026-08-05T06:05:00.000Z") })).product;
    await event(abcOperator, p.id, "MANUFACTURED", "ABC Pharma Plant 1, Delhi", "2026-08-05T08:00:00.000Z");
    await event(abcManager, p.id, "QUALITY_APPROVED", "ABC Pharma QC Lab, Delhi", "2026-08-05T12:00:00.000Z");
    await event(abcOperator, p.id, "SHIPMENT_CREATED", "ABC Pharma Dispatch, Delhi", "2026-08-06T04:00:00.000Z");
    await handoff(abcManager, swiftOwner, p.id, "2026-08-06T06:00:00.000Z", "SwiftLogix Delhi Hub");
    tamperTargets.push(p);
  }

  // --- Scenario 4: recall demo — Glucora insulin pens, batch C7 --------------------
  const c7 = (
    await productService.create(abcOwner, { productCode: "GLU-C7-PEN", serialNumber: "C7-004512", productName: "Glucora Insulin Pen 100 IU/ml", category: "Insulin", description: "Pre-filled insulin glargine pen.", batchCode: "C7", originCountry: "IN", originLocation: "Baddi, Himachal Pradesh", manufacturingDate: "2026-07-20T06:00:00.000Z", expiryDate: "2028-07-19T00:00:00.000Z" }, { occurredAt: at("2026-07-20T06:10:00.000Z") })
  ).product;
  await event(abcOperator, c7.id, "MANUFACTURED", "ABC Pharma Baddi Plant", "2026-07-20T09:00:00.000Z");
  await event(abcManager, c7.id, "QUALITY_APPROVED", "ABC Pharma QC Lab, Baddi", "2026-07-21T10:00:00.000Z");
  await handoff(abcManager, healthOwner, c7.id, "2026-07-24T10:00:00.000Z", "HealthPlus Connaught Place", "RETAILER_RECEIVED");

  // --- A second tenant in another industry --------------------------------------------
  const earbuds = (
    await productService.create(xyzOwner, { productCode: "XYZ-AERO-X1", serialNumber: "AX1-7781-2201", productName: "Aero X1 Wireless Earbuds", category: "Audio", batchCode: "AX1-2026-08", originCountry: "IN", originLocation: "Bengaluru, India", manufacturingDate: "2026-08-10T06:00:00.000Z" }, { occurredAt: at("2026-08-10T06:30:00.000Z") })
  ).product;
  await event(xyzOwner, earbuds.id, "MANUFACTURED", "XYZ Electronics, Bengaluru", "2026-08-10T09:00:00.000Z");
  await event(xyzOwner, earbuds.id, "QUALITY_APPROVED", "XYZ Electronics QA, Bengaluru", "2026-08-10T15:00:00.000Z");

  const all = await prisma.product.findMany({ include: { _count: { select: { events: true, proofs: true } } }, orderBy: { createdAt: "asc" } });
  const proofs = await prisma.blockchainProof.groupBy({ by: ["status"], _count: { _all: true } });
  const tokens = Object.fromEntries(all.map((p) => [p.productCode, p.publicVerificationToken]));
  fs.writeFileSync(".originx-demo.json", JSON.stringify({ apiUrl: `http://localhost:${config.port}`, password: DEMO_PASSWORD, tokens, tamperDemo: { naive: tamperTargets[0].id, rewrite: tamperTargets[1].id }, recallDemo: c7.id, genuineA92: a92.id }, null, 2));

  console.log("\nSeed complete.\n");
  console.table(all.map((p) => ({ code: p.productCode, name: p.productName, status: p.status, trust: `${p.trustScore} ${p.trustLevel}`, events: p._count.events, proofs: p._count.proofs })));
  console.log("Blockchain proofs:", Object.fromEntries(proofs.map((p) => [p.status, p._count._all])));
  console.log(`\nAll demo accounts use the password: ${DEMO_PASSWORD}`);
  console.log("  Platform:  admin@originx.local (SUPER_ADMIN), compliance@originx.local, support@originx.local");
  console.log("  ABC Pharma: owner@ / admin@ / manager@ / ops@ / viewer@abcpharma.local");
  console.log("  Partners:  owner@swiftlogix.local, owner@metrocare.local, owner@healthplus.local, owner@xyz.local");
  console.log("  Counterfeit actor: owner@shadow.local");
  console.log(`\nPublic verification (Vaccine Batch A92): ${config.publicVerifyBaseUrl}/${tokens["RX-29481"]}`);
  console.log("Tokens and ids for the demo script were written to .originx-demo.json");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
