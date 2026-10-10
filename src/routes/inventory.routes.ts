import { Router, type Request } from "express";
import { ok } from "../lib/errors.js";
import { param, query } from "../lib/http.js";
import { requireAuth } from "../middleware/auth.js";
import { actor, can, requireOrganization, tenantId } from "../middleware/tenant.js";
import { catalogueService } from "../services/inventory/catalogue.service.js";
import { inventoryService } from "../services/inventory/inventory.service.js";
import { shipmentService } from "../services/inventory/shipment.service.js";
import { salesService } from "../services/inventory/sales.service.js";
import { warehouseService } from "../services/inventory/warehouse.service.js";

/**
 * Inventory layer API (tenant-scoped). Retry-safe writes accept an `Idempotency-Key` header: a
 * repeated request with the same key returns the original result instead of applying it twice.
 */
export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireOrganization);

const idem = (req: Request) => req.header("idempotency-key") ?? undefined;

// Catalogue (SKUs)
inventoryRouter.get("/catalogue/skus", can("inventory:read"), async (req, res) => {
  const r = await catalogueService.listSkus(tenantId(req), query(req));
  res.json(ok(r.items, r.meta));
});
inventoryRouter.post("/catalogue/skus", can("catalogue:manage"), async (req, res) => {
  res.status(201).json(ok(await catalogueService.createSku(actor(req), req.body)));
});
inventoryRouter.get("/catalogue/skus/:id", can("inventory:read"), async (req, res) => {
  res.json(ok(await catalogueService.getSku(tenantId(req), param(req, "id"))));
});
inventoryRouter.patch("/catalogue/skus/:id", can("catalogue:manage"), async (req, res) => {
  res.json(ok(await catalogueService.updateSku(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.put("/catalogue/skus/:id/reorder-rule", can("catalogue:manage"), async (req, res) => {
  res.json(ok(await catalogueService.setReorderRule(actor(req), param(req, "id"), req.body)));
});

// Batches (extends the existing /batches resource)
inventoryRouter.patch("/batches/:id", can("catalogue:manage"), async (req, res) => {
  res.json(ok(await catalogueService.updateBatch(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.post("/batches/:id/passport", can("products:create"), async (req, res) => {
  res.status(201).json(ok(await catalogueService.createBatchPassport(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.post("/batches/:id/hold", can("inventory:quarantine"), async (req, res) => {
  res.json(ok(await inventoryService.setBatchHold(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.get("/batches/:id/inventory", can("inventory:read"), async (req, res) => {
  const r = await inventoryService.balances(tenantId(req), { ...query(req), batchId: param(req, "id"), pageSize: "100" });
  res.json(ok(r.items, r.meta));
});

// Warehouses & locations
inventoryRouter.get("/warehouses", can("inventory:read"), async (req, res) => {
  res.json(ok(await warehouseService.list(tenantId(req))));
});
inventoryRouter.post("/warehouses", can("warehouses:manage"), async (req, res) => {
  res.status(201).json(ok(await warehouseService.create(actor(req), req.body)));
});
inventoryRouter.get("/warehouses/:id", can("inventory:read"), async (req, res) => {
  res.json(ok(await warehouseService.get(tenantId(req), param(req, "id"))));
});
inventoryRouter.patch("/warehouses/:id", can("warehouses:manage"), async (req, res) => {
  res.json(ok(await warehouseService.update(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.post("/warehouses/:id/locations", can("warehouses:manage"), async (req, res) => {
  res.status(201).json(ok(await warehouseService.addLocation(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.patch("/locations/:id", can("warehouses:manage"), async (req, res) => {
  res.json(ok(await warehouseService.updateLocation(actor(req), param(req, "id"), req.body)));
});

// Inventory
inventoryRouter.get("/inventory/summary", can("inventory:read"), async (req, res) => {
  res.json(ok(await inventoryService.summary(tenantId(req))));
});
inventoryRouter.get("/inventory/sales-monitoring", can("inventory:read"), async (req, res) => {
  res.json(ok(await salesService.monitoring(tenantId(req), String(query(req).period ?? "30d"))));
});
inventoryRouter.get("/inventory/dispatch-monitoring", can("inventory:read"), async (req, res) => {
  res.json(ok(await inventoryService.salesMonitoring(tenantId(req), query(req))));
});
inventoryRouter.get("/sales", can("inventory:read"), async (req, res) => {
  const q = query(req);
  const result = await salesService.list(tenantId(req), Number(q.page ?? 1), Number(q.pageSize ?? 20));
  res.json(ok(result.items, result.meta));
});
inventoryRouter.post("/sales", can("inventory:dispatch"), async (req, res) => {
  res.status(201).json(ok(await salesService.create(actor(req), req.body, idem(req))));
});
inventoryRouter.get("/inventory/products", can("inventory:read"), async (req, res) => {
  res.json(ok(await inventoryService.productInventory(tenantId(req), query(req))));
});
inventoryRouter.get("/inventory/balances", can("inventory:read"), async (req, res) => {
  const r = await inventoryService.balances(tenantId(req), query(req));
  res.json(ok(r.items, r.meta));
});
inventoryRouter.get("/inventory/transactions", can("inventory:read"), async (req, res) => {
  const r = await inventoryService.transactions(tenantId(req), query(req));
  res.json(ok(r.items, r.meta));
});
// Per-type role checks happen in the service (receipt vs. adjustment vs. dispatch).
inventoryRouter.post("/inventory/movements", can("inventory:read"), async (req, res) => {
  res.status(201).json(ok(await inventoryService.recordMovement(actor(req), req.body, idem(req))));
});
inventoryRouter.post("/inventory/transfers", can("inventory:move"), async (req, res) => {
  res.status(201).json(ok(await inventoryService.transfer(actor(req), req.body, idem(req))));
});
inventoryRouter.post("/inventory/quarantine", can("inventory:quarantine"), async (req, res) => {
  res.status(201).json(ok(await inventoryService.quarantine(actor(req), req.body, false, idem(req))));
});
inventoryRouter.post("/inventory/quarantine/release", can("inventory:quarantine"), async (req, res) => {
  res.status(201).json(ok(await inventoryService.quarantine(actor(req), req.body, true, idem(req))));
});
inventoryRouter.get("/inventory/reservations", can("inventory:read"), async (req, res) => {
  const r = await inventoryService.reservations(tenantId(req), query(req));
  res.json(ok(r.items, r.meta));
});
inventoryRouter.get("/inventory/alerts", can("inventory:read"), async (req, res) => {
  res.json(ok(await inventoryService.alerts(tenantId(req), query(req))));
});
inventoryRouter.get("/inventory/discrepancies", can("inventory:read"), async (req, res) => {
  const r = await inventoryService.discrepancies(tenantId(req), query(req));
  res.json(ok(r.items, r.meta));
});
inventoryRouter.patch("/inventory/discrepancies/:id", can("inventory:adjust"), async (req, res) => {
  res.json(ok(await inventoryService.updateDiscrepancy(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.post("/inventory/reconcile", can("inventory:adjust"), async (req, res) => {
  res.json(ok(await inventoryService.reconcile(actor(req))));
});

// Shipments
inventoryRouter.get("/shipments", can("inventory:read"), async (req, res) => {
  const r = await shipmentService.list(tenantId(req), query(req));
  res.json(ok(r.items, r.meta));
});
inventoryRouter.post("/shipments", can("shipments:manage"), async (req, res) => {
  res.status(201).json(ok(await shipmentService.create(actor(req), req.body)));
});
inventoryRouter.get("/shipments/:id", can("inventory:read"), async (req, res) => {
  res.json(ok(await shipmentService.get(tenantId(req), param(req, "id"))));
});
inventoryRouter.post("/shipments/:id/reserve", can("shipments:manage"), async (req, res) => {
  res.json(ok(await shipmentService.reserve(actor(req), param(req, "id"), idem(req))));
});
inventoryRouter.post("/shipments/:id/ready", can("shipments:manage"), async (req, res) => {
  res.json(ok(await shipmentService.markReady(actor(req), param(req, "id"))));
});
inventoryRouter.post("/shipments/:id/dispatch", can("shipments:manage"), async (req, res) => {
  res.json(ok(await shipmentService.dispatch(actor(req), param(req, "id"), idem(req))));
});
inventoryRouter.post("/shipments/:id/cancel", can("shipments:manage"), async (req, res) => {
  res.json(ok(await shipmentService.cancel(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.post("/shipments/:id/receive", can("shipments:receive"), async (req, res) => {
  res.json(ok(await shipmentService.receive(actor(req), param(req, "id"), req.body, idem(req))));
});
inventoryRouter.post("/shipments/:id/reject", can("shipments:receive"), async (req, res) => {
  res.json(ok(await shipmentService.reject(actor(req), param(req, "id"), req.body)));
});
inventoryRouter.post("/shipments/:id/return", can("shipments:manage"), async (req, res) => {
  res.json(ok(await shipmentService.bookReturn(actor(req), param(req, "id"), req.body, idem(req))));
});

// Recall traceability
inventoryRouter.get("/recalls/:id/inventory", can("recalls:read"), async (req, res) => {
  res.json(ok(await inventoryService.recallInventory(tenantId(req), param(req, "id"))));
});
