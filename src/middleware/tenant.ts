import type { NextFunction, Request, Response } from "express";
import { AppError, forbidden } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { clientIpHash } from "../lib/http.js";
import { ORG_PERMISSIONS, type OrgPermission, type OrgRole } from "../lib/constants.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Resolves the tenant for this request.
 *
 * The client only *selects* an organization (X-Organization-Id header); the server then proves
 * the caller is an ACTIVE member of it. Platform admins get no implicit tenant access — they use
 * the /admin API, which is read-mostly and fully audited.
 */
export async function requireOrganization(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("UNAUTHENTICATED", "Authentication is required.", 401);
    const header = req.header("x-organization-id");
    const organizationId = header || (typeof req.query.organizationId === "string" ? req.query.organizationId : undefined);
    if (!organizationId) {
      throw new AppError("ORGANIZATION_REQUIRED", "Select an organization with the X-Organization-Id header.", 400);
    }
    const membership = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: req.user.id } },
      include: { organization: true },
    });
    // Same response whether the organization does not exist or the caller is not a member,
    // so organization ids cannot be probed.
    if (!membership || membership.status !== "ACTIVE") {
      throw forbidden("You are not a member of this organization.", "NOT_ORGANIZATION_MEMBER");
    }
    const org = membership.organization;
    if (!READ_METHODS.has(req.method) && (org.status === "SUSPENDED" || org.status === "REJECTED")) {
      throw forbidden(`This organization is ${org.status.toLowerCase()} and is read-only.`, "ORGANIZATION_SUSPENDED");
    }
    req.membership = { id: membership.id, organizationId: org.id, role: membership.role as OrgRole };
    req.organization = { id: org.id, name: org.name, status: org.status, verificationStatus: org.verificationStatus };
    next();
  } catch (error) {
    next(error);
  }
}

export function hasPermission(role: OrgRole | undefined, permission: OrgPermission): boolean {
  return Boolean(role && (ORG_PERMISSIONS[permission] as readonly string[]).includes(role));
}

/** Organization RBAC check. Must run after requireOrganization. */
export function can(permission: OrgPermission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.membership) return next(new AppError("ORGANIZATION_REQUIRED", "Organization context is required.", 400));
    if (!hasPermission(req.membership.role, permission)) {
      return next(forbidden(`Your role (${req.membership.role}) does not allow ${permission}.`));
    }
    next();
  };
}

export function tenantId(req: Request): string {
  const id = req.membership?.organizationId;
  if (!id) throw new AppError("ORGANIZATION_REQUIRED", "Organization context is required.", 400);
  return id;
}

/** Actor passed into services: who is acting, for which tenant, with which role. */
export type Actor = { userId: string; organizationId: string; role: OrgRole; ipHash?: string | null };

export function actor(req: Request): Actor {
  return {
    userId: req.user!.id,
    organizationId: tenantId(req),
    role: req.membership!.role,
    ipHash: clientIpHash(req),
  };
}
