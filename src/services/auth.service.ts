import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from "node:crypto";
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

export class AuthService {
  async register(input: unknown, ipHash?: string | null) {
    const data = registerSchema.parse(input);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new AppError("EMAIL_IN_USE", "An account with this email already exists.", 409);
    const user = await prisma.user.create({
      data: { email: data.email, passwordHash: await hashPassword(data.password), fullName: data.fullName },
    });
    await writeAudit({ actorUserId: user.id, action: "USER_REGISTERED", resourceType: "User", resourceId: user.id, ipHash });
    const verification = await this.issueOneTimeToken(user.id, "EMAIL_VERIFICATION", 24 * 60);
    mailService.emailVerification(user.email, user.fullName, verification);
    return { ...(await this.issueSession(user)), ...(config.demoMode ? { demoEmailVerificationToken: verification } : {}) };
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
  
  async loginWithGoogle(token: string, ipHash?: string | null) {
    const client = new OAuth2Client("402692437838-5skvqif41a71q15bu1ua3o432ntk1phu.apps.googleusercontent.com");
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: "402692437838-5skvqif41a71q15bu1ua3o432ntk1phu.apps.googleusercontent.com",
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.email) throw new Error("Invalid Google token payload");

      let user = await prisma.user.findUnique({ where: { email: payload.email } });
      
      if (!user) {
        const dummyPassword = await hashPassword(randomToken() + randomToken());
        user = await prisma.user.create({
          data: {
            email: payload.email,
            passwordHash: dummyPassword,
            fullName: payload.name || "Google User",
            emailVerifiedAt: new Date(),
          }
        });
        await writeAudit({ actorUserId: user.id, action: "USER_REGISTERED_GOOGLE", resourceType: "User", resourceId: user.id, ipHash });
      } else {
        if (user.status !== "ACTIVE") throw new AppError("ACCOUNT_INACTIVE", "This account is not active.", 403);
      }

      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await writeAudit({ actorUserId: user.id, action: "USER_LOGIN_GOOGLE", resourceType: "User", resourceId: user.id, ipHash });
      
      return this.issueSession(user);
    } catch (error) {
      console.error("Google Auth Error:", error);
      throw new AppError("INVALID_CREDENTIALS", "Google authentication failed.", 401);
    }
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
    const token = await this.issueOneTimeToken(userId, "EMAIL_VERIFICATION", 24 * 60);
    mailService.emailVerification(user.email, user.fullName, token);
    return { sent: true, ...(config.demoMode ? { demoEmailVerificationToken: token } : {}) };
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
