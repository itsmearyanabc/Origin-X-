import type { NextFunction, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { config } from "../config.js";
import { fail } from "../lib/errors.js";
import { clientIp, clientIpHash } from "../lib/http.js";

const limited = (message: string) => fail("RATE_LIMITED", message);
const keyGenerator = (req: Request) => ipKeyGenerator(clientIp(req));

function limiter(windowMs: number, limit: number, message: string) {
  return rateLimit({ windowMs, limit, keyGenerator, standardHeaders: "draft-8", legacyHeaders: false, message: limited(message) });
}

/** General API limiter (per client IP). Cloudflare rate-limiting rules sit in front of this. */
export const apiLimiter = limiter(60_000, Number(process.env.API_RATE_LIMIT ?? 600), "Too many requests. Try again shortly.");

/** Credential endpoints: slows brute force and credential stuffing. */
export const authLimiter = limiter(15 * 60_000, Number(process.env.AUTH_RATE_LIMIT ?? 30), "Too many authentication attempts. Try again later.");

/** Public consumer verification. */
export const verifyLimiter = limiter(60_000, Number(process.env.VERIFY_RATE_LIMIT ?? 30), "Too many verification requests. Try again shortly.");

/** Public website chatbot: each message costs an AI call, so keep it tight per client. */
export const chatLimiter = limiter(10 * 60_000, Number(process.env.CHAT_RATE_LIMIT ?? 20), "Too many questions. Please try again in a few minutes.");

/** Public contact form: a handful of messages per client per hour. */
export const contactLimiter = limiter(60 * 60_000, Number(process.env.CONTACT_RATE_LIMIT ?? 5), "Too many messages. Please try again later.");

/**
 * Anti-enumeration: a client that keeps presenting tokens that do not exist is blocked for the rest
 * of the window, even while under the general verification limit. In-memory per API instance;
 * with several instances, back this with Redis (see docs/SECURITY.md).
 */
const unknownTokenHits = new Map<string, { count: number; resetAt: number }>();
const WINDOW = 10 * 60_000;

export function recordUnknownToken(req: Request) {
  const key = clientIpHash(req);
  const now = Date.now();
  const entry = unknownTokenHits.get(key);
  if (!entry || entry.resetAt < now) unknownTokenHits.set(key, { count: 1, resetAt: now + WINDOW });
  else entry.count += 1;
  if (unknownTokenHits.size > 10_000) {
    for (const [k, v] of unknownTokenHits) if (v.resetAt < now) unknownTokenHits.delete(k);
  }
}

export function enumerationGuard(req: Request, res: Response, next: NextFunction) {
  const entry = unknownTokenHits.get(clientIpHash(req));
  if (entry && entry.resetAt > Date.now() && entry.count >= config.verification.unknownTokenLimitPer10Min) {
    res.status(429).json(limited("Too many unrecognized verification codes from this client. Try again later."));
    return;
  }
  next();
}
