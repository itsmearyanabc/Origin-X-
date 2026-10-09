import { Router } from "express";
import { ok } from "../lib/errors.js";
import { clientIpHash, param, query } from "../lib/http.js";
import { requireAuth } from "../middleware/auth.js";
import { actor, can, requireOrganization, tenantId } from "../middleware/tenant.js";
import { entitlementService } from "../services/entitlement.service.js";
import { organizationService } from "../services/organization.service.js";

/**
 * /organizations — onboarding + the "current" organization selected by X-Organization-Id.
 * Every /current route is tenant-scoped and RBAC-checked on the server.
 */
export const organizationRouter = Router();
organizationRouter.use(requireAuth);

organizationRouter.post("/", async (req, res) => {
  res.status(201).json(ok(await organizationService.create(req.user!.id, req.body, clientIpHash(req))));
});

organizationRouter.post("/invitations/accept", async (req, res) => {
  res.json(ok(await organizationService.acceptInvitation(req.user!.id, req.user!.email, String(req.body?.token ?? ""))));
});

const current = Router();
current.use(requireOrganization);

current.get("/", can("org:read"), async (req, res) => {
  res.json(ok(await organizationService.get(tenantId(req))));
});
current.patch("/", can("org:settings"), async (req, res) => {
  res.json(ok(await organizationService.update(actor(req), req.body)));
});
current.get("/entitlements", can("org:read"), async (req, res) => {
  res.json(ok(await entitlementService.snapshot(tenantId(req))));
});

current.get("/members", can("members:read"), async (req, res) => {
  res.json(ok(await organizationService.members(tenantId(req))));
});
current.patch("/members/:memberId", can("members:manage"), async (req, res) => {
  res.json(ok(await organizationService.changeRole(actor(req), param(req, "memberId"), req.body)));
});
current.delete("/members/:memberId", can("members:manage"), async (req, res) => {
  res.json(ok(await organizationService.removeMember(actor(req), param(req, "memberId"))));
});

current.get("/invitations", can("members:manage"), async (req, res) => {
  res.json(ok(await organizationService.invitations(tenantId(req))));
});
current.post("/invitations", can("members:manage"), async (req, res) => {
  res.status(201).json(ok(await organizationService.invite(actor(req), req.body)));
});
current.delete("/invitations/:invitationId", can("members:manage"), async (req, res) => {
  res.json(ok(await organizationService.revokeInvitation(actor(req), param(req, "invitationId"))));
});

// Supply-chain partners
current.get("/discover", can("relationships:read"), async (req, res) => {
  const result = await organizationService.discover(tenantId(req), query(req));
  res.json(ok(result.items, result.meta));
});
current.get("/relationships", can("relationships:read"), async (req, res) => {
  res.json(ok(await organizationService.relationships(tenantId(req), query(req))));
});
current.post("/relationships", can("relationships:manage"), async (req, res) => {
  res.status(201).json(ok(await organizationService.requestRelationship(actor(req), req.body)));
});
current.post("/relationships/:id/accept", can("relationships:manage"), async (req, res) => {
  res.json(ok(await organizationService.respondRelationship(actor(req), param(req, "id"), true)));
});
current.post("/relationships/:id/reject", can("relationships:manage"), async (req, res) => {
  res.json(ok(await organizationService.respondRelationship(actor(req), param(req, "id"), false)));
});
current.post("/relationships/:id/suspend", can("relationships:manage"), async (req, res) => {
  res.json(ok(await organizationService.suspendRelationship(actor(req), param(req, "id"))));
});

organizationRouter.use("/current", current);
