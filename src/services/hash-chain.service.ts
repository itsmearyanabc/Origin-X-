/**
 * Cryptographic event chain verification.
 *
 *   eventHash(n) = SHA-256( canonical(payload(n)) | previousEventHash(n) )
 *   previousEventHash(n) must equal eventHash(n-1); genesis uses 64 zeros.
 *
 * Three independent layers are checked:
 *  1. Content    — recompute each event hash from its stored payload (detects edited events).
 *  2. Linkage    — each previousEventHash must equal the stored hash of the event before it and
 *                  sequences must be contiguous (detects re-hashed, inserted or deleted events).
 *  3. Blockchain — each anchored hash is read back from the OriginXProofAnchor contract and compared
 *                  with the stored and recomputed hashes. This catches the strongest attacker, who
 *                  rewrites an event AND recomputes every downstream hash so layers 1–2 pass.
 */
import { GENESIS_HASH } from "../lib/constants.js";
import { computeEventHash } from "../lib/crypto.js";
import { json, prisma } from "../lib/prisma.js";
import { blockchainService } from "./blockchain.service.js";

export type ChainEvent = {
  id: string;
  productId: string;
  sequence: number;
  eventType: string;
  actorUserId: string | null;
  actorOrganizationId: string | null;
  timestamp: Date;
  location: string | null;
  metadataJson: string;
  previousEventHash: string;
  eventHash: string;
};

export type EventCheck = {
  eventId: string;
  sequence: number;
  eventType: string;
  storedHash: string;
  recomputedHash: string;
  contentValid: boolean;
  linkValid: boolean;
  status: "VALID" | "TAMPERED" | "BROKEN_LINK" | "AFFECTED";
};

function parseMetadata(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Unparseable metadata can only come from direct tampering; hash the raw text so it mismatches.
    return { __unparseable: raw };
  }
}

export function recomputeEventHash(event: ChainEvent): string {
  return computeEventHash(
    {
      productId: event.productId,
      sequence: event.sequence,
      eventType: event.eventType,
      actorUserId: event.actorUserId,
      actorOrganizationId: event.actorOrganizationId,
      timestamp: event.timestamp.toISOString(),
      location: event.location,
      metadata: parseMetadata(event.metadataJson),
    },
    event.previousEventHash,
  );
}

/** Pure chain verification (layers 1–2). */
export function verifyEventChain(input: ChainEvent[]) {
  const events = [...input].sort((a, b) => a.sequence - b.sequence);
  const tamperedEvents: Array<{ eventId: string; sequence: number; eventType: string; storedHash: string; recomputedHash: string }> = [];
  const brokenLinks: Array<{ eventId: string; sequence: number; expectedPreviousHash: string; actualPreviousHash: string }> = [];
  const sequenceGaps: Array<{ expected: number; found: number }> = [];
  const checks: EventCheck[] = [];
  let expectedPrevious = GENESIS_HASH;
  let expectedSequence = 1;
  let firstFailure: number | null = null;

  for (const event of events) {
    const recomputedHash = recomputeEventHash(event);
    const contentValid = recomputedHash === event.eventHash;
    const linkValid = event.previousEventHash === expectedPrevious;
    if (event.sequence !== expectedSequence) {
      sequenceGaps.push({ expected: expectedSequence, found: event.sequence });
      firstFailure ??= event.sequence;
    }
    if (!contentValid) {
      tamperedEvents.push({ eventId: event.id, sequence: event.sequence, eventType: event.eventType, storedHash: event.eventHash, recomputedHash });
      firstFailure ??= event.sequence;
    }
    if (!linkValid) {
      brokenLinks.push({ eventId: event.id, sequence: event.sequence, expectedPreviousHash: expectedPrevious, actualPreviousHash: event.previousEventHash });
      firstFailure ??= event.sequence;
    }
    checks.push({
      eventId: event.id,
      sequence: event.sequence,
      eventType: event.eventType,
      storedHash: event.eventHash,
      recomputedHash,
      contentValid,
      linkValid,
      status: !contentValid ? "TAMPERED" : !linkValid ? "BROKEN_LINK" : "VALID",
    });
    expectedPrevious = event.eventHash;
    expectedSequence = event.sequence + 1;
  }

  // Everything from the first failure onwards can no longer be trusted.
  if (firstFailure !== null) {
    for (const check of checks) if (check.sequence > firstFailure && check.status === "VALID") check.status = "AFFECTED";
  }
  const affectedEvents = checks.filter((c) => firstFailure !== null && c.sequence >= firstFailure).map((c) => c.eventId);
  return {
    chainValid: firstFailure === null,
    eventCount: events.length,
    tamperedEvents,
    brokenLinks,
    sequenceGaps,
    affectedEvents,
    firstCompromisedSequence: firstFailure,
    checks,
  };
}

export type BlockchainEventResult =
  | "VERIFIED"
  | "HASH_MISMATCH"
  | "CONTENT_MISMATCH"
  | "NOT_ON_CHAIN"
  | "IDENTITY_MISMATCH"
  | "PENDING"
  | "NOT_ANCHORED"
  | "UNAVAILABLE";

