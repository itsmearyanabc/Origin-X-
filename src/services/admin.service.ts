import { z } from "zod";
import { ACTIVE_RECALL_STATUS, IDENTITY_STATUS, OPEN_INCIDENT_STATUS, PLAN_NAMES, PLATFORM_ROLES } from "../lib/constants.js";
import { AppError, notFound } from "../lib/errors.js";
import { json, prisma } from "../lib/prisma.js";
import { paginate, parseSort, str, type Query } from "../lib/pagination.js";
import { writeAudit } from "./audit.service.js";
import { blockchainService } from "./blockchain.service.js";
import { entitlementService } from "./entitlement.service.js";
import { eventService } from "./event.service.js";
import { incidentService } from "./incident.service.js";
import { presentOrganization } from "./organization.service.js";
import { trustScoreService } from "./trust.service.js";

export type AdminActor = { userId: string; role: string; ipHash?: string | null };

const FAILED_RESULTS = ["UNKNOWN", "COUNTERFEIT", "HISTORY_COMPROMISED", "SUSPICIOUS"];
const userSelect = { id: true, email: true, fullName: true, platformRole: true, status: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true } as const;

/**
 * ORIGINX platform administration. Admins manage organizations, users and the platform, and can
 * review everything — but never edit historical product records. Interventions (e.g. revoking an
 * identity) are appended as new audited events.
 */
export class AdminService {
  private audit(a: AdminActor, action: string, resourceType: string, resourceId: string | null, metadata: unknown = {}, organizationId: string | null = null) {
    return writeAudit({ organizationId, actorUserId: a.userId, action: `ADMIN_${action}`, resourceType, resourceId, metadata: { adminRole: a.role, ...(metadata as object) }, ipHash: a.ipHash });
  }

