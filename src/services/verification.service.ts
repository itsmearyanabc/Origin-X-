import { config } from "../config.js";
import { ACTIVE_RECALL_STATUS, OPEN_INCIDENT_STATUS, PUBLIC_STATES, type PublicState } from "../lib/constants.js";
import { PUBLIC_TOKEN_PATTERN, sha256 } from "../lib/crypto.js";
import { json, prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { paginate, str, type Query } from "../lib/pagination.js";
import { writeAudit } from "./audit.service.js";
import { blockchainService } from "./blockchain.service.js";
import { hashChainService, type HistoryVerification } from "./hash-chain.service.js";
import { incidentService } from "./incident.service.js";
import { readableProductWhere } from "./product-access.js";
import { trustScoreService, type TrustResult } from "./trust.service.js";

export type PublicStateInput = {
  found: boolean;
  identityStatus: string | null;
  identityCanonical: boolean;
  authenticityStatus: string;
  productStatus: string;
  activeRecall: boolean;
  historyValid: boolean;
  blockchainStatus: string;
  organizationActive: boolean;
  suspiciousPattern: boolean;
};

/**
 * Consumer-facing verification state. Order matters: a recalled product is NEVER reported as
 * verified, and integrity failures outrank everything except counterfeit detection.
 */
export function publicState(s: PublicStateInput): PublicState {
  if (!s.found) return PUBLIC_STATES.UNKNOWN;
  if (!s.identityCanonical || s.identityStatus === "COUNTERFEIT" || s.authenticityStatus === "COUNTERFEIT") return PUBLIC_STATES.COUNTERFEIT;
  if (!s.historyValid) return PUBLIC_STATES.HISTORY_COMPROMISED;
  if (s.activeRecall || s.productStatus === "RECALLED" || s.identityStatus === "RECALLED") return PUBLIC_STATES.RECALLED;
  if (["SUSPENDED", "REVOKED"].includes(s.identityStatus ?? "") || s.productStatus === "SUSPENDED" || !s.organizationActive || s.suspiciousPattern) {
    return PUBLIC_STATES.SUSPICIOUS;
  }
  if (s.blockchainStatus === "VERIFIED") return PUBLIC_STATES.HISTORY_VERIFIED;
  if (s.identityStatus === "ACTIVE") return PUBLIC_STATES.AUTHENTIC;
  return PUBLIC_STATES.SUSPICIOUS;
}

export const STATE_COPY: Record<PublicState, { headline: string; detail: string; tone: "positive" | "warning" | "danger" | "neutral" }> = {
  AUTHENTIC: {
    headline: "Product identity verified.",
    detail: "This identity matches a product registered by its manufacturer. Blockchain proofs are still being confirmed.",
    tone: "positive",
  },
  HISTORY_VERIFIED: {
    headline: "Lifecycle history cryptographically verified.",
    detail: "Identity, every lifecycle event and the on-chain proofs all passed integrity verification.",
    tone: "positive",
  },
  RECALLED: {
    headline: "⚠ Product identity verified, but this product has been RECALLED.",
    detail: "Do not use this product. Follow the manufacturer's recall instructions.",
    tone: "danger",
  },
  SUSPICIOUS: {
    headline: "Product identity could not be fully verified.",
    detail: "Some authenticity checks did not pass. Buy only from authorized sellers and contact the manufacturer if unsure.",
    tone: "warning",
  },
  COUNTERFEIT: {
    headline: "This product identity conflicts with an existing registered product.",
    detail: "This may be a counterfeit. Do not use it and report where you obtained it.",
    tone: "danger",
  },
  HISTORY_COMPROMISED: {
    headline: "The product history failed integrity verification.",
    detail: "Records for this product were altered after they were sealed. Treat this product as unverified.",
    tone: "danger",
  },
  UNKNOWN: {
    headline: "No verified product identity was found.",
    detail: "This code does not match any ORIGINX product passport.",
    tone: "neutral",
  },
};

type Assessment = { history: HistoryVerification; trust: TrustResult & { custody?: { consistent: boolean; issues: string[] } } };

export class VerificationService {
  /**
   * IDENTIFY → VERIFY → DETECT → RESPOND. Verifies the history, opens incidents for integrity
   * failures (deduplicated), then scores trust with those findings included.
   */
  async assess(productId: string): Promise<Assessment> {
    const history = await hashChainService.verifyProductHistory(productId);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, include: { identity: true } });

    if (!history.historyValid) {
      await incidentService.ensureSystemIncident({
        organizationId: product.organizationId,
        productId,
        type: "TAMPERED_RECORD",
        severity: "CRITICAL",
        title: "Product history failed integrity verification",
        description: `Integrity verification failed from event #${history.firstCompromisedSequence ?? "?"}. ${history.tamperedEvents.length} tampered event(s), ${history.brokenLinks.length} broken link(s).`,
        evidence: {
          tamperedEvents: history.tamperedEvents,
          brokenLinks: history.brokenLinks,
          sequenceGaps: history.sequenceGaps,
          passportIntegrity: history.passportIntegrity,
          verifiedAt: history.verificationTimestamp,
        },
        recalculateTrust: false,
      });
    }
    if (history.blockchainVerification.proofMismatches > 0) {
      await incidentService.ensureSystemIncident({
        organizationId: product.organizationId,
        productId,
        type: "INVALID_BLOCKCHAIN_PROOF",
        severity: "CRITICAL",
        title: "Stored records do not match blockchain proofs",
        description: "One or more anchored proofs no longer match the database — records were rewritten after anchoring.",
        evidence: { proofs: history.blockchainVerification.proofs.filter((p) => p.result !== "VERIFIED") },
        recalculateTrust: false,
      });
    }
    if (!history.historyValid && product.verificationStatus !== "POTENTIAL_COUNTERFEIT") {
      await prisma.product.update({ where: { id: productId }, data: { verificationStatus: "COMPROMISED" } });
    } else if (history.historyValid && history.blockchainVerification.status === "VERIFIED" && product.verificationStatus === "REGISTERED") {
      await prisma.product.update({ where: { id: productId }, data: { verificationStatus: "VERIFIED" } });
    }

    const trust = await trustScoreService.calculate(productId, history);
    if (trust.custody && !trust.custody.consistent) {
      await incidentService.ensureSystemIncident({
        organizationId: product.organizationId,
        productId,
        type: "BROKEN_CUSTODY_CHAIN",
        severity: "HIGH",
        title: "Custody chain is inconsistent",
        description: trust.custody.issues.join(" "),
        evidence: { issues: trust.custody.issues },
      });
    }
    return { history, trust };
  }

  /** Public, unauthenticated verification (QR scan). Returns only the approved public passport. */
  async verifyPublic(token: string, meta: { ipHash: string; userAgent?: string; source?: "PUBLIC" | "ORG_SCAN" }) {
    const source = meta.source ?? "PUBLIC";
    const log = (productId: string | null, result: string) =>
      prisma.verificationLog.create({
        data: {
          productId,
          verificationTokenHash: sha256(token),
          result,
          ipHash: meta.ipHash,
          userAgentHash: meta.userAgent ? sha256(meta.userAgent) : null,
          source,
        },
      });

    const product = PUBLIC_TOKEN_PATTERN.test(token)
      ? await prisma.product.findUnique({
          where: { publicVerificationToken: token },
          include: { identity: true, organization: true, batch: true },
        })
      : null;

    if (!product) {
      await log(null, PUBLIC_STATES.UNKNOWN);
      return { found: false as const, result: { state: PUBLIC_STATES.UNKNOWN, ...STATE_COPY.UNKNOWN, verifiedAt: new Date().toISOString() } };
    }

    const { history, trust } = await this.assess(product.id);
    const suspiciousPattern = source === "PUBLIC" ? await this.detectCloneScans(product.id, product.organizationId) : false;

    const fresh = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
      include: {
        identity: true,
        organization: true,
        manufacturer: true,
        batch: true,
        recalls: { where: { status: { in: ACTIVE_RECALL_STATUS } }, orderBy: { initiatedAt: "desc" } },
        incidents: { where: { status: { in: OPEN_INCIDENT_STATUS }, type: { in: ["IDENTITY_COLLISION", "COUNTERFEIT", "TAMPERED_RECORD", "INVALID_BLOCKCHAIN_PROOF", "SUSPICIOUS_VERIFICATION_PATTERN"] } } },
        events: {
          orderBy: { sequence: "asc" },
          include: { organization: { select: { name: true, organizationType: true, verificationStatus: true } } },
        },
      },
    });

    const state = publicState({
      found: true,
      identityStatus: fresh.identity?.status ?? null,
      identityCanonical: fresh.identity?.isCanonical ?? false,
      authenticityStatus: fresh.authenticityStatus,
      productStatus: fresh.status,
      activeRecall: fresh.recalls.length > 0,
      historyValid: history.historyValid,
      blockchainStatus: history.blockchainVerification.status,
      organizationActive: fresh.organization.status === "ACTIVE",
      suspiciousPattern,
    });

    await log(fresh.id, state);
    await writeAudit({
      organizationId: fresh.organizationId,
      action: "VERIFICATION_PERFORMED",
      resourceType: "Product",
      resourceId: fresh.id,
      metadata: { state, source },
      ipHash: meta.ipHash,
    });

    const checks = history.events;
    const statusBySequence = new Map(checks.map((c) => [c.sequence, c.status]));
    const proofBySequence = new Map(history.blockchainVerification.proofs.map((p) => [p.sequence, p]));
    const bc = history.blockchainVerification;
    const warnings: string[] = [];
    if (fresh.incidents.some((i) => i.type === "IDENTITY_COLLISION") && state !== PUBLIC_STATES.COUNTERFEIT) {
      warnings.push("Someone attempted to register a copy of this product's identity. Make sure the code on your product matches this page.");
    }
    if (suspiciousPattern) warnings.push("This code has been scanned unusually often in many places. It may have been copied onto counterfeit packaging.");
    const genuineRecord = state !== PUBLIC_STATES.COUNTERFEIT;
    if (genuineRecord && (bc.status === "PARTIALLY_ANCHORED" || bc.status === "NOT_ANCHORED")) warnings.push("Some blockchain proofs for this product are still being confirmed.");
    if (genuineRecord && bc.status === "UNAVAILABLE") warnings.push("The blockchain network could not be reached; on-chain proofs were not re-checked just now.");

    return {
      found: true as const,
      result: {
        state,
        ...STATE_COPY[state],
        verifiedAt: history.verificationTimestamp,
        identityVerified: state !== PUBLIC_STATES.COUNTERFEIT,
        historyVerified: history.historyValid,
        blockchainVerified: bc.status === "VERIFIED",
        recalled: state === PUBLIC_STATES.RECALLED || fresh.recalls.length > 0,
        warnings,
        passport: {
          productName: fresh.productName,
          productCode: fresh.productCode,
          serialNumber: fresh.serialNumber,
          category: fresh.category,
          description: fresh.description,
          brand: { name: (fresh.manufacturer ?? fresh.organization).name, verified: fresh.organization.verificationStatus === "VERIFIED", country: fresh.organization.country },
          batch: fresh.batch?.batchCode ?? null,
          origin: { country: fresh.originCountry, location: fresh.originLocation },
          manufacturingDate: fresh.manufacturingDate,
          expiryDate: fresh.expiryDate,
          currentStatus: fresh.status,
          trust: {
            score: trust.score,
            level: trust.level,
            // The score rates the authenticity of the record, never the safety of a recalled product.
            note: state === PUBLIC_STATES.RECALLED ? "This score rates the authenticity of the product record, not its safety. The product is recalled — do not use it." : null,
            factors: trust.factors.filter((f) => f.applied).map((f) => f.code), penalties: trust.penalties.filter((p) => p.applied).map((p) => p.code),
          },
          integrity: {
            eventsVerified: history.verifiedEventCount,
            eventCount: history.eventCount,
            firstCompromisedEvent: history.firstCompromisedSequence,
          },
          recall: fresh.recalls[0]
            ? { status: fresh.recalls[0].status, initiatedAt: fresh.recalls[0].initiatedAt, reason: fresh.recalls[0].reason, affectedBatch: fresh.batch?.batchCode ?? null }
            : null,
          lifecycle: fresh.events.map((e) => {
            const proof = proofBySequence.get(e.sequence);
            return {
              sequence: e.sequence,
              eventType: e.eventType,
              timestamp: e.timestamp,
              location: e.location,
              organization: e.organization ? { name: e.organization.name, role: e.organization.organizationType, verified: e.organization.verificationStatus === "VERIFIED" } : null,
              eventHash: e.eventHash,
              integrity: statusBySequence.get(e.sequence) ?? "VALID",
              blockchain: proof ? { result: proof.result, transactionHash: proof.transactionHash, explorerUrl: blockchainService.explorerUrl(proof.transactionHash) } : null,
            };
          }),
          blockchain: {
            status: bc.status,
            network: bc.network,
            chainId: bc.chainId,
            contractAddress: bc.contractAddress,
            identity: bc.identity
              ? { identityHash: bc.identity.identityHash, transactionHash: bc.identity.transactionHash, explorerUrl: blockchainService.explorerUrl(bc.identity.transactionHash) }
              : null,
            verifiedEvents: bc.verifiedEvents,
            anchoredEvents: bc.anchoredEvents,
          },
        },
      },
    };
  }

  /**
   * DETECT: one physical unit's code scanned by many distinct clients within 24h suggests the QR
   * was copied onto counterfeit packaging. Raises a (deduplicated) incident for the brand owner.
   */
  private async detectCloneScans(productId: string, organizationId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const scanners = await prisma.verificationLog.groupBy({
      by: ["ipHash"],
      where: { productId, source: "PUBLIC", timestamp: { gte: since }, ipHash: { not: null } },
    });
    const suspicious = scanners.length >= config.verification.cloneScanThreshold;
    if (suspicious) {
      await incidentService.ensureSystemIncident({
        organizationId,
        productId,
        type: "SUSPICIOUS_VERIFICATION_PATTERN",
        severity: "HIGH",
        title: "Possible cloned verification code",
        description: `This product's code was verified by ${scanners.length} distinct clients in 24 hours (threshold ${config.verification.cloneScanThreshold}).`,
        evidence: { distinctScanners24h: scanners.length, threshold: config.verification.cloneScanThreshold },
      });
    }
    const open = await prisma.incident.count({ where: { productId, type: "SUSPICIOUS_VERIFICATION_PATTERN", status: { in: OPEN_INCIDENT_STATUS } } });
    return suspicious || open > 0;
  }

  /** Private Digital Product Passport for organizations with access to the product. */
  async privatePassport(organizationId: string, productId: string) {
    const product = await prisma.product.findFirst({ where: { AND: [{ id: productId }, readableProductWhere(organizationId)] } });
    if (!product) throw notFound("Product");
    const { history, trust } = await this.assess(productId);
    const full = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: {
        identity: true,
        batch: true,
        organization: { select: { id: true, name: true, verificationStatus: true, country: true } },
        currentOwner: { select: { id: true, name: true, organizationType: true, verificationStatus: true } },
        recalls: { orderBy: { createdAt: "desc" } },
        incidents: { where: { organizationId }, orderBy: { createdAt: "desc" } },
        transfers: {
          orderBy: { createdAt: "asc" },
          include: { fromOrg: { select: { id: true, name: true } }, toOrg: { select: { id: true, name: true } } },
        },
        _count: { select: { verifications: true } },
      },
    });
    const { trustScoreJson: _t, incidents, ...rest } = full;
    return {
      identity: {
        productCode: full.productCode,
        serialNumber: full.serialNumber,
        identityHash: full.identity?.identityHash,
        canonical: full.identity?.isCanonical,
        status: full.identity?.status,
        blockchainIdentity: full.blockchainIdentity,
      },
      product: rest,
      custody: { currentOwner: full.currentOwner, transfers: full.transfers, analysis: trust.custody },
      lifecycle: await prisma.productEvent.findMany({
        where: { productId },
        orderBy: { sequence: "asc" },
        select: { id: true, sequence: true, eventType: true, timestamp: true, location: true, actorOrganizationId: true, eventHash: true, previousEventHash: true, verificationStatus: true },
      }),
      verification: history,
      trust,
      incidents: incidents.map(({ evidenceJson, ...i }) => ({ ...i, evidence: json(evidenceJson) })),
      recalls: full.recalls,
      verificationCount: full._count.verifications,
    };
  }

  async productVerificationLogs(organizationId: string, productId: string, q: Query) {
    const product = await prisma.product.findFirst({ where: { id: productId, organizationId } });
    if (!product) throw notFound("Product");
    return this.logs({ productId }, q);
  }

  async organizationVerificationLogs(organizationId: string, q: Query) {
    return this.logs({ product: { organizationId } }, q);
  }

  private async logs(where: Record<string, unknown>, q: Query) {
    const filter = { ...where, ...(str(q, "result") ? { result: str(q, "result") } : {}) };
    return paginate(
      q,
      () => prisma.verificationLog.count({ where: filter }),
      (page) =>
        prisma.verificationLog.findMany({
          where: filter,
          ...page,
          orderBy: { timestamp: "desc" },
          select: { id: true, productId: true, timestamp: true, result: true, source: true, ipHash: true },
        }),
    );
  }
}

export const verificationService = new VerificationService();
