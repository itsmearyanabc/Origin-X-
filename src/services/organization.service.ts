import { z } from "zod";
import { AppError, forbidden, notFound } from "../lib/errors.js";
import { hashSecret, randomToken } from "../lib/crypto.js";
import { json, prisma } from "../lib/prisma.js";
import { ORG_ROLES, ORG_ROLE_LIST, ORG_TYPES, PLANS, RELATIONSHIP_TYPES, type OrgRole } from "../lib/constants.js";
import { paginate, str, type Query } from "../lib/pagination.js";
import type { Actor } from "../middleware/tenant.js";
import { writeAudit } from "./audit.service.js";
import { entitlementService } from "./entitlement.service.js";
import { mailService } from "./mail.service.js";

const optionalText = (max = 200) => z.string().trim().max(max).optional();

const profileFields = {
  name: z.string().trim().min(2).max(120),
  legalName: optionalText(200),
  organizationType: z.enum(ORG_TYPES),
  additionalTypes: z.array(z.enum(ORG_TYPES)).max(ORG_TYPES.length).optional(),
  industry: optionalText(120),
  country: optionalText(60),
  address: optionalText(300),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: optionalText(40),
  website: z.string().trim().url().max(300).optional(),
  logo: z.string().trim().url().max(500).optional(),
};

const createSchema = z.object({
  ...profileFields,
  slug: z.string().trim().toLowerCase().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
});
const updateSchema = z.object(profileFields).partial();

const PRIVILEGED: OrgRole[] = [ORG_ROLES.ORG_OWNER, ORG_ROLES.ORG_ADMIN];

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function profileData<T extends { additionalTypes?: string[] }>(data: T) {
  const { additionalTypes, ...rest } = data;
  return { ...rest, ...(additionalTypes ? { additionalTypesJson: JSON.stringify(additionalTypes) } : {}) };
}

/** Shape returned to organization members (never includes other tenants' data). */
export function presentOrganization<T extends { additionalTypesJson: string }>(org: T) {
  const { additionalTypesJson, ...rest } = org;
  return { ...rest, additionalTypes: json<string[]>(additionalTypesJson, []) };
}

export class OrganizationService {
  /** Onboarding: any signed-in user may create an organization; it starts PENDING admin approval. */
  async create(userId: string, input: unknown, ipHash?: string | null) {
    const data = createSchema.parse(input);
    const slug = data.slug ?? slugify(data.name);
    if (!slug) throw new AppError("INVALID_SLUG", "Could not derive a slug from the name.", 422);
    if (await prisma.organization.findUnique({ where: { slug } })) {
      throw new AppError("SLUG_IN_USE", "This organization slug is already taken.", 409);
    }
    const { slug: _ignored, ...profile } = data;
    const org = await prisma.organization.create({
      data: {
        ...profileData(profile),
        slug,
        status: "PENDING",
        verificationStatus: "PENDING",
        subscriptionPlan: "FREE",
        subscriptionStatus: "ACTIVE",
        subscriptionStartedAt: new Date(),
        productLimit: PLANS.FREE.productLimit,
        userLimit: PLANS.FREE.userLimit,
        members: { create: { userId, role: ORG_ROLES.ORG_OWNER, status: "ACTIVE" } },
      },
    });
    await writeAudit({ organizationId: org.id, actorUserId: userId, action: "ORGANIZATION_CREATED", resourceType: "Organization", resourceId: org.id, ipHash });
    mailService.notifyAdmins(`Organization awaiting approval: ${org.name}`, `${org.name} signed up and is waiting for review.`, `/admin/organizations/${org.id}`);
    return presentOrganization(org);
  }

