import { CUSTODIAN_EVENT_TYPES, OPEN_INCIDENT_STATUS, type EventType } from "../lib/constants.js";
import { json, prisma } from "../lib/prisma.js";
import { hashChainService, type HistoryVerification } from "./hash-chain.service.js";

export type TrustLevel = "EXCELLENT" | "TRUSTED" | "CAUTION" | "HIGH_RISK";

export type TrustSignals = {
  organizationVerified: boolean;
  originVerified: boolean;
  custodyChainComplete: boolean;
  cryptographicChainValid: boolean;
  blockchainProofsValid: boolean;
  blockchainProofsInvalid: boolean;
  partnersVerified: boolean;
  identityUnique: boolean;
  identityCollision: boolean;
  tampered: boolean;
  custodyChainBroken: boolean;
  unresolvedIncidents: number;
  openCriticalIncidents: number;
};

export type TrustItem = { code: string; points: number; applied: boolean; reason: string };
export type TrustResult = {
  score: number;
  level: TrustLevel;
  factors: TrustItem[];
  penalties: TrustItem[];
  explanation: string;
  signals: TrustSignals;
  calculatedAt: string;
  custody?: ReturnType<typeof analyzeCustody>;
};

export function trustLevel(score: number): TrustLevel {
  if (score >= 90) return "EXCELLENT";
  if (score >= 75) return "TRUSTED";
  if (score >= 50) return "CAUTION";
  return "HIGH_RISK";
}

/**
 * Deterministic trust score (0–100). Same signals in → same score out. No randomness, no time
 * dependence, no AI. Every point is traceable to a named factor or penalty.
 */
export function scoreTrust(s: TrustSignals): Omit<TrustResult, "calculatedAt"> {
  const factors: TrustItem[] = [
    { code: "VERIFIED_ORGANIZATION", points: 10, applied: s.organizationVerified, reason: "Registering organization is verified by ORIGINX." },
    { code: "VERIFIED_ORIGIN", points: 10, applied: s.originVerified, reason: "Origin is declared and sealed in the registration record." },
    { code: "COMPLETE_CUSTODY_CHAIN", points: 15, applied: s.custodyChainComplete, reason: "Every custody handoff was requested and accepted by both parties." },
    { code: "VALID_CRYPTOGRAPHIC_CHAIN", points: 20, applied: s.cryptographicChainValid, reason: "Every event hash recomputes and links to its predecessor." },
    { code: "VALID_BLOCKCHAIN_PROOFS", points: 15, applied: s.blockchainProofsValid, reason: "Anchored proofs match the on-chain record." },
    { code: "VERIFIED_SUPPLY_CHAIN_PARTNERS", points: 10, applied: s.partnersVerified, reason: "All custodians are verified organizations." },
    { code: "UNIQUE_PRODUCT_IDENTITY", points: 10, applied: s.identityUnique, reason: "Product identity is unique and not in collision." },
    { code: "NO_UNRESOLVED_INCIDENTS", points: 10, applied: s.unresolvedIncidents === 0, reason: "No open incidents." },
  ];
  const penalties: TrustItem[] = [
    { code: "TAMPERED_EVENT", points: -40, applied: s.tampered, reason: "History failed integrity verification." },
    { code: "IDENTITY_COLLISION", points: -50, applied: s.identityCollision, reason: "Identity conflicts with an existing registered product." },
    { code: "BROKEN_CUSTODY_CHAIN", points: -20, applied: s.custodyChainBroken, reason: "Custody events are inconsistent with recorded handoffs." },
    { code: "INVALID_PROOF", points: -30, applied: s.blockchainProofsInvalid, reason: "An anchored proof does not match the blockchain." },
    { code: "UNVERIFIED_ORGANIZATION", points: -15, applied: !s.organizationVerified, reason: "Registering organization is not verified." },
    { code: "OPEN_CRITICAL_INCIDENT", points: -20, applied: s.openCriticalIncidents > 0, reason: "A critical incident is open." },
  ];
  let score = 0;
  for (const item of [...factors, ...penalties]) if (item.applied) score += item.points;
  score = Math.max(0, Math.min(100, score));
  const level = trustLevel(score);
  const explanation = [
    `Trust score ${score}/100 (${level}).`,
    ...factors.filter((f) => f.applied).map((f) => `+${f.points} ${f.code}`),
    ...factors.filter((f) => !f.applied).map((f) => `+0 ${f.code} (not met)`),
    ...penalties.filter((p) => p.applied).map((p) => `${p.points} ${p.code}`),
  ].join(" ");
  return { score, level, factors, penalties, explanation, signals: s };
}

type CustodyEvent = { id: string; sequence: number; eventType: string; actorOrganizationId: string | null; metadataJson: string };

/**
 * Rebuilds custody from the event chain and checks it against accepted CustodyTransfer records:
 * every handoff must reference an accepted transfer from the then-current custodian, and every
 * custodian-only event must be recorded by the then-current custodian.
 */
