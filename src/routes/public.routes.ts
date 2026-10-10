import { TinyFish } from '@tiny-fish/sdk';
import { Router } from "express";
import { ok } from "../lib/errors.js";
import { clientIpHash, param } from "../lib/http.js";
import { chatLimiter, contactLimiter, enumerationGuard, recordUnknownToken, verifyLimiter } from "../middleware/rateLimit.js";
import { chatService } from "../services/chat.service.js";
import { requireHuman } from "../middleware/turnstile.js";
import { config } from "../config.js";
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
/** Public, non-secret settings the web app needs at runtime (e.g. the Turnstile site key). */
siteRouter.get("/config", (_req, res) => {
  res.json(ok({ turnstileSiteKey: config.turnstile.siteKey || null }));
});

siteRouter.post("/contact", contactLimiter, requireHuman("contact"), async (req, res) => {
  res.status(201).json(ok(await contactService.submit(req.body, clientIpHash(req))));
});


siteRouter.post("/chat", chatLimiter, (req, res) => {
  res.json(ok(chatService.reply(req.body)));
});
