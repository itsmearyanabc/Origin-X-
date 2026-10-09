import { describe, expect, it } from "vitest";
import { analyzeCustody, scoreTrust, trustLevel, type TrustSignals } from "../../src/services/trust.service.js";
import { publicState, type PublicStateInput } from "../../src/services/verification.service.js";

const perfect: TrustSignals = {
  organizationVerified: true,
  originVerified: true,
  custodyChainComplete: true,
  cryptographicChainValid: true,
  blockchainProofsValid: true,
  blockchainProofsInvalid: false,
  partnersVerified: true,
  identityUnique: true,
  identityCollision: false,
  tampered: false,
  custodyChainBroken: false,
  unresolvedIncidents: 0,
  openCriticalIncidents: 0,
};

describe("trust score", () => {
  it("is deterministic and explains itself", () => {
    const a = scoreTrust(perfect);
    expect(a).toEqual(scoreTrust({ ...perfect }));
    expect(a.score).toBe(100);
    expect(a.level).toBe("EXCELLENT");
    expect(a.explanation).toContain("VALID_BLOCKCHAIN_PROOFS");
  });

  it("applies the documented penalties", () => {
    const tampered = scoreTrust({ ...perfect, tampered: true, cryptographicChainValid: false, blockchainProofsValid: false, blockchainProofsInvalid: true });
    // 100 - 20 (chain) - 15 (proofs) - 40 (tampered) - 30 (invalid proof) = 0 (clamped)
    expect(tampered.score).toBe(0);
    expect(tampered.level).toBe("HIGH_RISK");

    const unverified = scoreTrust({ ...perfect, organizationVerified: false });
    expect(unverified.score).toBe(75); // -10 factor, -15 penalty
    expect(unverified.level).toBe("TRUSTED");

    const collision = scoreTrust({ ...perfect, identityCollision: true, identityUnique: false, unresolvedIncidents: 1, openCriticalIncidents: 1 });
    expect(collision.score).toBe(10); // 100 -10 -10 -50 -20
  });

  it("maps scores to levels", () => {
    expect([trustLevel(95), trustLevel(80), trustLevel(60), trustLevel(10)]).toEqual(["EXCELLENT", "TRUSTED", "CAUTION", "HIGH_RISK"]);
  });
});

describe("custody analysis", () => {
  const transfers = new Map([["t1", { fromOrganizationId: "A", toOrganizationId: "B" }]]);
  const ev = (sequence: number, eventType: string, actor: string, meta: object = {}) => ({ id: `e${sequence}`, sequence, eventType, actorOrganizationId: actor, metadataJson: JSON.stringify(meta) });

  it("accepts handoffs backed by accepted transfers", () => {
    const r = analyzeCustody([ev(1, "PRODUCT_REGISTERED", "A"), ev(2, "CUSTODY_TRANSFERRED", "B", { custodyTransferId: "t1", fromOrganizationId: "A", toOrganizationId: "B" }), ev(3, "DELIVERED", "B")], "A", "B", transfers);
    expect(r.consistent).toBe(true);
    expect(r.custodians).toEqual(["A", "B"]);
  });

  it("flags custody events recorded by a non-custodian", () => {
    const r = analyzeCustody([ev(1, "PRODUCT_REGISTERED", "A"), ev(2, "WAREHOUSE_RECEIVED", "C")], "A", "A", transfers);
    expect(r.consistent).toBe(false);
  });

  it("flags handoffs without an accepted transfer", () => {
    const r = analyzeCustody([ev(1, "PRODUCT_REGISTERED", "A"), ev(2, "CUSTODY_TRANSFERRED", "B", { custodyTransferId: "forged", fromOrganizationId: "A", toOrganizationId: "B" })], "A", "B", transfers);
    expect(r.consistent).toBe(false);
  });
});

describe("public verification state", () => {
  const ok: PublicStateInput = {
    found: true,
    identityStatus: "ACTIVE",
    identityCanonical: true,
    authenticityStatus: "AUTHENTIC",
    productStatus: "ACTIVE",
    activeRecall: false,
    historyValid: true,
    blockchainStatus: "VERIFIED",
    organizationActive: true,
    suspiciousPattern: false,
  };

  it("never reports a recalled product as verified", () => {
    expect(publicState({ ...ok, activeRecall: true })).toBe("RECALLED");
    expect(publicState({ ...ok, productStatus: "RECALLED", identityStatus: "RECALLED" })).toBe("RECALLED");
  });

  it("follows the documented precedence", () => {
    expect(publicState({ ...ok, found: false })).toBe("UNKNOWN");
    expect(publicState(ok)).toBe("HISTORY_VERIFIED");
    expect(publicState({ ...ok, blockchainStatus: "PARTIALLY_ANCHORED" })).toBe("AUTHENTIC");
    expect(publicState({ ...ok, identityCanonical: false, activeRecall: true })).toBe("COUNTERFEIT");
    expect(publicState({ ...ok, historyValid: false, activeRecall: true })).toBe("HISTORY_COMPROMISED");
    expect(publicState({ ...ok, suspiciousPattern: true })).toBe("SUSPICIOUS");
    expect(publicState({ ...ok, organizationActive: false })).toBe("SUSPICIOUS");
  });
});
