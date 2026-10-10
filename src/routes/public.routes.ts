import { TinyFish } from '@tiny-fish/sdk';
import { Router } from "express";
import { ok } from "../lib/errors.js";
import { clientIpHash, param } from "../lib/http.js";
import { contactLimiter, enumerationGuard, recordUnknownToken, verifyLimiter } from "../middleware/rateLimit.js";
import { contactService } from "../services/contact.service.js";
import { verificationService } from "../services/verification.service.js";

/**
 * Consumer verification — public, no account. The QR code encodes /verify/:publicVerificationToken.
 * Only the approved public passport is returned; internal ids, users, private addresses, incident
 * evidence, documents and audit data are never exposed.
 */
export const publicRouter = Router();

publicRouter.get("/:token", verifyLimiter, enumerationGuard, async (req, res) => {
  const outcome = await verificationService.verifyPublic(param(req, "token"), {
    ipHash: clientIpHash(req),
    userAgent: req.get("user-agent") ?? undefined,
    source: "PUBLIC",
  });
  if (!outcome.found) recordUnknownToken(req);
  res.setHeader("Cache-Control", "no-store");
  res.json(ok(outcome.result));
});

/** Public website contact form. */
export const siteRouter = Router();
siteRouter.post("/contact", contactLimiter, async (req, res) => {
  res.status(201).json(ok(await contactService.submit(req.body, clientIpHash(req))));
});


siteRouter.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const q = message.toLowerCase();
    let reply = "";

    // 100% Local rule-based keyword matching (No AI/API keys needed)
    if (q.includes("price") || q.includes("cost") || q.includes("plan") || q.includes("free") || q.includes("pay")) {
      reply = "<p><b>Pricing:</b></p><ul><li><b>Free Plan:</b> 100 products, 3 team members. Organizations are reviewed before showing as verified.</li><li><b>Paid Plans:</b> Billed per organization. Contact us for volume or regulated-industry needs.</li></ul>";
    } 
    else if (q.includes("blockchain") || q.includes("crypto") || q.includes("hoodi") || q.includes("hash") || q.includes("rewrite")) {
      reply = "<p><b>Proof no one can rewrite:</b> Original hashes are anchored on a blockchain (ethereum-hoodi). Even a full database rewrite gets caught. Nothing private ever goes on-chain.</p>";
    }
    else if (q.includes("trust") || q.includes("score")) {
      reply = "<p><b>Trust Score:</b> Products receive a Trust Score out of 100 based on their origin, custody history, cryptographic proofs, and incidents.</p>";
    }
    else if (q.includes("counterfeit") || q.includes("fake") || q.includes("verify") || q.includes("scan") || q.includes("customer")) {
      reply = "<p><b>Every scan tells the truth:</b> Consumers can verify products via QR code for free. They see verified, recalled, or counterfeit statuses—never a misleading green tick.</p>";
    }
    else if (q.includes("custody") || q.includes("transfer") || q.includes("factory") || q.includes("logistics")) {
      reply = "<p><b>Verified Custody:</b> Ownership only moves when the receiving company accepts it (e.g., Factory &rarr; Logistics &rarr; Distributor). Both sides sign the transfer.</p>";
    }
    else if (q.includes("what is") || q.includes("about") || q.includes("origin x") || q.includes("origin-x") || q.includes("do") || q.includes("how")) {
      reply = "<p><b>Origin-X</b> is the verifiable identity layer for physical products.</p><p>It gives every physical product a verifiable digital identity (Digital Product Passports) to verify authenticity, inspect lifecycle evidence, detect suspicious identity activity, and manage inventory.</p>";
    }
    
    // Fallback refusal exactly as requested
    if (!reply) {
      reply = "I do not have a response for this , you can ask ur doubts about the origin x";
    }

    res.json({ success: true, data: { reply } });
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ success: false, error: "Internal server error." });
  }
});
