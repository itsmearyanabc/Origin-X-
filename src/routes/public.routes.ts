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

    // We use Anthropic to create a strict knowledge-base agent
    const { config } = await import("../config.js");
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    
    // We expect the user to provide ANTHROPIC_API_KEY in .env
    const apiKey = config.ai.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "AI not configured on server" });
    }
    
    const client = new Anthropic({ apiKey });
    
    const systemPrompt = `You are the official AI assistant for Origin-X. 

Here is the entire content of the Origin-X website for you to use as your knowledge base:
<website_data>
Origin-X is the verifiable identity layer for physical products.
It gives every physical product a verifiable digital identity (Digital Product Passports) to verify authenticity, inspect lifecycle evidence, detect suspicious identity activity, and manage inventory through one connected platform.

Core Features:
1. Proof no one can rewrite: Original hashes are anchored on a blockchain (ethereum-hoodi). Even a full database rewrite gets caught.
2. Custody that both sides sign: Ownership only moves when the receiving company accepts it (e.g., Factory -> Logistics -> Distributor).
3. Your data stays yours: Strict tenant isolation. Nothing private (documents, user details) ever goes on-chain, only cryptographic hashes.
4. Every scan tells the truth: Consumers can verify products via QR code for free. They see verified, recalled, or counterfeit statuses—never a misleading green tick.
5. Trust Score: Products receive a Trust Score out of 100 based on origin, custody, cryptography, proofs, and incidents.

Why use Origin-X?
- Paper trails can be forged. Certificates and invoices prove little once they leave the factory.
- Databases can be quietly edited by whoever controls them. Origin-X prevents this using write-once blockchain anchors.
- Customers can't check anything normally, allowing counterfeits and recalled stock to slip through. Origin-X gives consumers power to verify authenticity instantly.

Pricing:
- Free plan: 100 products, 3 team members. Organizations are reviewed by Origin-X before showing as verified.
- Paid plans are billed per organization. Contact us for volume, multi-brand, or regulated-industry needs.
</website_data>

RULES:
1. ONLY answer questions using the information provided in the <website_data> above.
2. If the user asks about ANYTHING ELSE that is not covered by the website data, you MUST reply EXACTLY with: "I do not have a response for this , you can ask ur doubts about the origin x". Do not add any other text to this refusal.
3. Keep your answers brief, professional, and formatted in HTML (use <b>, <p>, <ul>, etc.) because it is injected directly into a widget. Do not use markdown.
`;

    const response = await client.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: message }],
    });

    const replyText = response.content
      .filter((b) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    res.json({ success: true, data: { reply: replyText } });
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ success: false, error: "Sorry, I encountered an error. Please ensure the AI_API_KEY is configured in the environment." });
  }
});
