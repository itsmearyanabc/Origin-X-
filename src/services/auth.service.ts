import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { hashPassword, hashSecret, randomToken, signAccessToken, verifyPassword } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { writeAudit } from "./audit.service.js";
import { isPlatformAdmin } from "../middleware/auth.js";
import { mailService } from "./mail.service.js";

const password = z
  .string()
  .min(10, "Password must be at least 10 characters.")
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), "Password must contain letters and numbers.");

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password,
  fullName: z.string().trim().min(2).max(120),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

// Real bcrypt hash of a random secret: comparing against it keeps login timing constant for unknown emails.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken()));

type SessionUser = { id: string; email: string; fullName: string; platformRole: string; status: string; sessionVersion: number; emailVerifiedAt: Date | null };

function publicUser(user: SessionUser) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    platformRole: user.platformRole,
    accountType: isPlatformAdmin(user.platformRole) ? "PLATFORM_ADMIN" : "ORGANIZATION_USER",
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
  };
}

const googleClient = new OAuth2Client(config.googleClientId);

/** Email verification codes: 6 digits, short-lived, few guesses, throttled resends. */
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 60;
const otpDigest = (userId: string, code: string) => hashSecret(`email-otp:${userId}:${code}`);

export class AuthService {
  async register(input: unknown, ipHash?: string | null) {
    const data = registerSchema.parse(input);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError("EMAIL_IN_USE", "An account with this email already exists.", 409);
    const user = await prisma.user.create({
      data: { email: data.email, passwordHash: await hashPassword(data.password), fullName: data.fullName },
    });
    await writeAudit({ actorUserId: user.id, action: "USER_REGISTERED", resourceType: "User", resourceId: user.id, ipHash });
    const code = await this.issueEmailOtp(user.id);
    mailService.emailVerificationCode(user.email, user.fullName, code, OTP_TTL_MINUTES);
    return { ...(await this.issueSession(user)), emailVerificationRequired: true, ...(config.demoMode ? { demoEmailOtp: code } : {}) };
  }

  async login(input: unknown, ipHash?: string | null) {
    const data = loginSchema.parse(input);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    const matches = await verifyPassword(data.password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !matches) {
      await writeAudit({ actorUserId: user?.id ?? null, action: "LOGIN_FAILED", resourceType: "User", resourceId: user?.id ?? null, ipHash });
      throw new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.", 401);
    }
    if (user.status !== "ACTIVE") throw new AppError("ACCOUNT_INACTIVE", "This account is not active.", 403);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit({ actorUserId: user.id, action: "USER_LOGIN", resourceType: "User", resourceId: user.id, ipHash });
    return this.issueSession(user);
  }

  /**
   * Refresh-token rotation. Presenting an already-rotated token means it was stolen or replayed:
   * the whole token family is revoked and the user must sign in again.
   */
  