  async dashboard() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [orgs, pendingOrgs, users, products, openIncidents, activeRecalls, proofs, pendingProofs, failedProofs, verifications24h, collisions, chain] = await Promise.all([
      prisma.organization.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.organization.count({ where: { status: "PENDING" } }),
      prisma.user.count(),
      prisma.product.count(),
      prisma.incident.count({ where: { status: { in: OPEN_INCIDENT_STATUS } } }),
      prisma.recall.count({ where: { status: { in: ACTIVE_RECALL_STATUS } } }),
      prisma.blockchainProof.count({ where: { status: "CONFIRMED" } }),
      prisma.blockchainProof.count({ where: { status: "PENDING" } }),
      prisma.blockchainProof.count({ where: { status: "FAILED" } }),
      prisma.verificationLog.count({ where: { timestamp: { gte: since24h } } }),
      prisma.incident.count({ where: { type: "IDENTITY_COLLISION" } }),
      blockchainService.status(),
    ]);
    return {
      organizations: { byStatus: Object.fromEntries(orgs.map((o) => [o.status, o._count._all])), pendingApproval: pendingOrgs },
      users,
      products,
      openIncidents,
      activeRecalls,
      identityCollisions: collisions,
      verificationsLast24h: verifications24h,
      blockchain: { confirmedProofs: proofs, pendingProofs, failedProofs, network: chain },
    };
  }

  async metrics() {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [byResult, collisions, recalled, suspicious, perDay] = await Promise.all([
      prisma.verificationLog.groupBy({ by: ["result"], where: { timestamp: { gte: since30 } }, _count: { _all: true } }),
      prisma.incident.count({ where: { type: "IDENTITY_COLLISION", createdAt: { gte: since30 } } }),
      prisma.product.count({ where: { status: "RECALLED" } }),
      prisma.product.count({ where: { OR: [{ riskLevel: { in: ["HIGH", "CRITICAL"] } }, { status: "QUARANTINED" }] } }),
      prisma.$queryRaw<Array<{ day: Date; total: bigint; failed: bigint }>>`
        SELECT date_trunc('day', "timestamp") AS day,
               count(*) AS total,
               count(*) FILTER (WHERE "result" IN ('UNKNOWN','COUNTERFEIT','HISTORY_COMPROMISED','SUSPICIOUS')) AS failed
        FROM "VerificationLog" WHERE "timestamp" >= ${since30}
        GROUP BY 1 ORDER BY 1`,
    ]);
    return {
      verificationVolume30d: perDay.map((d) => ({ day: d.day, total: Number(d.total), failed: Number(d.failed) })),
      verificationResults30d: Object.fromEntries(byResult.map((r) => [r.result, r._count._all])),
      verificationFailures30d: byResult.filter((r) => FAILED_RESULTS.includes(r.result)).reduce((s, r) => s + r._count._all, 0),
      counterfeitAttempts30d: byResult.find((r) => r.result === "COUNTERFEIT")?._count._all ?? 0,
      identityCollisions30d: collisions,
      productsRecalled: recalled,
      suspiciousProducts: suspicious,
      mostVerifiedProducts: await this.mostVerified(),
      organizationsWithUnusualActivity: await this.unusualOrganizations(since30),
    };
  }

  private async mostVerified() {
    const rows = await prisma.verificationLog.groupBy({
      by: ["productId"],
      where: { productId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { productId: "desc" } },
      take: 10,
    });
    const products = await prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId!) } },
      select: { id: true, productCode: true, productName: true, organization: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...products.find((p) => p.id === r.productId), verifications: r._count._all }));
  }

  /** Organizations with collisions, integrity incidents or many failed verifications recently. */
  private async unusualOrganizations(since: Date) {
    const incidents = await prisma.incident.groupBy({
      by: ["organizationId", "type"],
      where: { createdAt: { gte: since }, type: { in: ["IDENTITY_COLLISION", "TAMPERED_RECORD", "INVALID_BLOCKCHAIN_PROOF", "SUSPICIOUS_VERIFICATION_PATTERN", "BROKEN_CUSTODY_CHAIN"] } },
      _count: { _all: true },
    });
    const byOrg = new Map<string, Record<string, number>>();
    for (const row of incidents) {
      const entry = byOrg.get(row.organizationId) ?? {};
      entry[row.type] = row._count._all;
      byOrg.set(row.organizationId, entry);
    }
    const orgs = await prisma.organization.findMany({ where: { id: { in: [...byOrg.keys()] } }, select: { id: true, name: true, status: true, verificationStatus: true } });
    return orgs
      .map((o) => ({ ...o, signals: byOrg.get(o.id)!, total: Object.values(byOrg.get(o.id)!).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total);
  }

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  async organizations(q: Query) {
    const search = str(q, "q");
    const where = {
      ...(str(q, "status") ? { status: str(q, "status") } : {}),
      ...(str(q, "verificationStatus") ? { verificationStatus: str(q, "verificationStatus") } : {}),
      ...(str(q, "type") ? { organizationType: str(q, "type") } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { slug: { contains: search, mode: "insensitive" as const } }] } : {}),
    };
    const result = await paginate(
      q,
      () => prisma.organization.count({ where }),
      (page) =>
        prisma.organization.findMany({
          where,
          ...page,
          orderBy: parseSort(q, ["createdAt", "name", "status"] as const, "createdAt"),
          include: { _count: { select: { members: true, products: true, incidents: true } } },
        }),
    );
    return { ...result, items: result.items.map(presentOrganization) };
  }

  async organization(id: string) {
    const org = await prisma.organization.findUnique({
      where: { id },
      include: {
        members: { select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, email: true, fullName: true, status: true } } } },
        _count: { select: { products: true, incidents: true, recalls: true, relationshipsFrom: true, relationshipsTo: true } },
      },
    });
    if (!org) throw notFound("Organization");
    return { ...presentOrganization(org), entitlements: await entitlementService.snapshot(id) };
  }

  /** Per-organization performance for the admin console: recorded activity only, last 30 days. */
  async organizationPerformance(id: string) {
    const org = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
    if (!org) throw notFound("Organization");
    const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);
    const productWhere = { organizationId: id };
    const [scanDays, saleDays, byResult, trust, status, proofs, avgTrust, products, warehouses, openIncidents, activeRecalls, custody] = await Promise.all([
      prisma.$queryRaw<Array<{ day: Date; total: bigint; failed: bigint }>>`
        SELECT date_trunc('day', v."timestamp") AS day, count(*) AS total,
               count(*) FILTER (WHERE v."result" IN ('UNKNOWN','COUNTERFEIT','HISTORY_COMPROMISED','SUSPICIOUS')) AS failed
        FROM "VerificationLog" v JOIN "Product" p ON p."id" = v."productId"
        WHERE p."organizationId" = ${id} AND v."timestamp" >= ${since}
        GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<Array<{ day: Date; currency: string; orders: bigint; revenue: string }>>`
        SELECT date_trunc('day', s."soldAt") AS day, s."currency", count(DISTINCT s."id") AS orders, coalesce(sum(i."lineTotal"), 0)::text AS revenue
        FROM "Sale" s LEFT JOIN "SaleItem" i ON i."saleId" = s."id"
        WHERE s."organizationId" = ${id} AND s."soldAt" >= ${since}
        GROUP BY 1, 2 ORDER BY 1`,
      prisma.verificationLog.groupBy({ by: ["result"], where: { timestamp: { gte: since }, product: productWhere }, _count: { _all: true } }),
      prisma.product.groupBy({ by: ["trustLevel"], where: productWhere, _count: { _all: true } }),
      prisma.product.groupBy({ by: ["status"], where: productWhere, _count: { _all: true } }),
      prisma.blockchainProof.groupBy({ by: ["status"], where: { product: productWhere }, _count: { _all: true } }),
      prisma.product.aggregate({ where: productWhere, _avg: { trustScore: true } }),
      prisma.product.count({ where: productWhere }),
      prisma.warehouse.count({ where: { organizationId: id } }),
      prisma.incident.count({ where: { organizationId: id, status: { in: ["OPEN", "INVESTIGATING"] } } }),
      prisma.recall.count({ where: { organizationId: id, status: { in: ["INITIATED", "IN_PROGRESS"] } } }),
      prisma.custodyTransfer.count({ where: { OR: [{ fromOrganizationId: id }, { toOrganizationId: id }], status: "TRANSFER_ACCEPTED" } }),
    ]);
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const scans = new Map(scanDays.map((d) => [key(d.day), d]));
    const currencies = [...new Set(saleDays.map((d) => d.currency))];
    const days = Array.from({ length: 30 }, (_, i) => key(new Date(since.getTime() + i * 24 * 60 * 60 * 1000)));
    return {
      since: since.toISOString(),
      kpis: {
        products, warehouses, openIncidents, activeRecalls, completedCustodyTransfers: custody,
        averageTrustScore: avgTrust._avg.trustScore === null ? null : Math.round(avgTrust._avg.trustScore),
        scans30d: byResult.reduce((n, r) => n + r._count._all, 0),
        failedScans30d: byResult.filter((r) => FAILED_RESULTS.includes(r.result)).reduce((n, r) => n + r._count._all, 0),
        orders30d: saleDays.reduce((n, d) => n + Number(d.orders), 0),
        revenue30d: currencies.map((currency) => ({ currency, revenue: saleDays.filter((d) => d.currency === currency).reduce((n, d) => n + Number(d.revenue), 0).toFixed(2) })),
      },
      verificationsByDay: days.map((day) => ({ day, total: Number(scans.get(day)?.total ?? 0), failed: Number(scans.get(day)?.failed ?? 0) })),
      salesByDay: days.map((day) => ({
        day,
        orders: saleDays.filter((d) => key(d.day) === day).reduce((n, d) => n + Number(d.orders), 0),
        ...Object.fromEntries(currencies.map((c) => [c, Number(saleDays.find((d) => key(d.day) === day && d.currency === c)?.revenue ?? 0)])),
      })),
      salesCurrencies: currencies,
      verificationResults: Object.fromEntries(byResult.map((r) => [r.result, r._count._all])),
      trustLevels: Object.fromEntries(trust.map((t) => [t.trustLevel, t._count._all])),
      productStatus: Object.fromEntries(status.map((t) => [t.status, t._count._all])),
      proofs: Object.fromEntries(proofs.map((t) => [t.status, t._count._all])),
    };
  }

  async setOrganizationState(a: AdminActor, id: string, action: "approve" | "reject" | "suspend" | "reactivate" | "verify" | "unverify", input: unknown) {
    const { reason } = z.object({ reason: z.string().trim().max(1_000).optional() }).parse(input ?? {});
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) throw notFound("Organization");
    const data = {
      approve: { status: "ACTIVE" },
      reject: { status: "REJECTED", verificationStatus: "REJECTED" },
      suspend: { status: "SUSPENDED", verificationStatus: "SUSPENDED" },
      reactivate: { status: "ACTIVE", verificationStatus: org.verifiedAt ? "VERIFIED" : "PENDING" },
      verify: { status: "ACTIVE", verificationStatus: "VERIFIED", verifiedAt: new Date() },
      unverify: { verificationStatus: "PENDING" },
    }[action];
    if (action === "approve" && org.status !== "PENDING") throw new AppError("INVALID_STATE", "Only pending organizations can be approved.", 409);
    if (action === "reactivate" && org.status !== "SUSPENDED") throw new AppError("INVALID_STATE", "Only suspended organizations can be reactivated.", 409);
    const updated = await prisma.organization.update({ where: { id }, data });
    await this.audit(a, `ORGANIZATION_${action.toUpperCase()}`, "Organization", id, { reason, from: { status: org.status, verificationStatus: org.verificationStatus } }, id);
    // Organization verification is a trust-score input for all of its products.
    const products = await prisma.product.findMany({ where: { organizationId: id }, select: { id: true } });
    for (const p of products) await trustScoreService.calculate(p.id);
    return presentOrganization(updated);
  }

  async updateSubscription(a: AdminActor, id: string, input: unknown) {
    const data = z
      .object({
        plan: z.enum(PLAN_NAMES),
        status: z.enum(["ACTIVE", "TRIALING", "PAST_DUE", "CANCELLED"]).optional(),
        expiresAt: z.string().datetime().nullable().optional(),
        productLimit: z.number().int().positive().optional(),
        userLimit: z.number().int().positive().optional(),
      })
      .parse(input);
    if (!(await prisma.organization.findUnique({ where: { id } }))) throw notFound("Organization");
    const updated = await prisma.organization.update({
      where: { id },
      data: {
        ...entitlementService.planData(data.plan, data),
        subscriptionStatus: data.status ?? "ACTIVE",
        subscriptionStartedAt: new Date(),
        ...(data.expiresAt !== undefined ? { subscriptionExpiresAt: data.expiresAt ? new Date(data.expiresAt) : null } : {}),
      },
    });
    await this.audit(a, "SUBSCRIPTION_UPDATED", "Organization", id, data, id);
    return presentOrganization(updated);
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  async users(q: Query) {
    const search = str(q, "q");
    const where = {
      ...(str(q, "platformRole") ? { platformRole: str(q, "platformRole") } : {}),
      ...(str(q, "status") ? { status: str(q, "status") } : {}),
      ...(search ? { OR: [{ email: { contains: search, mode: "insensitive" as const } }, { fullName: { contains: search, mode: "insensitive" as const } }] } : {}),
    };
    return paginate(
      q,
      () => prisma.user.count({ where }),
      (page) =>
        prisma.user.findMany({
          where,
          ...page,
          orderBy: { createdAt: "desc" },
          select: { ...userSelect, memberships: { select: { role: true, status: true, organization: { select: { id: true, name: true } } } } },
        }),
    );
  }

  async setUserStatus(a: AdminActor, userId: string, input: unknown) {
    const { status } = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) }).parse(input);
    if (userId === a.userId) throw new AppError("CANNOT_MODIFY_SELF", "You cannot change your own account status.", 409);
    const user = await prisma.user.update({
      where: { id: userId },
      // Suspending also invalidates every live session immediately.
      data: { status, ...(status === "SUSPENDED" ? { sessionVersion: { increment: 1 } } : {}) },
      select: userSelect,
    });
    if (status === "SUSPENDED") await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit(a, `USER_${status}`, "User", userId);
    return user;
  }

  async setPlatformRole(a: AdminActor, userId: string, input: unknown) {
    const { platformRole } = z.object({ platformRole: z.enum(Object.values(PLATFORM_ROLES) as [string, ...string[]]) }).parse(input);
    if (userId === a.userId) throw new AppError("CANNOT_MODIFY_SELF", "You cannot change your own platform role.", 409);
    const user = await prisma.user.update({ where: { id: userId }, data: { platformRole, sessionVersion: { increment: 1 } }, select: userSelect });
    await this.audit(a, "PLATFORM_ROLE_CHANGED", "User", userId, { platformRole });
    return user;
  }

  // ---------------------------------------------------------------------------
  // Products, incidents, recalls, proofs, logs (read) + audited interventions
  // ---------------------------------------------------------------------------

  async products(q: Query) {
    const search = str(q, "q");
    const where = {
      ...(str(q, "status") ? { status: str(q, "status") } : {}),
      ...(str(q, "organizationId") ? { organizationId: str(q, "organizationId") } : {}),
      ...(str(q, "riskLevel") ? { riskLevel: str(q, "riskLevel") } : {}),
      ...(search ? { OR: [{ productName: { contains: search, mode: "insensitive" as const } }, { productCode: { contains: search, mode: "insensitive" as const } }] } : {}),
    };
    return paginate(
      q,
      () => prisma.product.count({ where }),
      (page) =>
        prisma.product.findMany({
          where,
          ...page,
          orderBy: parseSort(q, ["createdAt", "trustScore", "productName"] as const, "createdAt"),
          select: {
            id: true, productCode: true, productName: true, status: true, trustScore: true, trustLevel: true, riskLevel: true,
            verificationStatus: true, authenticityStatus: true, createdAt: true,
            organization: { select: { id: true, name: true } },
            identity: { select: { status: true, isCanonical: true } },
          },
        }),
    );
  }

  /**
   * Compliance intervention on a product identity (e.g. REVOKED after a confirmed counterfeit
   * investigation). Recorded as a new STATUS_CHANGED event + on-chain status — history is untouched.
   */
  async setIdentityStatus(a: AdminActor, productId: string, input: unknown) {
    const { status, reason } = z.object({ status: z.enum(IDENTITY_STATUS), reason: z.string().trim().min(3).max(1_000) }).parse(input);
    const product = await prisma.product.findUnique({ where: { id: productId }, include: { identity: true } });
    if (!product?.identity) throw notFound("Product");
    const previous = product.identity.status;
    await eventService.append({
      organizationId: product.organizationId,
      actorUserId: a.userId,
      productId,
      eventType: "STATUS_CHANGED",
      metadata: { previousStatus: previous, newStatus: status, reason, intervention: "PLATFORM_ADMIN" },
      anchor: true,
      ipHash: a.ipHash,
    });
    await prisma.productIdentity.update({ where: { productId }, data: { status } });
    if (["SUSPENDED", "REVOKED"].includes(status)) await prisma.product.update({ where: { id: productId }, data: { status: "SUSPENDED" } });
    if (status === "ACTIVE" && product.status === "SUSPENDED") await prisma.product.update({ where: { id: productId }, data: { status: "ACTIVE" } });
    if (product.identity.isCanonical) await blockchainService.anchorIdentityStatus(productId, product.identity.identityHash, status);
    await this.audit(a, "IDENTITY_STATUS_CHANGED", "Product", productId, { from: previous, to: status, reason }, product.organizationId);
    await trustScoreService.calculate(productId);
    return prisma.productIdentity.findUniqueOrThrow({ where: { productId } });
  }

  async incidents(q: Query) {
    const where = {
      ...(str(q, "type") ? { type: str(q, "type") } : {}),
      ...(str(q, "status") ? { status: str(q, "status") } : {}),
      ...(str(q, "severity") ? { severity: str(q, "severity") } : {}),
      ...(str(q, "organizationId") ? { organizationId: str(q, "organizationId") } : {}),
    };
    const result = await paginate(
      q,
      () => prisma.incident.count({ where }),
      (page) =>
        prisma.incident.findMany({
          where,
          ...page,
          orderBy: { createdAt: "desc" },
          include: { organization: { select: { id: true, name: true } }, product: { select: { id: true, productCode: true, productName: true } } },
        }),
    );
    return { ...result, items: result.items.map(({ evidenceJson, ...i }) => ({ ...i, evidence: json(evidenceJson) })) };
  }

  updateIncident(a: AdminActor, id: string, input: unknown) {
    return incidentService.updateStatus({ userId: a.userId, organizationId: null, ipHash: a.ipHash }, id, input);
  }

  async recalls(q: Query) {
    const where = { ...(str(q, "status") ? { status: str(q, "status") } : {}), ...(str(q, "organizationId") ? { organizationId: str(q, "organizationId") } : {}) };
    return paginate(
      q,
      () => prisma.recall.count({ where }),
      (page) =>
        prisma.recall.findMany({
          where,
          ...page,
          orderBy: { createdAt: "desc" },
          include: { organization: { select: { id: true, name: true } }, product: { select: { id: true, productCode: true } }, batch: { select: { batchCode: true } } },
        }),
    );
  }

  async proofs(q: Query) {
    const where = { ...(str(q, "status") ? { status: str(q, "status") } : {}), ...(str(q, "kind") ? { kind: str(q, "kind") } : {}), ...(str(q, "productId") ? { productId: str(q, "productId") } : {}) };
    const result = await paginate(
      q,
      () => prisma.blockchainProof.count({ where }),
      (page) => prisma.blockchainProof.findMany({ where, ...page, orderBy: { createdAt: "desc" }, include: { product: { select: { productCode: true, organizationId: true } } } }),
    );
    return { ...result, items: result.items.map((p) => ({ ...p, explorerUrl: blockchainService.explorerUrl(p.transactionHash) })) };
  }

  async auditLogs(q: Query) {
    const where = {
      ...(str(q, "organizationId") ? { organizationId: str(q, "organizationId") } : {}),
      ...(str(q, "actorUserId") ? { actorUserId: str(q, "actorUserId") } : {}),
      ...(str(q, "action") ? { action: str(q, "action") } : {}),
      ...(str(q, "resourceType") ? { resourceType: str(q, "resourceType") } : {}),
      ...(str(q, "resourceId") ? { resourceId: str(q, "resourceId") } : {}),
    };
    const result = await paginate(
      q,
      () => prisma.auditLog.count({ where }),
      (page) => prisma.auditLog.findMany({ where, ...page, orderBy: { timestamp: "desc" } }),
    );
    return { ...result, items: result.items.map(({ metadataJson, ...l }) => ({ ...l, metadata: json(metadataJson) })) };
  }

  async verificationLogs(q: Query) {
    const where = { ...(str(q, "result") ? { result: str(q, "result") } : {}), ...(str(q, "productId") ? { productId: str(q, "productId") } : {}) };
    return paginate(
      q,
      () => prisma.verificationLog.count({ where }),
      (page) => prisma.verificationLog.findMany({ where, ...page, orderBy: { timestamp: "desc" } }),
    );
  }

  // ---------------------------------------------------------------------------
  // Platform settings
  // ---------------------------------------------------------------------------

  async settings() {
    const rows = await prisma.platformSetting.findMany({ orderBy: { key: "asc" } });
    return Object.fromEntries(rows.map((r) => [r.key, json(r.valueJson, null)]));
  }

  async updateSetting(a: AdminActor, key: string, input: unknown) {
    if (!/^[a-z][a-zA-Z0-9_.]{1,63}$/.test(key)) throw new AppError("INVALID_SETTING_KEY", "Invalid setting key.", 422);
    const { value } = z.object({ value: z.unknown() }).parse(input);
    const valueJson = JSON.stringify(value ?? null);
    const setting = await prisma.platformSetting.upsert({ where: { key }, update: { valueJson }, create: { key, valueJson } });
    await this.audit(a, "SETTING_UPDATED", "PlatformSetting", setting.id, { key, value });
    return { key, value };
  }

  /** Read-only, cross-tenant inventory health for platform staff. */
  async inventoryOverview() {
    const [warehouses, skus, shipmentsByStatus, discrepanciesByType, held] = await Promise.all([
      prisma.warehouse.count(),
      prisma.productSku.count(),
      prisma.shipment.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.inventoryDiscrepancy.groupBy({ by: ["type"], where: { status: "OPEN" }, _count: { _all: true } }),
      prisma.productBatch.count({ where: { holdStatus: { not: "NONE" } } }),
    ]);
    return {
      warehouses,
      skus,
      batchesOnHold: held,
      shipmentsByStatus: Object.fromEntries(shipmentsByStatus.map((s) => [s.status, s._count._all])),
      openDiscrepanciesByType: Object.fromEntries(discrepanciesByType.map((d) => [d.type, d._count._all])),
    };
  }

  async inventorySalesOverview() {
    const since = new Date(Date.now() - 30 * 86400000);
    const [orders, revenue] = await Promise.all([
      prisma.sale.count({ where: { soldAt: { gte: since } } }),
      prisma.$queryRaw<Array<{ currency: string; revenue: string }>>`
        SELECT s.currency, SUM(i."lineTotal")::text AS revenue
        FROM "Sale" s JOIN "SaleItem" i ON i."saleId" = s.id
        WHERE s."soldAt" >= ${since}
        GROUP BY s.currency ORDER BY s.currency`,
    ]);
    return { orders, revenue };
  }

  async inventoryWarehouses() {
    const warehouses = await prisma.warehouse.findMany({
      select: { id: true, organizationId: true, code: true, name: true, city: true, country: true, latitude: true, longitude: true, status: true },
      orderBy: [{ country: "asc" }, { city: "asc" }, { name: "asc" }],
    });
    const organizations = await prisma.organization.findMany({ where: { id: { in: [...new Set(warehouses.map((w) => w.organizationId))] } }, select: { id: true, name: true } });
    return warehouses.map(({ organizationId, ...warehouse }) => ({ ...warehouse, organization: { name: organizations.find((o) => o.id === organizationId)?.name ?? "Unknown organization" } }));
  }

  async inventoryDiscrepancies(q: Query) {
    const where = { ...(str(q, "status") ? { status: str(q, "status") } : {}), ...(str(q, "organizationId") ? { organizationId: str(q, "organizationId") } : {}) };
    const result = await paginate(q, () => prisma.inventoryDiscrepancy.count({ where }), (page) => prisma.inventoryDiscrepancy.findMany({ where, ...page, orderBy: { createdAt: "desc" } }));
    const orgs = await prisma.organization.findMany({ where: { id: { in: result.items.map((d) => d.organizationId) } }, select: { id: true, name: true } });
    return { ...result, items: result.items.map(({ detailsJson, ...d }) => ({ ...d, details: json(detailsJson), organization: orgs.find((o) => o.id === d.organizationId) })) };
  }

  async anchorPending(a: AdminActor) {
    const result = await blockchainService.anchorPending(200);
    await this.audit(a, "BLOCKCHAIN_ANCHOR_RETRY", "BlockchainProof", null, result);
    return result;
  }

  async retryFailedProof(a: AdminActor, proofId: string) {
    const proof = await blockchainService.retryFailedProof(proofId);
    await this.audit(a, "BLOCKCHAIN_PROOF_MANUAL_RETRY", "BlockchainProof", proof.id, { status: proof.status, attempts: proof.attempts });
    return proof;
  }
}

export const adminService = new AdminService();