  async update(a: Actor, input: unknown) {
    const patch = updateSchema.parse(input);
    const org = await prisma.organization.update({ where: { id: a.organizationId }, data: profileData(patch) });
    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: "ORGANIZATION_UPDATED",
      resourceType: "Organization",
      resourceId: a.organizationId,
      metadata: { fields: Object.keys(patch) },
      ipHash: a.ipHash,
    });
    return presentOrganization(org);
  }

  async get(organizationId: string) {
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw notFound("Organization");
    return { ...presentOrganization(org), entitlements: await entitlementService.snapshot(organizationId) };
  }

  async members(organizationId: string) {
    return prisma.organizationMember.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        user: { select: { id: true, email: true, fullName: true, status: true } },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  async invite(a: Actor, input: unknown) {
    const data = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ORG_ROLE_LIST) }).parse(input);
    if (PRIVILEGED.includes(data.role) && a.role !== ORG_ROLES.ORG_OWNER) {
      throw forbidden("Only an organization owner can invite owners or admins.", "ROLE_ESCALATION_DENIED");
    }
    const existingMember = await prisma.organizationMember.findFirst({
      where: { organizationId: a.organizationId, status: "ACTIVE", user: { email: data.email } },
    });
    if (existingMember) throw new AppError("ALREADY_MEMBER", "This user is already a member.", 409);
    const limit = await entitlementService.assertCanAddUser(a.organizationId);
    await prisma.invitation.updateMany({
      where: { organizationId: a.organizationId, email: data.email, status: "PENDING" },
      data: { status: "REVOKED" },
    });
    const token = randomToken();
    const invitation = await prisma.invitation.create({
      data: {
        organizationId: a.organizationId,
        email: data.email,
        role: data.role,
        tokenHash: hashSecret(token),
        invitedById: a.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true },
    });
    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: "USER_INVITED",
      resourceType: "Invitation",
      resourceId: invitation.id,
      metadata: { email: data.email, role: data.role },
      ipHash: a.ipHash,
    });
    const [org, inviter] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: a.organizationId }, select: { name: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: a.userId }, select: { fullName: true } }),
    ]);
    mailService.invitation(data.email, org.name, inviter.fullName, data.role, token);
    // The token is also returned so the inviter can share the link directly if email is delayed.
    return { invitation, acceptToken: token, entitlement: limit };
  }

  async invitations(organizationId: string) {
    return prisma.invitation.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, status: true, expiresAt: true, acceptedAt: true, createdAt: true },
    });
  }

  async revokeInvitation(a: Actor, invitationId: string) {
    const inv = await prisma.invitation.findFirst({ where: { id: invitationId, organizationId: a.organizationId } });
    if (!inv) throw notFound("Invitation");
    if (inv.status !== "PENDING") throw new AppError("INVITATION_NOT_PENDING", "Only pending invitations can be revoked.", 409);
    await prisma.invitation.update({ where: { id: inv.id }, data: { status: "REVOKED" } });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "INVITATION_REVOKED", resourceType: "Invitation", resourceId: inv.id, ipHash: a.ipHash });
    return { revoked: true };
  }

  async acceptInvitation(userId: string, email: string, token: string) {
    const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashSecret(String(token ?? "")) } });
    if (!invitation || invitation.status !== "PENDING" || invitation.expiresAt < new Date()) {
      throw new AppError("INVALID_INVITATION", "Invitation is invalid or expired.", 400);
    }
    if (invitation.email !== email.toLowerCase()) {
      throw forbidden("This invitation was issued to a different email address.", "INVITATION_EMAIL_MISMATCH");
    }
    await entitlementService.assertCanAddUser(invitation.organizationId);
    await prisma.$transaction([
      prisma.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: invitation.organizationId, userId } },
        update: { role: invitation.role, status: "ACTIVE" },
        create: { organizationId: invitation.organizationId, userId, role: invitation.role, status: "ACTIVE" },
      }),
      prisma.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } }),
    ]);
    await writeAudit({
      organizationId: invitation.organizationId,
      actorUserId: userId,
      action: "INVITATION_ACCEPTED",
      resourceType: "Invitation",
      resourceId: invitation.id,
      metadata: { role: invitation.role },
    });
    return { accepted: true, organizationId: invitation.organizationId, role: invitation.role };
  }

  // ---------------------------------------------------------------------------
  // Membership changes (with privilege-escalation guards)
  // ---------------------------------------------------------------------------

  private async assertNotLastOwner(organizationId: string, memberRole: string) {
    if (memberRole !== ORG_ROLES.ORG_OWNER) return;
    const owners = await prisma.organizationMember.count({ where: { organizationId, role: ORG_ROLES.ORG_OWNER, status: "ACTIVE" } });
    if (owners <= 1) throw new AppError("LAST_OWNER", "An organization must keep at least one owner.", 409);
  }

  async changeRole(a: Actor, memberId: string, input: unknown) {
    const { role } = z.object({ role: z.enum(ORG_ROLE_LIST) }).parse(input);
    const member = await prisma.organizationMember.findFirst({ where: { id: memberId, organizationId: a.organizationId, status: "ACTIVE" } });
    if (!member) throw notFound("Member");
    if (a.role !== ORG_ROLES.ORG_OWNER && (PRIVILEGED.includes(role) || PRIVILEGED.includes(member.role as OrgRole))) {
      throw forbidden("Only an organization owner can grant or change owner/admin roles.", "ROLE_ESCALATION_DENIED");
    }
    if (role !== member.role) await this.assertNotLastOwner(a.organizationId, member.role);
    const updated = await prisma.organizationMember.update({ where: { id: member.id }, data: { role } });
    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: "USER_ROLE_CHANGED",
      resourceType: "OrganizationMember",
      resourceId: member.id,
      metadata: { from: member.role, to: role, userId: member.userId },
      ipHash: a.ipHash,
    });
    return updated;
  }

  async removeMember(a: Actor, memberId: string) {
    const member = await prisma.organizationMember.findFirst({ where: { id: memberId, organizationId: a.organizationId, status: "ACTIVE" } });
    if (!member) throw notFound("Member");
    if (a.role !== ORG_ROLES.ORG_OWNER && PRIVILEGED.includes(member.role as OrgRole)) {
      throw forbidden("Only an organization owner can remove owners or admins.", "ROLE_ESCALATION_DENIED");
    }
    await this.assertNotLastOwner(a.organizationId, member.role);
    await prisma.organizationMember.update({ where: { id: member.id }, data: { status: "REMOVED" } });
    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: "USER_REMOVED",
      resourceType: "OrganizationMember",
      resourceId: member.id,
      metadata: { userId: member.userId, role: member.role },
      ipHash: a.ipHash,
    });
    return { removed: true };
  }

  // ---------------------------------------------------------------------------
  // Supply-chain relationships
  // ---------------------------------------------------------------------------

  async discover(organizationId: string, q: Query) {
    const search = str(q, "q");
    const type = str(q, "type");
    const where = {
      status: "ACTIVE",
      id: { not: organizationId },
      ...(type ? { organizationType: type } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { slug: { contains: search, mode: "insensitive" as const } }, { industry: { contains: search, mode: "insensitive" as const } }] } : {}),
    };
    return paginate(
      q,
      () => prisma.organization.count({ where }),
      (page) =>
        prisma.organization.findMany({
          where,
          ...page,
          orderBy: { name: "asc" },
          // Public business profile only — no contact details or subscription data.
          select: { id: true, name: true, slug: true, organizationType: true, additionalTypesJson: true, industry: true, country: true, verificationStatus: true, logo: true, website: true },
        }),
    );
  }

  async relationships(organizationId: string, q: Query) {
    const status = str(q, "status");
    const direction = str(q, "direction");
    const sides =
      direction === "outgoing"
        ? [{ sourceOrganizationId: organizationId }]
        : direction === "incoming"
          ? [{ targetOrganizationId: organizationId }]
          : [{ sourceOrganizationId: organizationId }, { targetOrganizationId: organizationId }];
    const partner = { select: { id: true, name: true, slug: true, organizationType: true, verificationStatus: true, status: true } };
    return prisma.organizationRelationship.findMany({
      where: { OR: sides, ...(status ? { status } : {}) },
      include: { source: partner, target: partner },
      orderBy: { createdAt: "desc" },
    });
  }

  async requestRelationship(a: Actor, input: unknown) {
    const data = z.object({ targetOrganizationId: z.string().min(1), relationshipType: z.enum(RELATIONSHIP_TYPES) }).parse(input);
    if (data.targetOrganizationId === a.organizationId) {
      throw new AppError("INVALID_RELATIONSHIP", "An organization cannot partner with itself.", 422);
    }
    const target = await prisma.organization.findUnique({ where: { id: data.targetOrganizationId } });
    if (!target || target.status !== "ACTIVE") throw notFound("Organization");
    const key = {
      sourceOrganizationId_targetOrganizationId_relationshipType: {
        sourceOrganizationId: a.organizationId,
        targetOrganizationId: data.targetOrganizationId,
        relationshipType: data.relationshipType,
      },
    };
    const existing = await prisma.organizationRelationship.findUnique({ where: key });
    if (existing && ["REQUESTED", "ACCEPTED"].includes(existing.status)) {
      throw new AppError("RELATIONSHIP_EXISTS", `This relationship is already ${existing.status.toLowerCase()}.`, 409);
    }
    const rel = existing
      ? await prisma.organizationRelationship.update({
          where: { id: existing.id },
          data: { status: "REQUESTED", requestedById: a.userId, respondedById: null, approvedAt: null },
        })
      : await prisma.organizationRelationship.create({
          data: { ...key.sourceOrganizationId_targetOrganizationId_relationshipType, status: "REQUESTED", requestedById: a.userId },
        });
    await writeAudit({
      organizationId: a.organizationId,
      actorUserId: a.userId,
      action: "RELATIONSHIP_REQUESTED",
      resourceType: "OrganizationRelationship",
      resourceId: rel.id,
      metadata: { targetOrganizationId: data.targetOrganizationId, relationshipType: data.relationshipType },
      ipHash: a.ipHash,
    });
    return rel;
  }

  /** Only the *target* organization can accept or reject a partnership request. */
  async respondRelationship(a: Actor, relationshipId: string, accept: boolean) {
    const rel = await prisma.organizationRelationship.findFirst({ where: { id: relationshipId, targetOrganizationId: a.organizationId } });
    if (!rel) throw notFound("Relationship");
    if (rel.status !== "REQUESTED") throw new AppError("RELATIONSHIP_NOT_PENDING", "This request is no longer pending.", 409);
    const updated = await prisma.organizationRelationship.update({
      where: { id: rel.id },
      data: { status: accept ? "ACCEPTED" : "REJECTED", respondedById: a.userId, approvedAt: accept ? new Date() : null },
    });
    for (const orgId of [rel.sourceOrganizationId, rel.targetOrganizationId]) {
      await writeAudit({
        organizationId: orgId,
        actorUserId: a.userId,
        action: accept ? "RELATIONSHIP_ACCEPTED" : "RELATIONSHIP_REJECTED",
        resourceType: "OrganizationRelationship",
        resourceId: rel.id,
        ipHash: a.ipHash,
      });
    }
    return updated;
  }

  /** Either side may suspend an accepted partnership; custody transfers then stop being allowed. */
  async suspendRelationship(a: Actor, relationshipId: string) {
    const rel = await prisma.organizationRelationship.findFirst({
      where: { id: relationshipId, OR: [{ sourceOrganizationId: a.organizationId }, { targetOrganizationId: a.organizationId }] },
    });
    if (!rel) throw notFound("Relationship");
    if (rel.status !== "ACCEPTED") throw new AppError("RELATIONSHIP_NOT_ACTIVE", "Only accepted relationships can be suspended.", 409);
    const updated = await prisma.organizationRelationship.update({ where: { id: rel.id }, data: { status: "SUSPENDED", respondedById: a.userId } });
    await writeAudit({ organizationId: a.organizationId, actorUserId: a.userId, action: "RELATIONSHIP_SUSPENDED", resourceType: "OrganizationRelationship", resourceId: rel.id, ipHash: a.ipHash });
    return updated;
  }

  /** True when the two organizations have an ACCEPTED relationship in either direction. */
  async arePartners(orgA: string, orgB: string) {
    const rel = await prisma.organizationRelationship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { sourceOrganizationId: orgA, targetOrganizationId: orgB },
          { sourceOrganizationId: orgB, targetOrganizationId: orgA },
        ],
      },
    });
    return Boolean(rel);
  }
}

export const organizationService = new OrganizationService();
