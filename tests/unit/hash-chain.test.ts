import { describe, expect, it } from "vitest";
import { GENESIS_HASH } from "../../src/lib/constants.js";
import { canonicalIdentityHash, canonicalize, computeEventHash, hashEventPayload } from "../../src/lib/crypto.js";
import { verifyEventChain, type ChainEvent } from "../../src/services/hash-chain.service.js";

function buildChain(types: string[]): ChainEvent[] {
  const events: ChainEvent[] = [];
  let previous = GENESIS_HASH;
  types.forEach((eventType, i) => {
    const base = {
      id: `evt-${i + 1}`,
      productId: "prod-1",
      sequence: i + 1,
      eventType,
      actorUserId: "user-1",
      actorOrganizationId: "org-1",
      timestamp: new Date(Date.UTC(2026, 7, 1, i)),
      location: "Delhi, India",
      metadataJson: JSON.stringify({ step: i + 1 }),
      previousEventHash: previous,
    };
    const eventHash = computeEventHash(
      { ...base, timestamp: base.timestamp.toISOString(), metadata: JSON.parse(base.metadataJson) },
      previous,
    );
    events.push({ ...base, eventHash });
    previous = eventHash;
  });
  return events;
}

describe("canonicalization", () => {
  it("is deterministic regardless of key order", () => {
    expect(canonicalize({ b: 1, a: { d: [1, 2], c: "x" } })).toBe(canonicalize({ a: { c: "x", d: [1, 2] }, b: 1 }));
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("produces different hashes for different payloads or predecessors", () => {
    const h1 = hashEventPayload({ a: 1 }, GENESIS_HASH);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEventPayload({ a: 1 }, GENESIS_HASH)).toBe(h1);
    expect(hashEventPayload({ a: 2 }, GENESIS_HASH)).not.toBe(h1);
    expect(hashEventPayload({ a: 1 }, "f".repeat(64))).not.toBe(h1);
  });

  it("derives an organization-independent canonical identity", () => {
    expect(canonicalIdentityHash("rx-29481", " a92 ")).toBe(canonicalIdentityHash("RX-29481", "A92"));
    expect(canonicalIdentityHash("RX-29481", "A92")).not.toBe(canonicalIdentityHash("RX-29481", "A93"));
  });
});

describe("verifyEventChain", () => {
  it("accepts an untouched chain", () => {
    const result = verifyEventChain(buildChain(["PRODUCT_REGISTERED", "MANUFACTURED", "QUALITY_APPROVED"]));
    expect(result.chainValid).toBe(true);
    expect(result.tamperedEvents).toHaveLength(0);
    expect(result.brokenLinks).toHaveLength(0);
  });

  it("CRITICAL: events A, B, C — modifying B fails verification", () => {
    const [a, b, c] = buildChain(["EVENT_A", "EVENT_B", "EVENT_C"]);
    const tamperedB = { ...b, location: "Somewhere else" };
    const result = verifyEventChain([a, tamperedB, c]);
    expect(result.chainValid).toBe(false);
    expect(result.tamperedEvents.map((t) => t.eventId)).toEqual(["evt-2"]);
    expect(result.affectedEvents).toEqual(["evt-2", "evt-3"]);
    expect(result.checks.find((x) => x.eventId === "evt-1")?.status).toBe("VALID");
    expect(result.checks.find((x) => x.eventId === "evt-3")?.status).toBe("AFFECTED");
  });

  it("detects a re-hashed event through the broken link to its successor", () => {
    const [a, b, c] = buildChain(["EVENT_A", "EVENT_B", "EVENT_C"]);
    const edited = { ...b, metadataJson: JSON.stringify({ step: 99 }) };
    const rehashed = { ...edited, eventHash: computeEventHash({ ...edited, timestamp: edited.timestamp.toISOString(), metadata: { step: 99 } }, edited.previousEventHash) };
    const result = verifyEventChain([a, rehashed, c]);
    expect(result.chainValid).toBe(false);
    expect(result.tamperedEvents).toHaveLength(0);
    expect(result.brokenLinks.map((l) => l.eventId)).toEqual(["evt-3"]);
  });

  it("detects deleted events as sequence gaps", () => {
    const [a, , c] = buildChain(["EVENT_A", "EVENT_B", "EVENT_C"]);
    const result = verifyEventChain([a, c]);
    expect(result.chainValid).toBe(false);
    expect(result.sequenceGaps).toEqual([{ expected: 2, found: 3 }]);
  });

  it("treats unparseable metadata as tampering", () => {
    const [a, b] = buildChain(["EVENT_A", "EVENT_B"]);
    const result = verifyEventChain([a, { ...b, metadataJson: "{not json" }]);
    expect(result.tamperedEvents.map((t) => t.eventId)).toEqual(["evt-2"]);
  });
});
