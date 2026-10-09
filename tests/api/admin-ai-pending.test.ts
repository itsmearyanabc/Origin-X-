import { describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { BlockchainService } from "../../src/services/blockchain.service.js";
import { api, as, createOrg, createProduct, makePlatformAdmin, prisma, register } from "../helpers.js";

describe("platform admin", () => {
  it("approves, verifies and suspends organizations with audit trails", async () => {
    const admin = await makePlatformAdmin("PLATFORM_ADMIN");
    const owner = await register("onboarding");
    const org = await createOrg(owner, "NovaMed Distributors", "DISTRIBUTOR", false);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org } })).status).toBe("PENDING");

    const pending = await api().get("/api/v1/admin/organizations?status=PENDING").set(as(admin));
    expect(pending.body.data.some((o: { id: string }) => o.id === org)).toBe(true);

    expect((await api().post(`/api/v1/admin/organizations/${org}/approve`).set(as(admin))).body.data.status).toBe("ACTIVE");
    const verified = await api().post(`/api/v1/admin/organizations/${org}/verify`).set(as(admin));
    expect(verified.body.data.verificationStatus).toBe("VERIFIED");
    const suspended = await api().post(`/api/v1/admin/organizations/${org}/suspend`).set(as(admin)).send({ reason: "Compliance review" });
    expect(suspended.body.data.status).toBe("SUSPENDED");

    const logs = await api().get(`/api/v1/admin/audit-logs?organizationId=${org}`).set(as(admin));
    const actions = logs.body.data.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["ADMIN_ORGANIZATION_APPROVE", "ADMIN_ORGANIZATION_VERIFY", "ADMIN_ORGANIZATION_SUSPEND"]));
  });

  it("intervenes on identities by appending events, never editing history", async () => {
    const admin = await makePlatformAdmin("COMPLIANCE_ADMIN");
    const owner = await register("intervention");
    const org = await createOrg(owner, "Intervention Pharma");
    const { product } = await createProduct(owner, org);
    const before = await prisma.productEvent.findMany({ where: { productId: product.id }, orderBy: { sequence: "asc" } });
    const res = await api().post(`/api/v1/admin/products/${product.id}/identity-status`).set(as(admin)).send({ status: "REVOKED", reason: "Confirmed counterfeit investigation" });
    expect(res.status).toBe(200);
    const after = await prisma.productEvent.findMany({ where: { productId: product.id }, orderBy: { sequence: "asc" } });
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)?.eventType).toBe("STATUS_CHANGED");
    const pub = await api().get(`/api/v1/verify/${product.publicVerificationToken}`).set("CF-Connecting-IP", "203.0.113.9");
    expect(pub.body.data.state).toBe("SUSPICIOUS");
  });

  it("exposes platform dashboard, metrics and blockchain status", async () => {
    const admin = await makePlatformAdmin();
    const dash = await api().get("/api/v1/admin/dashboard").set(as(admin));
    expect(dash.status).toBe(200);
    expect(dash.body.data.blockchain.network.available).toBe(true);
    const metrics = await api().get("/api/v1/admin/platform-metrics").set(as(admin));
    expect(metrics.status).toBe(200);
    expect(Array.isArray(metrics.body.data.verificationVolume30d)).toBe(true);
    const ready = await api().get("/ready");
    expect(ready.body.data).toMatchObject({ status: "ready", database: "ok" });
  });
});

describe("ASK ORIGINX", () => {
  it("answers from verified facts deterministically when no AI provider is configured", async () => {
    const owner = await register("ask");
    const org = await createOrg(owner, "Ask Pharma");
    const { product } = await createProduct(owner, org);
    const res = await api().post(`/api/v1/products/${product.id}/ask`).set(as(owner, org)).send({ question: "What is the trust score?" });
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("deterministic");
    expect(res.body.data.answer).toContain(`${res.body.data.facts.trust.score}/100`);
  });
});

describe("blockchain unavailable", () => {
  it("records PENDING proofs with no fabricated hash, then anchors them when the chain is reachable", async () => {
    const owner = await register("pending");
    const org = await createOrg(owner, "Pending Pharma");
    const { product } = await createProduct(owner, org);
    const identity = await prisma.productIdentity.findUniqueOrThrow({ where: { productId: product.id } });

    const offline = new BlockchainService({ ...config.blockchain, rpcUrl: "http://127.0.0.1:9", expectedChainId: undefined });
    const event = await prisma.productEvent.findFirstOrThrow({ where: { productId: product.id } });
    // A second event so it has a distinct hash to anchor.
    const res = await api().post(`/api/v1/products/${product.id}/events`).set(as(owner, org)).send({ eventType: "DOCUMENT_ADDED" });
    const newEvent = await prisma.productEvent.findUniqueOrThrow({ where: { id: res.body.data.id } });
    await prisma.productEvent.update({ where: { id: newEvent.id }, data: { blockchainProofId: null } });
    const proof = await offline.anchorEventProof(product.id, newEvent.id, `${"ab".repeat(31)}cd`, identity.identityHash);
    expect(proof.status).toBe("PENDING");
    expect(proof.transactionHash).toBeNull();
    expect(event).toBeTruthy();

    const status = await offline.status();
    expect(status.available).toBe(false);

    const online = new BlockchainService(config.blockchain);
    const result = await online.anchorPending();
    expect(result.confirmed).toBeGreaterThanOrEqual(1);
    const anchored = await prisma.blockchainProof.findUniqueOrThrow({ where: { id: proof.id } });
    expect(anchored.status).toBe("CONFIRMED");
    expect(anchored.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