const LOCAL_CHAIN_IDS = new Set([31337, 1337]);

/** Fields frozen at registration; any later change in the product row is tampering. */
export const PASSPORT_SNAPSHOT_FIELDS = [
  "productCode",
  "serialNumber",
  "batchCode",
  "originCountry",
  "originLocation",
  "manufacturingDate",
  "expiryDate",
  "manufacturerId",
] as const;

export function passportSnapshot(p: {
  productCode: string;
  serialNumber: string | null;
  batchCode: string | null;
  originCountry: string | null;
  originLocation: string | null;
  manufacturingDate: Date | null;
  expiryDate: Date | null;
  manufacturerId: string | null;
}) {
  return {
    productCode: p.productCode,
    serialNumber: p.serialNumber ?? null,
    batchCode: p.batchCode ?? null,
    originCountry: p.originCountry ?? null,
    originLocation: p.originLocation ?? null,
    manufacturingDate: p.manufacturingDate ? p.manufacturingDate.toISOString() : null,
    expiryDate: p.expiryDate ? p.expiryDate.toISOString() : null,
    manufacturerId: p.manufacturerId ?? null,
  };
}

export class HashChainService {
  async verifyProductHistory(productId: string) {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { identity: true, batch: true, events: { orderBy: { sequence: "asc" } } },
    });
    const chain = verifyEventChain(product.events);
    const checksById = new Map(chain.checks.map((c) => [c.eventId, c]));

    // Passport integrity: identity-defining fields must match the snapshot sealed in PRODUCT_REGISTERED.
    const registration = product.events.find((e) => e.eventType === "PRODUCT_REGISTERED");
    const sealed = json<{ passport?: Record<string, unknown> }>(registration?.metadataJson).passport;
    const current = passportSnapshot({ ...product, batchCode: product.batch?.batchCode ?? null });
    const mismatchedFields = sealed
      ? PASSPORT_SNAPSHOT_FIELDS.filter((f) => (sealed[f] ?? null) !== current[f])
      : [];
    const passportIntegrity = { checked: Boolean(sealed), valid: mismatchedFields.length === 0, mismatchedFields };

    // Blockchain layer.
    const proofs = await prisma.blockchainProof.findMany({ where: { productId }, orderBy: { createdAt: "asc" } });
    const eventProofs = proofs.filter((p) => p.kind === "EVENT");
    const identityProof = proofs.find((p) => p.kind === "IDENTITY" && p.status === "CONFIRMED");
    const confirmed = proofs.filter((p) => p.status === "CONFIRMED");

    let chainReachable = true;
    let localChainReset = false;
    let identityOnChain: Awaited<ReturnType<typeof blockchainService.lookupIdentity>> = null;
    if (identityProof) {
      identityOnChain = await blockchainService.lookupIdentity(identityProof.eventHash);
      if (identityOnChain === null) chainReachable = false;
      else if (!identityOnChain.exists && LOCAL_CHAIN_IDS.has(identityProof.chainId ?? 0)) localChainReset = true;
    }

    const eventResults: Array<{
      eventId: string | null;
      sequence: number | null;
      eventType: string | null;
      result: BlockchainEventResult;
      anchoredHash: string;
      storedHash: string | null;
      network: string;
      chainId: number | null;
      transactionHash: string | null;
      blockNumber: number | null;
      anchoredAt: number | null;
    }> = [];
    for (const proof of eventProofs) {
      const event = product.events.find((e) => e.id === proof.eventId);
      const check = proof.eventId ? checksById.get(proof.eventId) : undefined;
      let result: BlockchainEventResult;
      let anchoredAt: number | null = null;
      if (proof.status === "PENDING") result = "PENDING";
      else if (proof.status === "FAILED") result = "NOT_ANCHORED";
      else if (!chainReachable || localChainReset) result = "UNAVAILABLE";
      else {
        const onChain = await blockchainService.lookupEvent(proof.eventHash);
        if (onChain === null) {
          chainReachable = false;
          result = "UNAVAILABLE";
        } else if (!onChain.exists) result = "NOT_ON_CHAIN";
        else if (product.identity && onChain.identityHash !== product.identity.identityHash) result = "IDENTITY_MISMATCH";
        else if (!event || event.eventHash !== proof.eventHash) result = "HASH_MISMATCH";
        else if (check && check.recomputedHash !== proof.eventHash) result = "CONTENT_MISMATCH";
        else result = "VERIFIED";
        anchoredAt = onChain?.anchoredAt ?? null;
      }
      eventResults.push({
        eventId: proof.eventId,
        sequence: event?.sequence ?? null,
        eventType: event?.eventType ?? null,
        result,
        anchoredHash: proof.eventHash,
        storedHash: event?.eventHash ?? null,
        network: proof.network,
        chainId: proof.chainId,
        transactionHash: proof.transactionHash,
        blockNumber: proof.blockNumber,
        anchoredAt,
      });
    }

    const mismatches = eventResults.filter((r) => ["HASH_MISMATCH", "CONTENT_MISMATCH", "NOT_ON_CHAIN", "IDENTITY_MISMATCH"].includes(r.result));
    const verifiedCount = eventResults.filter((r) => r.result === "VERIFIED").length;
    const pendingCount = proofs.filter((p) => p.status === "PENDING").length;
    const identityMissing = Boolean(identityProof && identityOnChain && !identityOnChain.exists && !localChainReset);

    let blockchainStatus: "VERIFIED" | "PARTIALLY_ANCHORED" | "NOT_ANCHORED" | "MISMATCH" | "UNAVAILABLE";
    if (mismatches.length || identityMissing) blockchainStatus = "MISMATCH";
    else if (confirmed.length === 0) blockchainStatus = "NOT_ANCHORED";
    else if (!chainReachable || localChainReset) blockchainStatus = "UNAVAILABLE";
    else if (pendingCount > 0 || eventResults.some((r) => r.result === "NOT_ANCHORED")) blockchainStatus = "PARTIALLY_ANCHORED";
    else blockchainStatus = "VERIFIED";

    // Blockchain-proven tampering marks the affected events even when the DB chain looks intact.
    for (const m of mismatches) {
      const check = m.eventId ? checksById.get(m.eventId) : undefined;
      if (check && check.status === "VALID") check.status = "TAMPERED";
    }
    const blockchainFirstFailure = mismatches.reduce<number | null>(
      (min, m) => (m.sequence !== null && (min === null || m.sequence < min) ? m.sequence : min),
      null,
    );
    const firstCompromisedSequence =
      chain.firstCompromisedSequence === null
        ? blockchainFirstFailure
        : blockchainFirstFailure === null
          ? chain.firstCompromisedSequence
          : Math.min(chain.firstCompromisedSequence, blockchainFirstFailure);
    if (firstCompromisedSequence !== null) {
      for (const check of chain.checks) if (check.sequence > firstCompromisedSequence && check.status === "VALID") check.status = "AFFECTED";
    }
    const affectedEvents = chain.checks.filter((c) => firstCompromisedSequence !== null && c.sequence >= firstCompromisedSequence).map((c) => c.eventId);

    const historyValid = chain.chainValid && blockchainStatus !== "MISMATCH" && passportIntegrity.valid;
    const anchoredSequences = new Set(eventResults.filter((r) => r.result === "VERIFIED").map((r) => r.sequence));
    const lastAnchored = Math.max(0, ...[...anchoredSequences].filter((s): s is number => s !== null));

    return {
      productId,
      historyValid,
      integrity: historyValid ? ("VALID" as const) : ("COMPROMISED" as const),
      eventCount: chain.eventCount,
      verifiedEventCount: chain.checks.filter((c) => c.status === "VALID").length,
      tamperedEvents: [
        ...chain.tamperedEvents,
        ...mismatches
          .filter((m) => m.eventId && !chain.tamperedEvents.some((t) => t.eventId === m.eventId))
          .map((m) => ({
            eventId: m.eventId!,
            sequence: m.sequence ?? -1,
            eventType: m.eventType ?? "UNKNOWN",
            storedHash: m.storedHash ?? "",
            recomputedHash: checksById.get(m.eventId!)?.recomputedHash ?? "",
            anchoredHash: m.anchoredHash,
            detectedBy: "BLOCKCHAIN" as const,
          })),
      ],
      brokenLinks: chain.brokenLinks,
      sequenceGaps: chain.sequenceGaps,
      affectedEvents,
      firstCompromisedSequence,
      passportIntegrity,
      events: chain.checks,
      verificationTimestamp: new Date().toISOString(),
      blockchainVerification: {
        status: blockchainStatus,
        network: confirmed[0]?.network ?? blockchainService.networkName(),
        chainId: confirmed[0]?.chainId ?? null,
        contractAddress: confirmed[0]?.contractAddress ?? null,
        reason: localChainReset
          ? "Local development chain was restarted; its proofs no longer exist. Re-seed the demo (npm run db:reset)."
          : !chainReachable
            ? "Blockchain RPC is unreachable; on-chain proofs could not be re-checked."
            : undefined,
        identity: identityProof
          ? {
              identityHash: identityProof.eventHash,
              transactionHash: identityProof.transactionHash,
              registeredOnChain: identityOnChain?.exists ?? null,
              onChainStatus: identityOnChain?.status ?? null,
            }
          : null,
        anchoredEvents: eventResults.length,
        verifiedEvents: verifiedCount,
        // Anchored hash no longer matches the database (records re-hashed / proof invalid).
        proofMismatches: mismatches.filter((m) => m.result !== "CONTENT_MISMATCH").length + (identityMissing ? 1 : 0),
        // Proof still matches the stored hash but the stored content was edited.
        contentMismatches: mismatches.filter((m) => m.result === "CONTENT_MISMATCH").length,
        pendingProofs: pendingCount,
        // With a hash chain, anchoring event N also commits to every event before it.
        coveredThroughSequence: lastAnchored || null,
        proofs: eventResults,
      },
    };
  }
}

export type HistoryVerification = Awaited<ReturnType<HashChainService["verifyProductHistory"]>>;

export const hashChainService = new HashChainService();
