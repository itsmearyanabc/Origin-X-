import type { NextFunction, Request, Response } from "express";
import { AppError, forbidden } from "../lib/errors.js";
import { verifyAccessToken } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { ADMIN_PERMISSIONS, type AdminPermission } from "../lib/constants.js";

/** Validates the bearer access token and loads the (still active) user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("UNAUTHENTICATED", "Authentication is required.", 401);
    }
    let payload;
    try {
      payload = verifyAccessToken(header.slice(7));
    } catch {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired access token.", 401);
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "ACTIVE" || user.sessionVersion !== payload.sv) {
      throw new AppError("UNAUTHENTICATED", "Session is no longer valid.", 401);
    }
    req.user = { id: user.id, email: user.email, fullName: user.fullName, platformRole: user.platformRole };
    next();
  } catch (error) {
    next(error);
  }
}

export function isPlatformAdmin(role: string | undefined): boolean {
  return Boolean(role && (ADMIN_PERMISSIONS["admin:read"] as readonly string[]).includes(role));
}

/** Platform (ORIGINX staff) authorization. Organization users never pass this check. */
export function requireAdmin(permission: AdminPermission = "admin:read") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.platformRole;
    if (!role || !(ADMIN_PERMISSIONS[permission] as readonly string[]).includes(role)) {
      return next(forbidden("Platform administrator access is required.", "ADMIN_REQUIRED"));
    }
    next();
  };
}