export function analyzeCustody(
  events: CustodyEvent[],
  registeringOrganizationId: string,
  currentOwnerOrganizationId: string | null,
  acceptedTransfers: Map<string, { fromOrganizationId: string; toOrganizationId: string }>,
  shipments: Map<string, { senderOrganizationId: string; receiverOrganizationId: string }> = new Map(),
) {
  const issues: string[] = [];
  let custodian = registeringOrganizationId;
  const custodians = [custodian];
  let handoffs = 0;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    const meta = json<{ custodyTransferId?: string; fromOrganizationId?: string; toOrganizationId?: string; inventoryShipmentId?: string; shipmentRole?: string }>(event.metadataJson);
    if (meta.inventoryShipmentId) {
      // Quantity movement of a batch (inventory layer): valid only if recorded by the right party of
      // a real shipment. Whole-passport custody is unaffected.
      const shipment = shipments.get(meta.inventoryShipmentId);
      const expected = meta.shipmentRole === "RECEIPT" ? shipment?.receiverOrganizationId : shipment?.senderOrganizationId;
      if (!shipment) issues.push(`Event #${event.sequence} references a shipment that does not exist.`);
      else if (event.actorOrganizationId !== expected) issues.push(`Event #${event.sequence} was recorded by an organization that is not party to its shipment.`);
      continue;
    }
    if (meta.custodyTransferId) {
      handoffs += 1;
      const transfer = acceptedTransfers.get(meta.custodyTransferId);
      if (!transfer) issues.push(`Event #${event.sequence} references a custody transfer that was never accepted.`);
      if (meta.fromOrganizationId !== custodian || (transfer && transfer.fromOrganizationId !== custodian)) {
        issues.push(`Event #${event.sequence} hands off custody from an organization that did not hold it.`);
      }
      if (event.actorOrganizationId !== meta.toOrganizationId) {
        issues.push(`Event #${event.sequence} handoff was not recorded by the receiving organization.`);
      }
      custodian = meta.toOrganizationId ?? custodian;
      custodians.push(custodian);
    } else if (CUSTODIAN_EVENT_TYPES.includes(event.eventType as EventType) && event.actorOrganizationId !== custodian) {
      issues.push(`Event #${event.sequence} (${event.eventType}) was recorded by an organization without custody.`);
    }
  }
  if (currentOwnerOrganizationId && currentOwnerOrganizationId !== custodian) {
    issues.push("Current custodian does not match the custody chain.");
  }
  return { consistent: issues.length === 0, issues, handoffs, custodians: [...new Set(custodians)] };
}

export class TrustScoreService {
  async calculate(productId: string, history?: HistoryVerification): Promise<TrustResult> {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: {
        organization: true,
        identity: true,
        events: { orderBy: { sequence: "asc" } },
        incidents: true,
        transfers: { where: { status: "TRANSFER_ACCEPTED" } },
      },
    });
    const verification = history ?? (await hashChainService.verifyProductHistory(productId));
    const shipmentIds = product.events.map((e) => json<{ inventoryShipmentId?: string }>(e.metadataJson).inventoryShipmentId).filter(Boolean) as string[];
    const shipments = shipmentIds.length
      ? await prisma.shipment.findMany({ where: { id: { in: shipmentIds } }, select: { id: true, senderOrganizationId: true, receiverOrganizationId: true } })
      : [];
    const custody = analyzeCustody(
      product.events,
      product.organizationId,
      product.currentOwnerOrganizationId,
      new Map(product.transfers.map((t) => [t.id, t])),
      new Map(shipments.map((s) => [s.id, s])),
    );
    const custodianOrgs = await prisma.organization.findMany({ where: { id: { in: custody.custodians } } });
    const openIncidents = product.incidents.filter((i) => OPEN_INCIDENT_STATUS.includes(i.status));
    const identityCollision = Boolean(product.identity && (!product.identity.isCanonical || product.identity.status === "COUNTERFEIT"));
    const chainValid = verification.events.length > 0 && verification.tamperedEvents.length === 0 && verification.brokenLinks.length === 0 && verification.sequenceGaps.length === 0;
    const bc = verification.blockchainVerification;

    const signals: TrustSignals = {
      organizationVerified: product.organization.verificationStatus === "VERIFIED" && product.organization.status === "ACTIVE",
      originVerified: Boolean(product.originCountry && product.originLocation && verification.passportIntegrity.checked && verification.passportIntegrity.valid),
      custodyChainComplete: custody.consistent && product.events.length > 0,
      cryptographicChainValid: chainValid && verification.passportIntegrity.valid,
      blockchainProofsValid: bc.status === "VERIFIED",
      blockchainProofsInvalid: bc.proofMismatches > 0,
      partnersVerified: custodianOrgs.length > 0 && custodianOrgs.every((o) => o.verificationStatus === "VERIFIED" && o.status === "ACTIVE"),
      identityUnique: Boolean(product.identity?.isCanonical) && !identityCollision && ["ACTIVE", "RECALLED"].includes(product.identity?.status ?? ""),
      identityCollision,
      tampered: !verification.historyValid,
      custodyChainBroken: !custody.consistent,
      unresolvedIncidents: openIncidents.length,
      openCriticalIncidents: openIncidents.filter((i) => i.severity === "CRITICAL").length,
    };
    const result: TrustResult = { ...scoreTrust(signals), calculatedAt: new Date().toISOString() };
    const riskLevel = identityCollision || signals.tampered ? "CRITICAL" : result.level === "HIGH_RISK" ? "HIGH" : result.level === "CAUTION" ? "MEDIUM" : "LOW";

    await prisma.product.update({
      where: { id: productId },
      data: { trustScore: result.score, trustLevel: result.level, riskLevel, trustScoreJson: JSON.stringify(result), trustCalculatedAt: new Date() },
    });
    if (product.trustScore !== result.score || product.trustLevel !== result.level || !product.trustCalculatedAt) {
      await prisma.trustScoreSnapshot.create({
        data: {
          productId,
          score: result.score,
          level: result.level,
          reasonsJson: JSON.stringify({ applied: [...result.factors, ...result.penalties].filter((i) => i.applied).map((i) => i.code) }),
        },
      });
    }
    return { ...result, custody };
  }

  async history(productId: string) {
    const snapshots = await prisma.trustScoreSnapshot.findMany({ where: { productId }, orderBy: { createdAt: "asc" } });
    return snapshots.map(({ reasonsJson, ...s }) => ({ ...s, reasons: json(reasonsJson) }));
  }
}

export const trustScoreService = new TrustScoreService();
