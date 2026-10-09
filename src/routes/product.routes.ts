import { Router } from "express";
import { ok } from "../lib/errors.js";
import { param, query } from "../lib/http.js";
import { requireAuth } from "../middleware/auth.js";
import { actor, can, requireOrganization, tenantId } from "../middleware/tenant.js";
import { aiExplanationService } from "../services/ai.service.js";
import { blockchainService } from "../services/blockchain.service.js";
import { custodyService } from "../services/custody.service.js";
import { demoService } from "../services/demo.service.js";
import { eventService } from "../services/event.service.js";
import { getReadableProduct } from "../services/product-access.js";
import { productService } from "../services/product.service.js";
import { trustScoreService } from "../services/trust.service.js";
import { verificationService } from "../services/verification.service.js";

/** /products — products, Digital Product Passports, lifecycle events, verification and trust. */
export const productRouter = Router();
productRouter.use(requireAuth, requireOrganization);

productRouter.post("/", can("products:create"), async (req, res) => {
  res.status(201).json(ok(await productService.create(actor(req), req.body)));
});
productRouter.get("/", can("products:read"), async (req, res) => {
  const result = await productService.list(tenantId(req), query(req));
  res.json(ok(result.items, result.meta));
});
productRouter.get("/:productId", can("products:read"), async (req, res) => {
  res.json(ok(await productService.detail(tenantId(req), param(req, "productId"))));
});
productRouter.patch("/:productId", can("products:update"), async (req, res) => {
  res.json(ok(await productService.update(actor(req), param(req, "productId"), req.body)));
});
productRouter.post("/:productId/archive", can("products:archive"), async (req, res) => {
  res.json(ok(await productService.archive(actor(req), param(req, "productId"))));
});

// Digital Product Passport (private, organization view)
productRouter.get("/:productId/passport", can("products:read"), async (req, res) => {
  res.json(ok(await verificationService.privatePassport(tenantId(req), param(req, "productId"))));
});
productRouter.get("/:productId/qr", can("products:read"), async (req, res) => {
  res.json(ok(await productService.qr(tenantId(req), param(req, "productId"))));
});

// Lifecycle events (hash chain)
productRouter.get("/:productId/events", can("products:read"), async (req, res) => {
  res.json(ok(await eventService.list(tenantId(req), param(req, "productId"))));
});
productRouter.post("/:productId/events", can("events:create"), async (req, res) => {
  res.status(201).json(ok(await eventService.createFromRequest(actor(req), param(req, "productId"), req.body)));
});

// Verification & trust
productRouter.post("/:productId/verify-history", can("products:read"), async (req, res) => {
  await getReadableProduct(tenantId(req), param(req, "productId"));
  const { history, trust } = await verificationService.assess(param(req, "productId"));
  res.json(ok({ ...history, trust: { score: trust.score, level: trust.level } }));
});
productRouter.get("/:productId/trust-score", can("products:read"), async (req, res) => {
  await getReadableProduct(tenantId(req), param(req, "productId"));
  res.json(ok(await trustScoreService.calculate(param(req, "productId"))));
});
productRouter.get("/:productId/trust-score/history", can("products:read"), async (req, res) => {
  await getReadableProduct(tenantId(req), param(req, "productId"));
  res.json(ok(await trustScoreService.history(param(req, "productId"))));
});
productRouter.get("/:productId/blockchain/proofs", can("products:read"), async (req, res) => {
  await getReadableProduct(tenantId(req), param(req, "productId"));
  const proofs = await blockchainService.getProductProofs(param(req, "productId"));
  res.json(ok(proofs.map((p) => ({ ...p, explorerUrl: blockchainService.explorerUrl(p.transactionHash) }))));
});
productRouter.get("/:productId/blockchain/proofs/:proofId/verify", can("products:read"), async (req, res) => {
  await getReadableProduct(tenantId(req), param(req, "productId"));
  const proof = (await blockchainService.getProductProofs(param(req, "productId"))).find((p) => p.id === param(req, "proofId"));
  res.json(ok(proof ? await blockchainService.verifyProof(proof.id) : { valid: false, result: "PROOF_NOT_FOUND" }));
});
productRouter.get("/:productId/verifications", can("products:read"), async (req, res) => {
  const result = await verificationService.productVerificationLogs(tenantId(req), param(req, "productId"), query(req));
  res.json(ok(result.items, result.meta));
});
productRouter.get("/:productId/custody-transfers", can("products:read"), async (req, res) => {
  await getReadableProduct(tenantId(req), param(req, "productId"));
  res.json(ok(await custodyService.list(tenantId(req), { ...query(req), productId: param(req, "productId") })));
});

// ASK ORIGINX
productRouter.post("/:productId/ask", can("products:read"), async (req, res) => {
  await getReadableProduct(tenantId(req), param(req, "productId"));
  res.json(ok(await aiExplanationService.ask(param(req, "productId"), req.body)));
});

// DEMO ONLY (404 unless DEMO_MODE=true)
productRouter.post("/:productId/demo/tamper", can("demo:tamper"), async (req, res) => {
  res.json(ok(await demoService.tamper(actor(req), param(req, "productId"), req.body)));
});
