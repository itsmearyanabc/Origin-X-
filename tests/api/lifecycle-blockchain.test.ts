import { beforeAll, describe, expect, it } from "vitest";
import { Contract, JsonRpcProvider } from "ethers";
import { inject } from "vitest";
import { anchorArtifact, blockchainService } from "../../src/services/blockchain.service.js";
import { addEvent, api, as, createOrg, createProduct, partner, prisma, register, tamperEventInDatabase, transfer, type Session } from "../helpers.js";

const TX_HASH = /^0x[0-9a-f]{64}$/;
let maker: Session, logistics: Session, warehouse: Session, stranger: Session;
let makerOrg: string, logisticsOrg: string, warehouseOrg: string, strangerOrg: string;

beforeAll(async () => {
  maker = await register("maker");
  logistics = await register("logistics");
  warehouse = await register("warehouse");
  stranger = await register("stranger");
  makerOrg = await createOrg(maker, "ABC Pharma");
  logisticsOrg = await createOrg(logistics, "SwiftLogix", "LOGISTICS");
  warehouseOrg = await createOrg(warehouse, "MetroCare", "WAREHOUSE");
  strangerOrg = await createOrg(stranger, "Unrelated Co", "RETAILER");
  await partner(maker, makerOrg, logistics, logisticsOrg, "LOGISTICS_PROVIDER");
  await partner(logistics, logisticsOrg, warehouse, warehouseOrg, "WAREHOUSE");
});

describe("product registration & blockchain identity", () => {
  it("registers the identity and the genesis event on-chain with real transactions", async () => {
    const { product } = await createProduct(maker, makerOrg);
    const proofs = await prisma.blockchainProof.findMany({ where: { productId: product.id }, orderBy: { createdAt: "asc" } });
    expect(proofs.map((p) => p.kind)).toEqual(["IDENTITY", "EVENT"]);
    for (const p of proofs) {
      expect(p.status).toBe("CONFIRMED");
      expect(p.transactionHash).toMatch(TX_HASH);
      expect(p.blockNumber).toBeGreaterThan(0);
      expect(p.chainId).toBe(31337);
    }

    // Independently read the contract state straight from the chain.
    const env = inject("testEnv");
    const provider = new JsonRpcProvider(env.rpcUrl);
    const contract = new Contract(env.contractAddress, anchorArtifact.abi as never, provider);
    const [exists, , status] = await contract.getFunction("getIdentity")(`0x${proofs[0].eventHash}`);
    expect(exists).toBe(true);
    expect(Number(status)).toBe(1);
    const event = await prisma.productEvent.findFirstOrThrow({ where: { productId: product.id, sequence: 1 } });
    const [eventExists, identityHash] = await contract.getFunction("getEventAnchor")(`0x${event.eventHash}`);
    expect(eventExists).toBe(true);
    expect(identityHash).toBe(`0x${proofs[0].eventHash}`);
    const receipt = await provider.getTransactionReceipt(proofs[1].transactionHash!);
    expect(receipt?.status).toBe(1);
    provider.destroy();
  });

  it("deep-verifies a proof against the transaction receipt and contract state", async () => {
    const { product } = await createProduct(maker, makerOrg);
    const proof = await prisma.blockchainProof.findFirstOrThrow({ where: { productId: product.id, kind: "EVENT" } });
    const res = await api().get(`/api/v1/products/${product.id}/blockchain/proofs/${proof.id}/verify`).set(as(maker, makerOrg));
    expect(res.body.data).toMatchObject({ valid: true, result: "VERIFIED", logMatches: true, stateMatches: true, targetsContract: true });
  });

  it("deep-verifies status proofs against the exact status emitted by the contract", async () => {
    const { product } = await createProduct(maker, makerOrg);
    const identity = await prisma.productIdentity.findUniqueOrThrow({ where: { productId: product.id } });
    const proof = await blockchainService.anchorIdentityStatus(product.id, identity.identityHash, "RECALLED");
    expect(proof.status).toBe("CONFIRMED");

    const verified = await blockchainService.verifyProof(proof.id);
    expect(verified).toMatchObject({ valid: true, result: "VERIFIED", logMatches: true, stateMatches: true, targetsContract: true });

    // Simulate exhaustion after broadcast: an admin retry must preserve and resume the same tx.
    const resumed = await prisma.blockchainProof.create({ data: {
      productId: proof.productId,
      kind: proof.kind,
      network: proof.network,
      chainId: proof.chainId,
      contractAddress: proof.contractAddress,
      transactionHash: proof.transactionHash,
      blockNumber: proof.blockNumber,
      eventHash: proof.eventHash,
      identityHash: proof.identityHash,
      statusCode: proof.statusCode,
      timestamp: proof.timestamp,
      status: "FAILED",
      attempts: 10,
      lastError: "RPC_ERROR: confirmation timed out",
    } });
    const queued = await blockchainService.retryFailedProof(resumed.id);
    expect(queued).toMatchObject({ status: "PENDING", attempts: 0, transactionHash: proof.transactionHash, lastError: null });
    await blockchainService.anchorPending();
    const resumedProof = await prisma.blockchainProof.findUniqueOrThrow({ where: { id: resumed.id } });
    expect(resumedProof).toMatchObject({ status: "CONFIRMED", transactionHash: proof.transactionHash });

    // Simulate a corrupted DB projection that claims the same successful tx recorded ACTIVE.
    const corrupted = await prisma.blockchainProof.create({ data: {
      productId: proof.productId,
      kind: proof.kind,
      network: proof.network,
      chainId: proof.chainId,
      contractAddress: proof.contractAddress,
      transactionHash: proof.transactionHash,
      blockNumber: proof.blockNumber,
      eventHash: proof.eventHash,
      identityHash: proof.identityHash,
      statusCode: 1,
      timestamp: proof.timestamp,
      confirmedAt: proof.confirmedAt,
      status: "CONFIRMED",
    } });
    const rejected = await blockchainService.verifyProof(corrupted.id);
    expect(rejected).toMatchObject({ valid: false, result: "MISMATCH", logMatches: false });
  });
});

