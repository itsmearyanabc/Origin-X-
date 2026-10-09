import { beforeAll, describe, expect, it } from "vitest";
import { addEvent, api, as, createOrg, createProduct, prisma, publicVerify, register, type Session } from "../helpers.js";

let brand: Session, rogue: Session;
let brandOrg: string, rogueOrg: string;

beforeAll(async () => {
  brand = await register("brand");
  rogue = await register("rogue");
  brandOrg = await createOrg(brand, "ABC Pharma");
  rogueOrg = await createOrg(rogue, "Unknown Company", "OTHER", false);
});

describe("identity collision / counterfeit detection", () => {
  it("quarantines a duplicate identity, alerts the genuine owner and reveals nothing about them", async () => {
    const genuine = await createProduct(brand, brandOrg, { productCode: `RX-29481-${Date.now()}`, serialNumber: "A92-0001" });
    const code = genuine.product.productCode;

    const attempt = await api().post("/api/v1/products").set(as(rogue, rogueOrg)).send({ productCode: code.toLowerCase(), serialNumber: "a92-0001", productName: "OrigiVax (copy)" });
    expect(attempt.status).toBe(201);
    expect(attempt.body.data.collision).toMatchObject({ detected: true, code: "IDENTITY_COLLISION", status: "POTENTIAL_COUNTERFEIT" });
    const claim = attempt.body.data.product;
    expect(claim.status).toBe("QUARANTINED");
    expect(claim.identity.isCanonical).toBe(false);
    expect(claim.identity.status).toBe("COUNTERFEIT");
    expect(JSON.stringify(attempt.body)).not.toContain(brandOrg);

    // Claimant incident is redacted; genuine owner gets the evidence.
    const rogueIncidents = await api().get("/api/v1/incidents?type=IDENTITY_COLLISION").set(as(rogue, rogueOrg));
    expect(rogueIncidents.body.data).toHaveLength(1);
    expect(JSON.stringify(rogueIncidents.body.data)).not.toContain(brandOrg);
    const brandIncidents = await api().get("/api/v1/incidents?type=IDENTITY_COLLISION").set(as(brand, brandOrg));
    expect(brandIncidents.body.data[0].evidence.claimantOrganizationId).toBe(rogueOrg);

    // The quarantined claim is never anchored on-chain and scores HIGH_RISK.
    expect(await prisma.blockchainProof.count({ where: { productId: claim.id } })).toBe(0);
    const trust = await api().get(`/api/v1/products/${claim.id}/trust-score`).set(as(rogue, rogueOrg));
    expect(trust.body.data.level).toBe("HIGH_RISK");
    expect(trust.body.data.penalties.find((p: { code: string }) => p.code === "IDENTITY_COLLISION").applied).toBe(true);

    // Consumers scanning the clone are told it conflicts; the genuine product stays verified.
    const fake = await publicVerify(claim.publicVerificationToken);
    expect(fake.body.data.state).toBe("COUNTERFEIT");
    expect(fake.body.data.identityVerified).toBe(false);
    expect(fake.body.data.warnings.join(" ")).not.toMatch(/being confirmed/);
    const real = await publicVerify(genuine.product.publicVerificationToken);
    expect(real.body.data.state).toBe("HISTORY_VERIFIED");
    expect(real.body.data.warnings.join(" ")).toMatch(/copy of this product's identity/);
  });

  it("flags a different organization reusing a registered product code", async () => {
    const genuine = await createProduct(brand, brandOrg, { productCode: `SKU-${Date.now()}` });
    const attempt = await api().post("/api/v1/products").set(as(rogue, rogueOrg)).send({ productCode: genuine.product.productCode, productName: "Lookalike", serialNumber: "OTHER-1" });
    expect(attempt.body.data.collision.detected).toBe(true);
  });

  it("the same organization cannot register an identity twice", async () => {
    const genuine = await createProduct(brand, brandOrg);
    const again = await api().post("/api/v1/products").set(as(brand, brandOrg)).send({ productCode: genuine.product.productCode, productName: "Again" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("PRODUCT_ALREADY_REGISTERED");
  });
});

describe("recalls", () => {
  it("consumer verification immediately shows RECALLED (never verified) and the status is anchored on-chain", async () => {
    const { product } = await createProduct(brand, brandOrg);
    await addEvent(brand, brandOrg, product.id, "MANUFACTURED");
    expect((await publicVerify(product.publicVerificationToken)).body.data.state).toBe("HISTORY_VERIFIED");

    const recall = await api().post("/api/v1/recalls").set(as(brand, brandOrg)).send({ productId: product.id, reason: "Cold-chain excursion reported by distributor", initiate: true });
    expect(recall.status).toBe(201);
    expect(recall.body.data.status).toBe("INITIATED");

    const res = await publicVerify(product.publicVerificationToken);
    expect(res.body.data.state).toBe("RECALLED");
    expect(res.body.data.recalled).toBe(true);
    expect(res.body.data.headline).toContain("RECALLED");
    expect(res.body.data.identityVerified).toBe(true);
    expect(res.body.data.passport.recall.reason).toContain("Cold-chain");
    expect(res.body.data.passport.trust.note).toContain("not its safety");

    const statusProof = await prisma.blockchainProof.findFirstOrThrow({ where: { productId: product.id, kind: "STATUS" } });
    expect(statusProof.status).toBe("CONFIRMED");
    expect(statusProof.statusCode).toBe(3);
    const lastEvent = await prisma.productEvent.findFirstOrThrow({ where: { productId: product.id }, orderBy: { sequence: "desc" } });
    expect(lastEvent.eventType).toBe("RECALL_INITIATED");
  });

  it("recalls a whole batch and enforces transitions", async () => {
    const batchCode = `BATCH-${Date.now()}`;
    const a = await createProduct(brand, brandOrg, { batchCode });
    const b = await createProduct(brand, brandOrg, { batchCode });
    const batch = await prisma.productBatch.findFirstOrThrow({ where: { organizationId: brandOrg, batchCode } });
    const recall = await api().post("/api/v1/recalls").set(as(brand, brandOrg)).send({ batchId: batch.id, reason: "Contamination" });
    expect(recall.body.data.status).toBe("DRAFT");
    expect(recall.body.data.affectedUnits).toBe(2);
    const id = recall.body.data.id;
    expect((await api().post(`/api/v1/recalls/${id}/transition`).set(as(brand, brandOrg)).send({ status: "COMPLETED" })).status).toBe(409);
    await api().post(`/api/v1/recalls/${id}/transition`).set(as(brand, brandOrg)).send({ status: "INITIATED" });
    for (const p of [a, b]) expect((await publicVerify(p.product.publicVerificationToken)).body.data.state).toBe("RECALLED");

    // Cancelling an issued recall restores the products with an appended, anchored status event.
    await api().post(`/api/v1/recalls/${id}/transition`).set(as(brand, brandOrg)).send({ status: "CANCELLED" });
    expect((await publicVerify(a.product.publicVerificationToken)).body.data.state).toBe("HISTORY_VERIFIED");
  });

  it("only the brand owner can recall", async () => {
    const { product } = await createProduct(brand, brandOrg);
    const res = await api().post("/api/v1/recalls").set(as(rogue, rogueOrg)).send({ productId: product.id, reason: "Hostile recall" });
    expect(res.status).toBe(404);
  });
});

describe("public consumer verification", () => {
  it("CRITICAL: consumers can verify without login but never see private data", async () => {
    const { product } = await createProduct(brand, brandOrg, { description: "Public description" });
    await api().post("/api/v1/incidents").set(as(brand, brandOrg)).send({ productId: product.id, type: "OTHER", severity: "LOW", title: "Supplier dispute", description: "CONFIDENTIAL-NOTE-123" });
    await addEvent(brand, brandOrg, product.id, "DOCUMENT_ADDED");
    await prisma.productEvent.findFirstOrThrow({ where: { productId: product.id } });

    const res = await publicVerify(product.publicVerificationToken);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = JSON.stringify(res.body);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: brandOrg } });
    for (const secret of [brandOrg, product.id, brand.email, brand.userId, "CONFIDENTIAL-NOTE-123", "passwordHash", "metadataJson", "ipHash", "subscriptionPlan", "contactEmail"]) {
      expect(body, secret).not.toContain(secret);
    }
    expect(res.body.data.passport.brand.name).toBe(org.name);
    expect(res.body.data.passport.lifecycle.length).toBeGreaterThan(0);
    expect(res.body.data.passport.blockchain.status).toBe("VERIFIED");
  });

  it("returns UNKNOWN for unknown tokens and blocks enumeration", async () => {
    const ip = "198.51.100.77";
    const unknown = await publicVerify("thisTokenDoesNotExist123", ip);
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.state).toBe("UNKNOWN");
    for (let i = 0; i < 5; i += 1) await publicVerify(`guess${i}xxxxxxxxxxxxxxxxx`, ip);
    const blocked = await publicVerify("anotherGuessXXXXXXXXXXXX", ip);
    expect(blocked.status).toBe(429);
    // Other clients are unaffected.
    expect((await publicVerify("thisTokenDoesNotExist123", "198.51.100.78")).status).toBe(200);
  });

  it("logs verifications without raw IPs or tokens", async () => {
    const { product } = await createProduct(brand, brandOrg);
    await publicVerify(product.publicVerificationToken, "192.0.2.55");
    const log = await prisma.verificationLog.findFirstOrThrow({ where: { productId: product.id }, orderBy: { timestamp: "desc" } });
    expect(log.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(log)).not.toContain("192.0.2.55");
    expect(JSON.stringify(log)).not.toContain(product.publicVerificationToken);
  });

  it("detects a cloned QR code scanned from many places", async () => {
    const { product } = await createProduct(brand, brandOrg);
    for (let i = 1; i <= 4; i += 1) await publicVerify(product.publicVerificationToken, `203.0.113.${100 + i}`);
    const res = await publicVerify(product.publicVerificationToken, "203.0.113.200");
    expect(res.body.data.state).toBe("SUSPICIOUS");
    const incident = await prisma.incident.findFirst({ where: { productId: product.id, type: "SUSPICIOUS_VERIFICATION_PATTERN" } });
    expect(incident).not.toBeNull();
  });

  it("serves a scannable QR code pointing at the public verification URL", async () => {
    const { product } = await createProduct(brand, brandOrg);
    const qr = await api().get(`/api/v1/products/${product.id}/qr`).set(as(brand, brandOrg));
    expect(qr.body.data.url).toContain(`/verify/${product.publicVerificationToken}`);
    expect(qr.body.data.svg).toContain("<svg");
    expect(qr.body.data.pngDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
