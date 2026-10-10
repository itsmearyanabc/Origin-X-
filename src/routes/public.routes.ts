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

    const tf = new TinyFish({
      apiKey: "sk-tinyfish-qTthlASTnsi4_naSkSd_CcZbnwKrxHLE",
    });

    const response = await tf.search.query({
      query: message,
      purpose: "Answering a user query on the website",
    });

    if (!response.results || response.results.length === 0) {
        return res.json(ok({ reply: "I couldn't find any information on that." }));
    }

    const topResults = response.results.slice(0, 3).map((r: any) => 
      `<div class="mb-3">
        <a href="${r.url}" target="_blank" class="font-bold text-blue-500 hover:underline">${r.title}</a>
        <p class="text-sm text-gray-600 mt-1">${r.snippet}</p>
      </div>`
    ).join('');

    const reply = `<div class="text-sm"><p class="mb-3">Here is what I found on the web:</p>${topResults}</div>`;

    res.json(ok({ reply }));
  } catch (error) {
    console.error("Chat API error:", error);
    res.status(500).json({ error: "Sorry, I encountered an error searching the web." });
  }
});
