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