describe("custody transfers", () => {
  it("requires an accepted partnership and the current custodian", async () => {
    const { product } = await createProduct(maker, makerOrg);
    const notPartner = await api().post("/api/v1/custody-transfers").set(as(maker, makerOrg)).send({ productId: product.id, toOrganizationId: strangerOrg });
    expect(notPartner.status).toBe(403);
    expect(notPartner.body.error.code).toBe("NOT_A_PARTNER");
    // Logistics cannot hand off a product it does not hold (it cannot even see it).
    const notCustodian = await api().post("/api/v1/custody-transfers").set(as(logistics, logisticsOrg)).send({ productId: product.id, toOrganizationId: warehouseOrg });
    expect(notCustodian.status).toBe(404);
  });

  it("only the receiving organization can accept; ownership moves only on acceptance", async () => {
    const { product } = await createProduct(maker, makerOrg);
    const req = await api().post("/api/v1/custody-transfers").set(as(maker, makerOrg)).send({ productId: product.id, toOrganizationId: logisticsOrg });
    expect(req.status).toBe(201);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentOwnerOrganizationId).toBe(makerOrg);
    // Sender cannot accept its own transfer.
    expect((await api().post(`/api/v1/custody-transfers/${req.body.data.id}/accept`).set(as(maker, makerOrg))).status).toBe(404);
    // A duplicate pending transfer is refused.
    expect((await api().post("/api/v1/custody-transfers").set(as(maker, makerOrg)).send({ productId: product.id, toOrganizationId: logisticsOrg })).status).toBe(409);
    // Receiver can see the offered product before accepting.
    expect((await api().get(`/api/v1/products/${product.id}`).set(as(logistics, logisticsOrg))).status).toBe(200);
    const reject = await api().post(`/api/v1/custody-transfers/${req.body.data.id}/reject`).set(as(logistics, logisticsOrg)).send({ reason: "Wrong lot" });
    expect(reject.body.data.status).toBe("TRANSFER_REJECTED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).currentOwnerOrganizationId).toBe(makerOrg);
  });

  it("builds a verified multi-party lifecycle anchored on-chain", async () => {
    const { product } = await createProduct(maker, makerOrg);
    await addEvent(maker, makerOrg, product.id, "MANUFACTURED");
    await addEvent(maker, makerOrg, product.id, "QUALITY_APPROVED");
    await addEvent(maker, makerOrg, product.id, "SHIPMENT_CREATED");
    await transfer(maker, makerOrg, logistics, logisticsOrg, product.id);
    // The previous custodian may no longer record custody events.
    expect((await api().post(`/api/v1/products/${product.id}/events`).set(as(maker, makerOrg)).send({ eventType: "DELIVERED" })).status).toBe(403);
    await transfer(logistics, logisticsOrg, warehouse, warehouseOrg, product.id, "WAREHOUSE_RECEIVED");

    const history = await api().post(`/api/v1/products/${product.id}/verify-history`).set(as(maker, makerOrg));
    expect(history.status).toBe(200);
    expect(history.body.data.historyValid).toBe(true);
    expect(history.body.data.eventCount).toBe(6);
    expect(history.body.data.verifiedEventCount).toBe(6);
    expect(history.body.data.blockchainVerification.status).toBe("VERIFIED");
    expect(history.body.data.blockchainVerification.verifiedEvents).toBe(6);

    const trust = await api().get(`/api/v1/products/${product.id}/trust-score`).set(as(warehouse, warehouseOrg));
    expect(trust.body.data.score).toBe(100);
    expect(trust.body.data.level).toBe("EXCELLENT");

    const passport = await api().get(`/api/v1/products/${product.id}/passport`).set(as(maker, makerOrg));
    expect(passport.body.data.custody.currentOwner.id).toBe(warehouseOrg);
    expect(passport.body.data.custody.analysis.consistent).toBe(true);
    expect(passport.body.data.lifecycle.map((e: { eventType: string }) => e.eventType)).toEqual([
      "PRODUCT_REGISTERED", "MANUFACTURED", "QUALITY_APPROVED", "SHIPMENT_CREATED", "CUSTODY_TRANSFERRED", "WAREHOUSE_RECEIVED",
    ]);

    const audit = await api().get("/api/v1/audit-logs?action=CUSTODY_TRANSFER_ACCEPTED").set(as(maker, makerOrg));
    expect(audit.body.data.length).toBeGreaterThan(0);
  });

  it("rejects platform-only event types from clients", async () => {
    const { product } = await createProduct(maker, makerOrg);
    for (const eventType of ["CUSTODY_TRANSFERRED", "PRODUCT_REGISTERED", "RECALL_INITIATED"]) {
      const res = await api().post(`/api/v1/products/${product.id}/events`).set(as(maker, makerOrg)).send({ eventType, eventHash: "f".repeat(64) });
      expect(res.status).toBe(422);
    }
  });
});

