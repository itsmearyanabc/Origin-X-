import { Router, type Request } from "express";
import { ok } from "../lib/errors.js";
import { clientIpHash, param, query } from "../lib/http.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { adminService, type AdminActor } from "../services/admin.service.js";
import { blockchainService } from "../services/blockchain.service.js";
import { contactService } from "../services/contact.service.js";

/** ORIGINX platform administration. Organization users never pass requireAdmin. */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin("admin:read"));

const admin = (req: Request): AdminActor => ({ userId: req.user!.id, role: req.user!.platformRole, ipHash: clientIpHash(req) });
const list = <T>(r: { items: T[]; meta: Record<string, unknown> }) => ok(r.items, r.meta);

adminRouter.get("/dashboard", async (_req, res) => res.json(ok(await adminService.dashboard())));
adminRouter.get("/platform-metrics", async (_req, res) => res.json(ok(await adminService.metrics())));

// Organizations
adminRouter.get("/organizations", async (req, res) => res.json(list(await adminService.organizations(query(req)))));
adminRouter.get("/organizations/:id", async (req, res) => res.json(ok(await adminService.organization(param(req, "id")))));
for (const action of ["approve", "reject", "suspend", "reactivate", "verify", "unverify"] as const) {
  adminRouter.post(`/organizations/:id/${action}`, requireAdmin("admin:orgs:manage"), async (req, res) => {
    res.json(ok(await adminService.setOrganizationState(admin(req), param(req, "id"), action, req.body)));
  });
}
adminRouter.put("/organizations/:id/subscription", requireAdmin("admin:subscriptions"), async (req, res) => {
  res.json(ok(await adminService.updateSubscription(admin(req), param(req, "id"), req.body)));
});

// Users
adminRouter.get("/users", async (req, res) => res.json(list(await adminService.users(query(req)))));
adminRouter.patch("/users/:id/status", requireAdmin("admin:users:manage"), async (req, res) => {
  res.json(ok(await adminService.setUserStatus(admin(req), param(req, "id"), req.body)));
});
adminRouter.patch("/users/:id/platform-role", requireAdmin("admin:users:manage"), async (req, res) => {
  res.json(ok(await adminService.setPlatformRole(admin(req), param(req, "id"), req.body)));
});

// Products & compliance interventions
adminRouter.get("/products", async (req, res) => res.json(list(await adminService.products(query(req)))));
adminRouter.post("/products/:id/identity-status", requireAdmin("admin:compliance"), async (req, res) => {
  res.json(ok(await adminService.setIdentityStatus(admin(req), param(req, "id"), req.body)));
});
adminRouter.get("/incidents", async (req, res) => res.json(list(await adminService.incidents(query(req)))));
adminRouter.patch("/incidents/:id", requireAdmin("admin:compliance"), async (req, res) => {
  res.json(ok(await adminService.updateIncident(admin(req), param(req, "id"), req.body)));
});
adminRouter.get("/recalls", async (req, res) => res.json(list(await adminService.recalls(query(req)))));

// Blockchain
adminRouter.get("/blockchain/status", async (_req, res) => res.json(ok(await blockchainService.status())));
adminRouter.get("/blockchain/proofs", async (req, res) => res.json(list(await adminService.proofs(query(req)))));
adminRouter.get("/blockchain/proofs/:id/verify", async (req, res) => res.json(ok(await blockchainService.verifyProof(param(req, "id")))));
adminRouter.post("/blockchain/anchor-pending", requireAdmin("admin:blockchain"), async (req, res) => res.json(ok(await adminService.anchorPending(admin(req)))));

// Logs
adminRouter.get("/audit-logs", requireAdmin("admin:audit"), async (req, res) => res.json(list(await adminService.auditLogs(query(req)))));
adminRouter.get("/verification-logs", async (req, res) => res.json(list(await adminService.verificationLogs(query(req)))));

// Platform settings
adminRouter.get("/settings", async (_req, res) => res.json(ok(await adminService.settings())));
adminRouter.put("/settings/:key", requireAdmin("admin:settings"), async (req, res) => {
  res.json(ok(await adminService.updateSetting(admin(req), param(req, "key"), req.body)));
});

// Website contact messages
adminRouter.get("/contact-messages", async (req, res) => res.json(list(await contactService.list(query(req)))));
adminRouter.patch("/contact-messages/:id", requireAdmin("admin:orgs:manage"), async (req, res) => {
  res.json(ok(await contactService.setStatus(req.user!.id, param(req, "id"), req.body)));
});

// Inventory (read-only, cross-tenant)
adminRouter.get("/inventory/overview", async (_req, res) => res.json(ok(await adminService.inventoryOverview())));
adminRouter.get("/inventory/warehouses", async (_req, res) => res.json(ok(await adminService.inventoryWarehouses())));
adminRouter.get("/inventory/sales-overview", requireAdmin("admin:users:manage"), async (_req, res) => res.json(ok(await adminService.inventorySalesOverview())));
adminRouter.get("/inventory/discrepancies", requireAdmin("admin:audit"), async (req, res) => res.json(list(await adminService.inventoryDiscrepancies(query(req)))));