  /**
   * Google Sign-In (ID token from Google Identity Services). Only Google-*verified* addresses are
   * accepted: an unverified Google account can carry someone else's email, and matching it to an
   * existing ORIGINX user by email would hand over that account.
   */
  async loginWithGoogle(token: string, ipHash?: string | null) {
    let payload: TokenPayload | undefined;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: token, audience: config.googleClientId });
      payload = ticket.getPayload();
    } catch (error) {
      console.error(JSON.stringify({ level: "warn", msg: "Google ID token rejected", error: error instanceof Error ? error.message : String(error) }));
      throw new AppError("INVALID_CREDENTIALS", "Google authentication failed.", 401);
    }
    if (!payload?.email || payload.email_verified !== true) {
      throw new AppError("GOOGLE_EMAIL_UNVERIFIED", "Your Google account's email address is not verified by Google.", 401);
    }
    const email = payload.email.trim().toLowerCase();
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: { email, passwordHash: await hashPassword(randomToken() + randomToken()), fullName: payload.name || "Google User", emailVerifiedAt: new Date() },
      });
      await writeAudit({ actorUserId: user.id, action: "USER_REGISTERED_GOOGLE", resourceType: "User", resourceId: user.id, ipHash });
    } else if (user.status !== "ACTIVE") {
      throw new AppError("ACCOUNT_INACTIVE", "This account is not active.", 403);
    }
    // Google has verified this address, so it also counts as a verified ORIGINX email.
    user = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), ...(user.emailVerifiedAt ? {} : { emailVerifiedAt: new Date() }) } });
    await writeAudit({ actorUserId: user.id, action: "USER_LOGIN_GOOGLE", resourceType: "User", resourceId: user.id, ipHash });
    return this.issueSession(user);
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) throw new AppError("INVALID_TOKEN", "Refresh token is required.", 401);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashSecret(refreshToken) }, include: { user: true } });
    if (!stored) throw new AppError("INVALID_TOKEN", "Refresh token is invalid.", 401);
    if (stored.revokedAt) {
      await prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await writeAudit({ actorUserId: stored.userId, action: "REFRESH_TOKEN_REUSE_DETECTED", resourceType: "User", resourceId: stored.userId });
      throw new AppError("TOKEN_REUSED", "Refresh token reuse detected. Please sign in again.", 401);
    }
    if (stored.expiresAt < new Date() || stored.user.status !== "ACTIVE") {
      throw new AppError("INVALID_TOKEN", "Refresh token is invalid.", 401);
    }
    const session = await this.issueSession(stored.user, stored.familyId);
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedBy: hashSecret(session.refreshToken) },
    });
    return session;
  }

  async logout(refreshToken: string, userId?: string, allSessions = false) {
    if (refreshToken) {
      const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashSecret(refreshToken) } });
      if (stored) {
        await prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    }
    if (userId && allSessions) {
      await prisma.$transaction([
        prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
        prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }),
      ]);
    }
    if (userId) await writeAudit({ actorUserId: userId, action: allSessions ? "USER_LOGOUT_ALL" : "USER_LOGOUT", resourceType: "User", resourceId: userId });
    return { loggedOut: true };
  }

  async requestPasswordReset(email: string) {
    const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
    // Same response for unknown emails (no account enumeration).
    if (!user) return { accepted: true };
    const token = await this.issueOneTimeToken(user.id, "PASSWORD_RESET", 60);
    await writeAudit({ actorUserId: user.id, action: "PASSWORD_RESET_REQUESTED", resourceType: "User", resourceId: user.id });
    mailService.passwordReset(user.email, user.fullName, token);
    // The token itself is returned only in DEMO_MODE (local development / tests).
    return { accepted: true, ...(config.demoMode ? { demoResetToken: token } : {}) };
  }

  async resetPassword(token: string, newPassword: string) {
    const parsed = password.parse(newPassword);
    const stored = await this.consumeOneTimeToken(token, "PASSWORD_RESET");
    await prisma.$transaction([
      prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash: await hashPassword(parsed), sessionVersion: { increment: 1 } },
      }),
      prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await writeAudit({ actorUserId: stored.userId, action: "PASSWORD_RESET", resourceType: "User", resourceId: stored.userId });
    return { reset: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const parsed = password.parse(newPassword);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(String(currentPassword ?? ""), user.passwordHash))) {
      throw new AppError("INVALID_CREDENTIALS", "Current password is incorrect.", 401);
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(parsed), sessionVersion: { increment: 1 } },
    });
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit({ actorUserId: userId, action: "PASSWORD_CHANGED", resourceType: "User", resourceId: userId });
    return this.issueSession(updated);
  }

  async requestEmailVerification(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, fullName: true, emailVerifiedAt: true } });
    if (user.emailVerifiedAt) return { sent: false, alreadyVerified: true };
    const last = await prisma.oneTimeToken.findFirst({ where: { userId, purpose: "EMAIL_OTP" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const wait = last ? Math.ceil(OTP_RESEND_SECONDS - (Date.now() - last.createdAt.getTime()) / 1000) : 0;
    if (wait > 0) throw new AppError("OTP_RESEND_TOO_SOON", `Please wait ${wait} seconds before requesting another code.`, 429, [{ retryAfterSeconds: wait }]);
    const code = await this.issueEmailOtp(userId);
    mailService.emailVerificationCode(user.email, user.fullName, code, OTP_TTL_MINUTES);
    return { sent: true, expiresInMinutes: OTP_TTL_MINUTES, resendAfterSeconds: OTP_RESEND_SECONDS, ...(config.demoMode ? { demoEmailOtp: code } : {}) };
  }

  /**
   * Confirms the signed-in user's email with the 6-digit code. Wrong guesses are counted per code;
   * after OTP_MAX_ATTEMPTS the code is burned and a new one must be requested.
   */
  async verifyEmailOtp(userId: string, rawCode: unknown) {
    const code = String(rawCode ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) throw new AppError("INVALID_CODE", "Enter the 6-digit code from the email.", 422);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } });
    if (user.emailVerifiedAt) return { verified: true, alreadyVerified: true };
    const otp = await prisma.oneTimeToken.findFirst({ where: { userId, purpose: "EMAIL_OTP", usedAt: null }, orderBy: { createdAt: "desc" } });
    if (!otp || otp.expiresAt < new Date()) throw new AppError("CODE_EXPIRED", "This code has expired. Request a new one.", 400);
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new AppError("CODE_LOCKED", "Too many wrong attempts. Request a new code.", 429);
    const expected = Buffer.from(otp.tokenHash.split(":").pop()!, "hex");
    const actual = Buffer.from(otpDigest(userId, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const { attempts } = await prisma.oneTimeToken.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      const left = Math.max(0, OTP_MAX_ATTEMPTS - attempts);
      if (left === 0) await prisma.oneTimeToken.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
      throw new AppError(left ? "INVALID_CODE" : "CODE_LOCKED", left ? `That code is not correct. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Request a new code.", left ? 400 : 429);
    }
    await prisma.$transaction([
      prisma.oneTimeToken.update({ where: { id: otp.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
    await writeAudit({ actorUserId: userId, action: "EMAIL_VERIFIED", resourceType: "User", resourceId: userId, metadata: { method: "otp" } });
    return { verified: true };
  }

  async verifyEmail(token: string) {
    const stored = await this.consumeOneTimeToken(token, "EMAIL_VERIFICATION");
    await prisma.user.update({ where: { id: stored.userId }, data: { emailVerifiedAt: new Date() } });
    await writeAudit({ actorUserId: stored.userId, action: "EMAIL_VERIFIED", resourceType: "User", resourceId: stored.userId });
    return { verified: true };
  }

  async me(userId: string) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { where: { status: "ACTIVE" }, include: { organization: true } } },
    });
    return {
      ...publicUser(user),
      organizations: user.memberships.map((m) => ({
        organizationId: m.organizationId,
        role: m.role,
        name: m.organization.name,
        slug: m.organization.slug,
        status: m.organization.status,
        verificationStatus: m.organization.verificationStatus,
      })),
    };
  }

  /** Issues a fresh 6-digit code and cancels any earlier unused code for this user. */
  private async issueEmailOtp(userId: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await prisma.oneTimeToken.updateMany({ where: { userId, purpose: "EMAIL_OTP", usedAt: null }, data: { usedAt: new Date() } });
    await prisma.oneTimeToken.create({
      // tokenHash is unique per row; the random prefix keeps two identical codes from colliding.
      data: { userId, purpose: "EMAIL_OTP", tokenHash: `${randomUUID()}:${otpDigest(userId, code)}`, expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) },
    });
    return code;
  }

  private async issueOneTimeToken(userId: string, purpose: "PASSWORD_RESET" | "EMAIL_VERIFICATION", ttlMinutes: number) {
    const token = randomToken();
    await prisma.oneTimeToken.create({
      data: { userId, purpose, tokenHash: hashSecret(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
    });
    return token;
  }

  private async consumeOneTimeToken(token: string, purpose: string) {
    const stored = await prisma.oneTimeToken.findUnique({ where: { tokenHash: hashSecret(String(token ?? "")) } });
    if (!stored || stored.purpose !== purpose || stored.usedAt || stored.expiresAt < new Date()) {
      throw new AppError("INVALID_TOKEN", "Token is invalid or expired.", 400);
    }
    await prisma.oneTimeToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } });
    return stored;
  }

  private async issueSession(user: SessionUser, familyId: string = randomUUID()) {
    const refreshToken = randomToken(48);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + config.jwtRefreshTtlDays * 24 * 60 * 60 * 1000),
      },
    });
    return {
      user: publicUser(user),
      accessToken: signAccessToken(user.id, user.sessionVersion),
      refreshToken,
      tokenType: "Bearer" as const,
      accessTokenExpiresIn: config.jwtAccessTtl,
    };
  }
}

export const authService = new AuthService();