describe("tamper detection", () => {
  async function lifecycle() {
    const { product } = await createProduct(maker, makerOrg);
    await addEvent(maker, makerOrg, product.id, "MANUFACTURED");
    await addEvent(maker, makerOrg, product.id, "QUALITY_APPROVED");
    await addEvent(maker, makerOrg, product.id, "SHIPMENT_CREATED");
    const events = await prisma.productEvent.findMany({ where: { productId: product.id }, orderBy: { sequence: "asc" } });
    return { product, events };
  }

  it("the database refuses edits to events and audit logs", async () => {
    const { events } = await lifecycle();
    await expect(prisma.productEvent.update({ where: { id: events[1].id }, data: { location: "Edited" } })).rejects.toThrow(/ORIGINX_IMMUTABLE/);
    await expect(prisma.productEvent.delete({ where: { id: events[1].id } })).rejects.toThrow(/ORIGINX_IMMUTABLE/);
    const log = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: "EDITED" } })).rejects.toThrow(/ORIGINX_APPEND_ONLY/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/ORIGINX_APPEND_ONLY/);
  });

  it("CRITICAL: modifying an event's content fails verification and drops the trust score", async () => {
    const { product, events } = await lifecycle();
    const before = await api().post(`/api/v1/products/${product.id}/verify-history`).set(as(maker, makerOrg));
    expect(before.body.data.historyValid).toBe(true);

    await tamperEventInDatabase(events[2].id, { location: "Unapproved facility" }); // event #3

    const after = await api().post(`/api/v1/products/${product.id}/verify-history`).set(as(maker, makerOrg));
    expect(after.body.data.historyValid).toBe(false);
    expect(after.body.data.tamperedEvents.map((t: { sequence: number }) => t.sequence)).toContain(3);
    expect(after.body.data.affectedEvents).toEqual([events[2].id, events[3].id]);
    expect(after.body.data.firstCompromisedSequence).toBe(3);
    expect(after.body.data.blockchainVerification.contentMismatches).toBe(1);
    expect(after.body.data.trust.score).toBeLessThan(50);

    const incidents = await api().get(`/api/v1/incidents?productId=${product.id}&type=TAMPERED_RECORD`).set(as(maker, makerOrg));
    expect(incidents.body.data).toHaveLength(1);
    const publicView = await api().get(`/api/v1/verify/${product.publicVerificationToken}`);
    expect(publicView.body.data.state).toBe("HISTORY_COMPROMISED");
  });

  it("re-hashing the whole chain passes database checks but is exposed by the blockchain", async () => {
    const { product, events } = await lifecycle();
    const demo = await api()
      .post(`/api/v1/products/${product.id}/demo/tamper`)
      .set(as(maker, makerOrg))
      .send({ mode: "rewrite", sequence: 2, change: { location: "Rewritten history" } });
    expect(demo.status).toBe(200);
    expect(demo.body.data.after.databaseChainLooksValid).toBe(true);
    expect(demo.body.data.after.historyValid).toBe(false);
    expect(demo.body.data.after.blockchain).toBe("MISMATCH");
    expect(demo.body.data.after.penalties).toEqual(expect.arrayContaining(["TAMPERED_EVENT", "INVALID_PROOF"]));

    const history = await api().post(`/api/v1/products/${product.id}/verify-history`).set(as(maker, makerOrg));
    expect(history.body.data.brokenLinks).toHaveLength(0);
    const results = history.body.data.blockchainVerification.proofs.map((p: { sequence: number; result: string }) => [p.sequence, p.result]);
    expect(results).toEqual([[1, "VERIFIED"], [2, "HASH_MISMATCH"], [3, "HASH_MISMATCH"], [4, "HASH_MISMATCH"]]);
    expect(history.body.data.affectedEvents).toEqual(events.slice(1).map((e) => e.id));
    const incidents = await prisma.incident.findMany({ where: { productId: product.id, type: "INVALID_BLOCKCHAIN_PROOF" } });
    expect(incidents).toHaveLength(1);
  });

  it("detects tampering with sealed passport fields (origin)", async () => {
    const { product } = await lifecycle();
    await prisma.product.update({ where: { id: product.id }, data: { originLocation: "Somewhere cheaper" } });
    const history = await api().post(`/api/v1/products/${product.id}/verify-history`).set(as(maker, makerOrg));
    expect(history.body.data.historyValid).toBe(false);
    expect(history.body.data.passportIntegrity.mismatchedFields).toEqual(["originLocation"]);
  });
});
