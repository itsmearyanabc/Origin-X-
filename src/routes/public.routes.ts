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
Origin-X is a verifiable physical product supply chain manager and authenticity platform. 
It uses blockchain hashes (ethereum-hoodi) to create an append-only registry of product lifecycle events to prevent counterfeiting and tampering.

RULES:
1. ONLY answer questions about Origin-X, supply chains, product verification, or related platform features.
2. If the user asks about ANYTHING ELSE (like the capital of France, math, general knowledge, etc), you MUST reply EXACTLY with: "I do not have a response for this , you can ask ur doubts about the origin x". Do not add any other text to this refusal.
3. Keep your answers brief, professional, and formatted in HTML (use <b>, <p>, <ul>, etc.) because it is injected directly into a widget. Do not use markdown.`;

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
