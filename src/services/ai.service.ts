/**
 * ASK ORIGINX — explains verified product data in plain language.
 *
 * The AI is never a source of truth and never a dependency of the core system:
 *  - It only receives a structured fact sheet produced by the verification engine.
 *  - It is instructed to answer strictly from those facts and to say so when they don't cover a question.
 *  - Without AI_API_KEY (or if the provider fails/refuses) a deterministic, fact-only answer is returned.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config.js";
import { OPEN_INCIDENT_STATUS } from "../lib/constants.js";
import { prisma } from "../lib/prisma.js";
import { verificationService } from "./verification.service.js";

const SYSTEM_PROMPT = `You are ASK ORIGINX, the assistant of the ORIGINX product-verification platform.
You explain a product's verified record to the people responsible for it.

Rules:
- Use ONLY the facts in the <facts> JSON. They come from ORIGINX's cryptographic verification engine.
- Never invent events, organizations, dates, scores, proofs or causes. If the facts do not answer the question, say that the verified record does not contain that information.
- When integrity checks failed, say so plainly and name the affected event sequence numbers.
- A recalled product must never be described as safe or verified for use.
- Keep answers short (at most 6 sentences) and factual.`;

type Facts = Awaited<ReturnType<AIExplanationService["facts"]>>;

export class AIExplanationService {
  private client: Anthropic | null = config.ai.apiKey && config.ai.provider === "anthropic" ? new Anthropic({ apiKey: config.ai.apiKey, maxRetries: 2, timeout: 30_000 }) : null;

  /** Structured, verified fact sheet — the only input the AI ever sees. */
  async facts(productId: string) {
    const { history, trust } = await verificationService.assess(productId);
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: {
        organization: { select: { name: true, verificationStatus: true } },
        currentOwner: { select: { name: true } },
        batch: { select: { batchCode: true } },
        identity: { select: { status: true, isCanonical: true } },
        incidents: { where: { status: { in: OPEN_INCIDENT_STATUS } }, select: { type: true, severity: true, title: true, detectedAt: true } },
        recalls: { select: { status: true, reason: true, initiatedAt: true } },
        events: { orderBy: { sequence: "asc" }, select: { sequence: true, eventType: true, timestamp: true, location: true } },
      },
    });
    return {
      product: {
        name: product.productName,
        code: product.productCode,
        batch: product.batch?.batchCode ?? null,
        status: product.status,
        origin: [product.originLocation, product.originCountry].filter(Boolean).join(", ") || null,
        manufacturer: product.organization.name,
        manufacturerVerified: product.organization.verificationStatus === "VERIFIED",
        currentCustodian: product.currentOwner?.name ?? null,
        identityStatus: product.identity?.status ?? null,
        identityIsOriginal: product.identity?.isCanonical ?? false,
      },
      trust: {
        score: trust.score,
        level: trust.level,
        appliedFactors: trust.factors.filter((f) => f.applied).map((f) => f.code),
        missedFactors: trust.factors.filter((f) => !f.applied).map((f) => f.code),
        penalties: trust.penalties.filter((p) => p.applied).map((p) => p.code),
      },
      integrity: {
        historyValid: history.historyValid,
        eventCount: history.eventCount,
        verifiedEventCount: history.verifiedEventCount,
        firstCompromisedSequence: history.firstCompromisedSequence,
        tamperedSequences: history.tamperedEvents.map((t) => t.sequence),
        brokenLinkSequences: history.brokenLinks.map((b) => b.sequence),
        passportFieldsChanged: history.passportIntegrity.mismatchedFields,
      },
      blockchain: {
        status: history.blockchainVerification.status,
        network: history.blockchainVerification.network,
        verifiedEvents: history.blockchainVerification.verifiedEvents,
        anchoredEvents: history.blockchainVerification.anchoredEvents,
        proofMismatches: history.blockchainVerification.proofMismatches,
      },
      lifecycle: product.events.map((e) => ({ sequence: e.sequence, type: e.eventType, at: e.timestamp.toISOString(), location: e.location })),
      openIncidents: product.incidents,
      recalls: product.recalls,
    };
  }

  async ask(productId: string, input: unknown) {
    const { question } = z.object({ question: z.string().trim().min(3).max(500) }).parse(input);
    const facts = await this.facts(productId);
    if (this.client) {
      try {
        return { answer: await this.askModel(question, facts), source: "ai" as const, model: config.ai.model, facts };
      } catch {
        // Provider errors never break the core experience — fall through to the deterministic answer.
      }
    }
    return { answer: this.deterministic(question, facts), source: "deterministic" as const, model: null, facts };
  }

  private async askModel(question: string, facts: Facts) {
    const response = await this.client!.beta.messages.create({
      model: config.ai.model,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `<facts>\n${JSON.stringify(facts)}\n</facts>\n\nQuestion: ${question}` }],
    });
    if (response.stop_reason === "refusal") throw new Error("Model declined the request");
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("Empty model response");
    return text;
  }

  /** Fact-only answer used when no AI provider is configured. */
  deterministic(question: string, f: Facts): string {
    const q = question.toLowerCase();
    const integrity = f.integrity.historyValid
      ? `All ${f.integrity.eventCount} lifecycle events passed cryptographic verification.`
      : `Integrity verification FAILED from event #${f.integrity.firstCompromisedSequence}` +
        (f.integrity.tamperedSequences.length ? ` (tampered: #${f.integrity.tamperedSequences.join(", #")})` : "") +
        (f.integrity.passportFieldsChanged.length ? `; sealed passport fields changed: ${f.integrity.passportFieldsChanged.join(", ")}` : "") +
        ".";
    const chain = `Blockchain status: ${f.blockchain.status} (${f.blockchain.verifiedEvents}/${f.blockchain.anchoredEvents} anchored events verified on ${f.blockchain.network}).`;
    const recall = f.recalls.find((r) => ["INITIATED", "IN_PROGRESS", "COMPLETED"].includes(r.status));
    const recallText = recall ? `This product is RECALLED (${recall.status}): ${recall.reason}` : "There is no active recall.";
    const trust = `Trust score ${f.trust.score}/100 (${f.trust.level})` + (f.trust.penalties.length ? `; penalties: ${f.trust.penalties.join(", ")}.` : ".") + (f.trust.missedFactors.length ? ` Not met: ${f.trust.missedFactors.join(", ")}.` : "");

    if (q.includes("trust") || q.includes("score")) return trust;
    if (q.includes("recall")) return recallText;
    if (q.includes("tamper") || q.includes("history") || q.includes("integrity") || q.includes("hash")) return `${integrity} ${chain}`;
    if (q.includes("blockchain") || q.includes("proof") || q.includes("chain")) return chain;
    if (q.includes("counterfeit") || q.includes("fake") || q.includes("collision") || q.includes("authentic")) {
      return f.product.identityIsOriginal
        ? `The identity is the original registration (status ${f.product.identityStatus}).${f.openIncidents.some((i) => i.type === "IDENTITY_COLLISION") ? " An identity-collision attempt against it is under investigation." : ""}`
        : "This record conflicts with an existing registered identity and is quarantined as a potential counterfeit.";
    }
    if (q.includes("where") || q.includes("custod") || q.includes("journey")) {
      return `Current custodian: ${f.product.currentCustodian ?? "unknown"}. Lifecycle: ${f.lifecycle.map((e) => `#${e.sequence} ${e.type}${e.location ? ` @ ${e.location}` : ""}`).join(" → ")}.`;
    }
    return `${f.product.name} (${f.product.code}) by ${f.product.manufacturer}. Status ${f.product.status}. ${trust} ${integrity} ${recallText}`;
  }
}

export const aiExplanationService = new AIExplanationService();
