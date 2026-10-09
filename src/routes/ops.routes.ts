import { Router } from "express";
import { ok } from "../lib/errors.js";
import { clientIpHash, param, query } from "../lib/http.js";
import { paginate, str } from "../lib/pagination.js";
import { json, prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { verifyLimiter } from "../middleware/rateLimit.js";
import { actor, can, requireOrganization, tenantId } from "../middleware/tenant.js";
import { analyticsService } from "../services/analytics.service.js";
import { blockchainService } from "../services/blockchain.service.js";
import { custodyService } from "../services/custody.service.js";
import { entitlementService } from "../services/entitlement.service.js";
import { incidentService } from "../services/incident.service.js";
import { productService } from "../services/product.service.js";
import { recallService } from "../services/recall.service.js";
import { verificationService } from "../services/verification.service.js";

/** Tenant-scoped operational domains. Every route requires membership of X-Organization-Id. */
export const opsRouter = Router();
opsRouter.use(requireAuth, requireOrganization);

// Batches
opsRouter.get("/batches", can("products:read"), async (req, res) => {
  const result = await productService.listBatches(tenantId(req), query(req));
  res.json(ok(result.items, result.meta));
});
opsRouter.post("/batches", can("products:create"), async (req, res) => {
  res.status(201).json(ok(await productService.createBatch(actor(req), req.body)));
});
opsRouter.get("/batches/:id", can("products:read"), async (req, res) => {
  res.json(ok(await productService.getBatch(tenantId(req), param(req, "id"))));
});

// Custody transfers
opsRouter.get("/custody-transfers", can("products:read"), async (req, res) => {
  res.json(ok(await custodyService.list(tenantId(req), query(req))));
});
opsRouter.post("/custody-transfers", can("custody:request"), async (req, res) => {
  res.status(201).json(ok(await custodyService.request(actor(req), req.body)));
});
opsRouter.post("/custody-transfers/:id/accept", can("custody:respond"), async (req, res) => {
  res.json(ok(await custodyService.accept(actor(req), param(req, "id"), req.body)));
});
opsRouter.post("/custody-transfers/:id/reject", can("custody:respond"), async (req, res) => {
  res.json(ok(await custodyService.reject(actor(req), param(req, "id"), req.body)));
});
opsRouter.post("/custody-transfers/:id/cancel", can("custody:request"), async (req, res) => {
  res.json(ok(await custodyService.cancel(actor(req), param(req, "id"))));
});

// Incidents
opsRouter.get("/incidents", can("incidents:read"), async (req, res) => {
  const result = await incidentService.list(tenantId(req), query(req));
  res.json(ok(result.items, result.meta));
});
opsRouter.get("/incidents/:id", can("incidents:read"), async (req, res) => {
  res.json(ok(await incidentService.get(tenantId(req), param(req, "id"))));
});
opsRouter.post("/incidents", can("incidents:create"), async (req, res) => {
  res.status(201).json(ok(await incidentService.createFromRequest(actor(req), req.body)));
});
opsRouter.patch("/incidents/:id", can("incidents:manage"), async (req, res) => {
  res.json(ok(await incidentService.updateStatus(actor(req), param(req, "id"), req.body)));
});

// Recalls
opsRouter.get("/recalls", can("recalls:read"), async (req, res) => {
  res.json(ok(await recallService.list(tenantId(req), query(req))));
});
opsRouter.get("/recalls/:id", can("recalls:read"), async (req, res) => {
  res.json(ok(await recallService.get(tenantId(req), param(req, "id"))));
});
opsRouter.post("/recalls", can("recalls:manage"), async (req, res) => {
  res.status(201).json(ok(await recallService.create(actor(req), req.body)));
});
opsRouter.post("/recalls/:id/transition", can("recalls:manage"), async (req, res) => {
  res.json(ok(await recallService.transition(actor(req), param(req, "id"), req.body)));
});

// Verification (operator scan + logs)
opsRouter.post("/verification/scan", can("verification:scan"), verifyLimiter, async (req, res) => {
  const result = await verificationService.verifyPublic(String(req.body?.token ?? ""), {
    ipHash: clientIpHash(req),
    userAgent: req.get("user-agent") ?? undefined,
    source: "ORG_SCAN",
  });
  res.json(ok(result.result));
});
opsRouter.get("/verification/logs", can("analytics:read"), async (req, res) => {
  const result = await verificationService.organizationVerificationLogs(tenantId(req), query(req));
  res.json(ok(result.items, result.meta));
});

// Analytics
opsRouter.get("/analytics/dashboard", can("analytics:read"), async (req, res) => {
  res.json(ok(await analyticsService.organizationDashboard(tenantId(req))));
});
opsRouter.get("/analytics/most-verified", can("analytics:read"), async (req, res) => {
  res.json(ok(await analyticsService.mostVerifiedProducts(tenantId(req))));
});

// Entitlements
opsRouter.get("/entitlements", can("org:read"), async (req, res) => {
  res.json(ok(await entitlementService.snapshot(tenantId(req))));
});

// Blockchain network status
opsRouter.get("/blockchain/status", can("org:read"), async (_req, res) => {
  res.json(ok(await blockchainService.status()));
});

// Audit logs (own organization only; append-only, read-only API)
opsRouter.get("/audit-logs", can("audit:read"), async (req, res) => {
  const q = query(req);
  const where = {
    organizationId: tenantId(req),
    ...(str(q, "action") ? { action: str(q, "action") } : {}),
    ...(str(q, "resourceType") ? { resourceType: str(q, "resourceType") } : {}),
    ...(str(q, "resourceId") ? { resourceId: str(q, "resourceId") } : {}),
  };
  const result = await paginate(
    q,
    () => prisma.auditLog.count({ where }),
    (page) => prisma.auditLog.findMany({ where, ...page, orderBy: { timestamp: "desc" } }),
  );
  res.json(ok(result.items.map(({ metadataJson, ...l }) => ({ ...l, metadata: json(metadataJson) })), result.meta));
});
