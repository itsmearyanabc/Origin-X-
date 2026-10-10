import type { NextFunction, Request, Response } from "express";
import { config, isProduction } from "../config.js";
import { AppError } from "../lib/errors.js";
import { clientIp } from "../lib/http.js";

/**
 * Cloudflare Turnstile ("Verify you are human") for public forms that bots attack: sign-in,
 * sign-up, password reset and contact. Enabled when TURNSTILE_SECRET_KEY is set; otherwise a no-op
 * (local development, tests). The browser sends the widget token as `turnstileToken` in the JSON
 * body or the `CF-Turnstile-Response` header; it is verified server-side with Cloudflare's
 * Siteverify API — a token is single-use, bound to our site key, action and hostname.
 */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type SiteverifyResult = { success: boolean; "error-codes"?: string[]; hostname?: string; action?: string };

export function turnstileEnabled(): boolean {
  return Boolean(config.turnstile.secretKey);
}

export async function verifyTurnstile(token: string, action: string, remoteIp?: string): Promise<void> {
  const body = new URLSearchParams({ secret: config.turnstile.secretKey, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  let result: SiteverifyResult;
  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    result = (await res.json()) as SiteverifyResult;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "turnstile: siteverify unreachable", error: error instanceof Error ? error.message : String(error) }));
    // Fail closed: without a verdict we cannot tell a person from a bot.
    throw new AppError("HUMAN_CHECK_UNAVAILABLE", "We couldn't complete the security check. Please try again.", 503);
  }
  if (!result.success) {
    throw new AppError("HUMAN_CHECK_FAILED", "The security check failed or expired. Please try again.", 403, result["error-codes"]);
  }
  // Defence in depth: the token must come from our widget, for this form, on our domain.
  if (result.action && result.action !== action) throw new AppError("HUMAN_CHECK_FAILED", "The security check did not match this form. Please try again.", 403);
  if (isProduction && result.hostname && result.hostname !== new URL(config.appUrl).hostname) {
    throw new AppError("HUMAN_CHECK_FAILED", "The security check did not match this site. Please try again.", 403);
  }
}

/** Route guard. `action` must equal the widget's `action` for that form (e.g. "login"). */
export function requireHuman(action: string) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!turnstileEnabled()) return next();
    const token = String((req.body as Record<string, unknown> | undefined)?.turnstileToken ?? req.header("cf-turnstile-response") ?? "").trim();
    if (!token) return next(new AppError("HUMAN_CHECK_REQUIRED", "Please complete the security check.", 403));
    try {
      await verifyTurnstile(token, action, clientIp(req));
      next();
    } catch (error) {
      next(error);
    }
  };
}
