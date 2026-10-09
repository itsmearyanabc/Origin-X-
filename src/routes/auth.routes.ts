import { Router, type CookieOptions, type Request, type Response } from "express";
import { config, isProduction } from "../config.js";
import { AppError, ok } from "../lib/errors.js";
import { clientIpHash } from "../lib/http.js";
import { requireAuth } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { authService } from "../services/auth.service.js";

/**
 * Browser sessions: the refresh token lives only in an httpOnly cookie scoped to /api/v1/auth;
 * the short-lived access token is returned in the body and kept in memory by the web app.
 * Non-browser clients may send `X-Refresh-Transport: body` to receive the refresh token in JSON.
 *
 * CSRF: requests that authenticate with the cookie must carry `X-Requested-With`, which a
 * cross-site page cannot send without passing CORS. SameSite=Lax adds a second layer.
 */
export const REFRESH_COOKIE = "ox_rt";
export const CSRF_HEADER = "x-requested-with";

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: "lax",
  path: "/api/v1/auth",
  maxAge: config.jwtRefreshTtlDays * 24 * 60 * 60 * 1000,
});

type Session = { refreshToken: string } & Record<string, unknown>;

function sendSession(req: Request, res: Response, session: Session, status = 200) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions());
  const { refreshToken, ...rest } = session;
  res.status(status).json(ok(req.header("x-refresh-transport") === "body" ? { ...rest, refreshToken } : rest));
}

function clearSession(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

/** Refresh token from the JSON body (API clients) or the cookie (browsers, CSRF-checked). */
function refreshTokenFrom(req: Request): string {
  const fromBody = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";
  if (fromBody) return fromBody;
  const fromCookie = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!fromCookie) return "";
  if (!req.header(CSRF_HEADER)) throw new AppError("CSRF_HEADER_REQUIRED", "Missing X-Requested-With header.", 403);
  return fromCookie;
}

export const authRouter = Router();

authRouter.post("/register", authLimiter, async (req, res) => {
  sendSession(req, res, await authService.register(req.body, clientIpHash(req)), 201);
});

authRouter.post("/login", authLimiter, async (req, res) => {
  sendSession(req, res, await authService.login(req.body, clientIpHash(req)));
});

authRouter.post("/refresh", authLimiter, async (req, res) => {
  try {
    sendSession(req, res, await authService.refresh(refreshTokenFrom(req)));
  } catch (error) {
    clearSession(res);
    throw error;
  }
});

authRouter.post("/logout", async (req, res) => {
  const token = refreshTokenFrom(req);
  clearSession(res);
  res.json(ok(await authService.logout(token)));
});

authRouter.post("/logout-all", requireAuth, async (req, res) => {
  clearSession(res);
  res.json(ok(await authService.logout(refreshTokenFrom(req), req.user!.id, true)));
});

authRouter.post("/forgot-password", authLimiter, async (req, res) => {
  res.json(ok(await authService.requestPasswordReset(String(req.body?.email ?? ""))));
});

authRouter.post("/reset-password", authLimiter, async (req, res) => {
  res.json(ok(await authService.resetPassword(String(req.body?.token ?? ""), String(req.body?.password ?? ""))));
});

authRouter.post("/change-password", requireAuth, authLimiter, async (req, res) => {
  sendSession(req, res, await authService.changePassword(req.user!.id, String(req.body?.currentPassword ?? ""), String(req.body?.newPassword ?? "")));
});

authRouter.post("/verify-email/request", requireAuth, authLimiter, async (req, res) => {
  res.json(ok(await authService.requestEmailVerification(req.user!.id)));
});

authRouter.post("/verify-email", authLimiter, async (req, res) => {
  res.json(ok(await authService.verifyEmail(String(req.body?.token ?? ""))));
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json(ok(await authService.me(req.user!.id)));
});
