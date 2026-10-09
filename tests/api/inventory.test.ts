import { beforeAll, describe, expect, it } from "vitest";
import { api, as, createOrg, partner, prisma, publicVerify, register, uid, type Session } from "../helpers.js";

type Ctx = { s: Session; org: string; warehouse: string; main: string; shelf: string };
let brand: Ctx, distributor: Ctx, outsider: Ctx;
let skuId: string, batchId: string, passportId: string;

async function setupOrg(label: string, type: string): Promise<Ctx> {
  const s = await register(label);
  const org = await createOrg(s, label, type);
  const wh = await api().post("/api/v1/warehouses").set(as(s, org)).send({ code: `WH-${uid()}`, name: `${label} DC`, city: "Delhi", country: "IN" });
  expect(wh.status).toBe(201);
  const shelf = await api().post(`/api/v1/warehouses/${wh.body.data.id}/locations`).set(as(s, org)).send({ code: "A-01", zone: "A", shelf: "01" });
  return { s, org, warehouse: wh.body.data.id, main: wh.body.data.locations[0].id, shelf: shelf.body.data.id };
}

const move = (c: Ctx, body: Record<string, unknown>, key?: string) => {
  const r = api().post("/api/v1/inventory/movements").set(as(c.s, c.org));
  if (key) r.set("Idempotency-Key", key);
  return r.send(body);
};

async function balance(c: Ctx, locationId: string, batch = batchId) {
  const res = await api().get("/api/v1/inventory/balances").query({ locationId, batchId: batch, includeEmpty: "true" }).set(as(c.s, c.org));
  return res.body.data[0] as { id: string; onHand: string; reserved: string; available: string; quarantined: string; damaged: string } | undefined;
}

async function newBatch(code = `LOT-${uid()}`) {
  const b = await api().post("/api/v1/batches").set(as(brand.s, brand.org)).send({ batchCode: code, expiryDate: "2027-12-31" });
  await api().patch(`/api/v1/batches/${b.body.data.id}`).set(as(brand.s, brand.org)).send({ skuId });
  return b.body.data.id as string;
}

async function shipment(from: Ctx, to: Ctx, qty: number | string, opts: Record<string, unknown> = {}, batch = batchId) {
  const res = await api()
    .post("/api/v1/shipments")
    .set(as(from.s, from.org))
    .send({ receiverOrganizationId: to.org, originWarehouseId: from.warehouse, items: [{ skuId, batchId: batch, fromLocationId: from.main, quantity: qty }], ...opts });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data as { id: string; items: Array<{ id: string }> };
}

beforeAll(async () => {
  brand = await setupOrg("brand", "MANUFACTURER");
  distributor = await setupOrg("distributor", "DISTRIBUTOR");
  outsider = await setupOrg("outsider", "RETAILER");
  await partner(brand.s, brand.org, distributor.s, distributor.org, "DISTRIBUTOR");

  const sku = await api().post("/api/v1/catalogue/skus").set(as(brand.s, brand.org)).send({ sku: `VAX-${uid()}`, name: "Influenza vaccine 0.5ml", unitOfMeasure: "DOSE", category: "Vaccine" });
  expect(sku.status).toBe(201);
  skuId = sku.body.data.id;
  batchId = await newBatch();
  const passport = await api().post(`/api/v1/batches/${batchId}/passport`).set(as(brand.s, brand.org)).send({ originCountry: "IN", originLocation: "Delhi, India" });
  expect(passport.status, JSON.stringify(passport.body)).toBe(201);
  passportId = passport.body.data.product.id;

  const opening = await move(brand, { type: "RECEIPT", skuId, batchId, locationId: brand.main, quantity: 1000 });
  expect(opening.status, JSON.stringify(opening.body)).toBe(201);
});

describe("inventory basics", () => {
  it("records receipts in the ledger and keeps balances consistent", async () => {
    const b = await balance(brand, brand.main);
    expect(b).toMatchObject({ onHand: "1000", reserved: "0", available: "1000" });
    const tx = await api().get("/api/v1/inventory/transactions").query({ batchId }).set(as(brand.s, brand.org));
    expect(tx.body.data[0]).toMatchObject({ type: "RECEIPT", quantity: "1000", actorName: "Test brand" });
  });

  it("validates quantities against the unit of measure", async () => {
    const res = await move(brand, { type: "RECEIPT", skuId, batchId, locationId: brand.main, quantity: 1.5 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("INVALID_QUANTITY");
    expect((await move(brand, { type: "RECEIPT", skuId, batchId, locationId: brand.main, quantity: -3 })).status).toBe(422);
  });

  it("moves stock between internal locations without changing the total", async () => {
    const res = await api().post("/api/v1/inventory/transfers").set(as(brand.s, brand.org)).send({ skuId, batchId, fromLocationId: brand.main, toLocationId: brand.shelf, quantity: 100 });
    expect(res.status).toBe(201);
    expect((await balance(brand, brand.main))!.onHand).toBe("900");
    expect((await balance(brand, brand.shelf))!.onHand).toBe("100");
    const back = await api().post("/api/v1/inventory/transfers").set(as(brand.s, brand.org)).send({ skuId, batchId, fromLocationId: brand.shelf, toLocationId: brand.main, quantity: 100 });
    expect(back.status).toBe(201);
  });

  it("records damage, returns and audited adjustments; only owners/admins may adjust", async () => {
    expect((await move(brand, { type: "DAMAGE", skuId, batchId, locationId: brand.main, quantity: 5, reason: "Crushed carton" })).status).toBe(201);
    expect((await move(brand, { type: "CUSTOMER_RETURN", skuId, batchId, locationId: brand.main, quantity: 2, reason: "Unopened return", bucket: "QUARANTINED" })).status).toBe(201);
    const noReason = await move(brand, { type: "STOCK_ADJUSTMENT", skuId, batchId, locationId: brand.main, quantity: 1, direction: "DECREASE" });
    expect(noReason.body.error.code).toBe("REASON_REQUIRED");
    const adj = await move(brand, { type: "STOCK_ADJUSTMENT", skuId, batchId, locationId: brand.main, quantity: 1, direction: "DECREASE", reason: "Cycle count correction" });
    expect(adj.status).toBe(201);
    const b = await balance(brand, brand.main);
    expect(b).toMatchObject({ onHand: "994", damaged: "5", quarantined: "2" });
    const flagged = await api().get("/api/v1/inventory/discrepancies").query({ type: "STOCK_LOSS" }).set(as(brand.s, brand.org));
    expect(flagged.body.data.length).toBeGreaterThan(0);

    // An operator may receive but not adjust.
    const op = await register("operator");
    const invite = await api().post("/api/v1/organizations/current/invitations").set(as(brand.s, brand.org)).send({ email: op.email, role: "ORG_OPERATOR" });
    await api().post("/api/v1/organizations/invitations/accept").set(as(op)).send({ token: invite.body.data.acceptToken });
    const opMove = await api().post("/api/v1/inventory/movements").set(as(op, brand.org)).send({ type: "STOCK_ADJUSTMENT", skuId, batchId, locationId: brand.main, quantity: 50, direction: "INCREASE", reason: "trying" });
    expect(opMove.status).toBe(403);
    const opReceipt = await api().post("/api/v1/inventory/movements").set(as(op, brand.org)).send({ type: "DAMAGE", skuId, batchId, locationId: brand.main, quantity: 1, reason: "Dropped" });
    expect(opReceipt.status).toBe(201);
  });

  it("ledger entries reconcile exactly with cached balances", async () => {
    const res = await api().post("/api/v1/inventory/reconcile").set(as(brand.s, brand.org));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ consistent: true });
    expect(res.body.data.balancesChecked).toBeGreaterThan(0);
  });

  it("the ledger is append-only at the database level", async () => {
    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { organizationId: brand.org } });
    await expect(prisma.inventoryTransaction.update({ where: { id: tx.id }, data: { reason: "edited" } })).rejects.toThrow(/ORIGINX_APPEND_ONLY/);
    await expect(prisma.inventoryTransaction.delete({ where: { id: tx.id } })).rejects.toThrow(/ORIGINX_APPEND_ONLY/);
    const bal = await prisma.inventoryBalance.findFirstOrThrow({ where: { organizationId: brand.org } });
    await expect(prisma.inventoryBalance.update({ where: { id: bal.id }, data: { onHand: -5 } })).rejects.toThrow();
  });
});

describe("quantity integrity", () => {
  it("prevents reserving or dispatching beyond available stock", async () => {
    const b = await balance(brand, brand.main);
    const tooMuch = Number(b!.available) + 1;
    const s = await shipment(brand, distributor, tooMuch);
    const reserve = await api().post(`/api/v1/shipments/${s.id}/reserve`).set(as(brand.s, brand.org));
    expect(reserve.status).toBe(409);
    expect(reserve.body.error.code).toBe("INSUFFICIENT_STOCK");
    const dispatch = await api().post(`/api/v1/shipments/${s.id}/dispatch`).set(as(brand.s, brand.org));
    expect(dispatch.status).toBe(409);
    expect((await balance(brand, brand.main))!.reserved).toBe("0");
    await api().post(`/api/v1/shipments/${s.id}/cancel`).set(as(brand.s, brand.org)).send({ reason: "Too large" });
  });

  it("concurrent dispatches cannot overspend stock", async () => {
    const lot = await newBatch();
    await move(brand, { type: "RECEIPT", skuId, batchId: lot, locationId: brand.main, quantity: 10 });
    const a = await shipment(brand, distributor, 7, {}, lot);
    const b = await shipment(brand, distributor, 7, {}, lot);
    const results = await Promise.all([a, b].map((s) => api().post(`/api/v1/shipments/${s.id}/dispatch`).set(as(brand.s, brand.org))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect((await balance(brand, brand.main, lot))).toMatchObject({ onHand: "3", reserved: "0" });
  });

  it("duplicate dispatch requests are idempotent and never double-ship", async () => {
    const s = await shipment(brand, distributor, 10);
    const key = `dispatch-${uid()}-${uid()}`;
    const before = Number((await balance(brand, brand.main))!.onHand);
    const [r1, r2] = await Promise.all([1, 2].map(() => api().post(`/api/v1/shipments/${s.id}/dispatch`).set(as(brand.s, brand.org)).set("Idempotency-Key", key)));
    expect([r1.status, r2.status].every((c) => c === 200 || c === 409)).toBe(true);
    const replay = await api().post(`/api/v1/shipments/${s.id}/dispatch`).set(as(brand.s, brand.org)).set("Idempotency-Key", key);
    expect(replay.status).toBe(200);
    expect(replay.body.data.idempotentReplay).toBe(true);
    const again = await api().post(`/api/v1/shipments/${s.id}/dispatch`).set(as(brand.s, brand.org));
    expect(again.status).toBe(409);
    expect(Number((await balance(brand, brand.main))!.onHand)).toBe(before - 10);
    // Clean up: receive it so later assertions are deterministic.
    await api().post(`/api/v1/shipments/${s.id}/receive`).set(as(distributor.s, distributor.org)).send({ locationId: distributor.main, items: [{ itemId: s.items[0].id, receivedQty: 10 }] });
  });
});

describe("shipments, partial receipt and custody", () => {
  let shipmentId: string;
  let itemId: string;

  it("dispatches a shipment: reserves, moves stock, records provenance and opens a custody request", async () => {
    const s = await shipment(brand, distributor, 300, { transferCustody: true, notes: "Cold chain" });
    shipmentId = s.id;
    itemId = s.items[0].id;
    const reserve = await api().post(`/api/v1/shipments/${s.id}/reserve`).set(as(brand.s, brand.org));
    expect(reserve.body.data.status).toBe("RESERVED");
    const before = await balance(brand, brand.main);
    expect(Number(before!.reserved)).toBe(300);

    const dispatch = await api().post(`/api/v1/shipments/${s.id}/dispatch`).set(as(brand.s, brand.org));
    expect(dispatch.status, JSON.stringify(dispatch.body)).toBe(200);
    expect(dispatch.body.data).toMatchObject({ status: "DISPATCHED", provenanceEvents: 1 });
    expect(dispatch.body.data.custodyRequests).toHaveLength(1);
    const after = await balance(brand, brand.main);
    expect(Number(after!.onHand)).toBe(Number(before!.onHand) - 300);
    expect(after!.reserved).toBe("0");

    // Custody is requested, NOT accepted, by dispatching.
    const custody = await prisma.custodyTransfer.findFirstOrThrow({ where: { shipmentId: s.id } });
    expect(custody.status).toBe("TRANSFER_REQUESTED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: passportId } })).currentOwnerOrganizationId).toBe(brand.org);
  });

  it("an outsider cannot see, receive or dispatch it", async () => {
    expect((await api().get(`/api/v1/shipments/${shipmentId}`).set(as(outsider.s, outsider.org))).status).toBe(404);
    expect((await api().post(`/api/v1/shipments/${shipmentId}/receive`).set(as(outsider.s, outsider.org)).send({ locationId: outsider.main, items: [{ itemId, receivedQty: 1 }] })).status).toBe(404);
    expect((await api().get("/api/v1/inventory/balances").query({ batchId }).set(as(outsider.s, outsider.org))).body.data).toHaveLength(0);
  });

  it("supports partial receipt with damaged and missing quantities", async () => {
    const base = await balance(distributor, distributor.main);
    const baseOnHand = Number(base?.onHand ?? 0);
    const baseDamaged = Number(base?.damaged ?? 0);
    const tooMuch = await api().post(`/api/v1/shipments/${shipmentId}/receive`).set(as(distributor.s, distributor.org)).send({ locationId: distributor.main, items: [{ itemId, receivedQty: 301 }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("RECEIPT_EXCEEDS_OUTSTANDING");

    const key = `receive-${uid()}-${uid()}`;
    const part = await api().post(`/api/v1/shipments/${shipmentId}/receive`).set(as(distributor.s, distributor.org)).set("Idempotency-Key", key).send({ locationId: distributor.main, items: [{ itemId, receivedQty: 200, damagedQty: 5 }], acceptCustody: true });
    expect(part.status).toBe(200);
    expect(part.body.data.status).toBe("PARTIALLY_RECEIVED");
    expect(part.body.data.items[0]).toMatchObject({ receivedQty: "200", damagedQty: "5", outstandingQty: "95" });
    expect(part.body.data.custody.acceptedNow).toBe(0);
    // Duplicate submission with the same key does not receive twice.
    const dup = await api().post(`/api/v1/shipments/${shipmentId}/receive`).set(as(distributor.s, distributor.org)).set("Idempotency-Key", key).send({ locationId: distributor.main, items: [{ itemId, receivedQty: 200, damagedQty: 5 }] });
    expect(dup.body.data.idempotentReplay).toBe(true);
    expect(await balance(distributor, distributor.main)).toMatchObject({ onHand: String(baseOnHand + 200), damaged: String(baseDamaged + 5) });
    expect((await prisma.custodyTransfer.findFirstOrThrow({ where: { shipmentId } })).status).toBe("TRANSFER_REQUESTED");

    const rest = await api().post(`/api/v1/shipments/${shipmentId}/receive`).set(as(distributor.s, distributor.org)).send({ locationId: distributor.main, items: [{ itemId, receivedQty: 90, missingQty: 5 }], acceptCustody: true });
    expect(rest.body.data).toMatchObject({ status: "RECEIVED", hasDiscrepancy: true });
    expect(rest.body.data.custody.acceptedNow).toBe(1);
    expect(await balance(distributor, distributor.main)).toMatchObject({ onHand: String(baseOnHand + 290), damaged: String(baseDamaged + 5) });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: passportId } })).currentOwnerOrganizationId).toBe(distributor.org);
    const shortages = await api().get("/api/v1/inventory/discrepancies").query({ type: "SHIPMENT_SHORTAGE" }).set(as(brand.s, brand.org));
    expect(shortages.body.data.length).toBeGreaterThan(0);
  });

  it("links dispatch and receipt events into a still-valid hash chain without duplicates", async () => {
    const events = await prisma.productEvent.findMany({ where: { productId: passportId }, orderBy: { sequence: "asc" } });
    const forShipment = events.filter((e) => e.metadataJson.includes(shipmentId));
    expect(forShipment.map((e) => e.eventType)).toEqual(["DISPATCHED", "RECEIVED", "RECEIVED"]);
    expect(events.filter((e) => e.eventType === "CUSTODY_TRANSFERRED")).toHaveLength(1);
    const history = await api().post(`/api/v1/products/${passportId}/verify-history`).set(as(brand.s, brand.org));
    expect(history.body.data.historyValid).toBe(true);
    expect(history.body.data.blockchainVerification.status).toBe("VERIFIED");
    // Custody analysis accepts shipment-backed quantity events.
    const trust = await api().get(`/api/v1/products/${passportId}/trust-score`).set(as(brand.s, brand.org));
    expect(trust.body.data.custody.consistent).toBe(true);
  });

  it("the receiver can reject a dispatched shipment and the sender books the stock back", async () => {
    const s = await shipment(brand, distributor, 20);
    await api().post(`/api/v1/shipments/${s.id}/dispatch`).set(as(brand.s, brand.org));
    const rejected = await api().post(`/api/v1/shipments/${s.id}/reject`).set(as(distributor.s, distributor.org)).send({ reason: "Not ordered" });
    expect(rejected.body.data.status).toBe("REJECTED");
    const before = Number((await balance(brand, brand.main))!.onHand);
    const back = await api().post(`/api/v1/shipments/${s.id}/return`).set(as(brand.s, brand.org)).send({ locationId: brand.main });
    expect(back.body.data.status).toBe("RETURNED");
    expect(Number((await balance(brand, brand.main))!.onHand)).toBe(before + 20);
  });

  it("cancelling before dispatch releases reservations", async () => {
    const s = await shipment(brand, distributor, 15);
    await api().post(`/api/v1/shipments/${s.id}/reserve`).set(as(brand.s, brand.org));
    const cancel = await api().post(`/api/v1/shipments/${s.id}/cancel`).set(as(brand.s, brand.org)).send({ reason: "Order withdrawn" });
    expect(cancel.body.data.status).toBe("CANCELLED");
    expect((await balance(brand, brand.main))!.reserved).toBe("0");
  });

  it("shipments require an accepted partnership", async () => {
    const res = await api().post("/api/v1/shipments").set(as(brand.s, brand.org)).send({ receiverOrganizationId: outsider.org, originWarehouseId: brand.warehouse, items: [{ skuId, batchId, fromLocationId: brand.main, quantity: 1 }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_A_PARTNER");
  });
});

describe("tenant isolation", () => {
  it("Organization A cannot inspect or move Organization B's inventory", async () => {
    const bal = await balance(brand, brand.main);
    expect((await api().get(`/api/v1/warehouses/${brand.warehouse}`).set(as(outsider.s, outsider.org))).status).toBe(404);
    const steal = await api().post("/api/v1/inventory/transfers").set(as(outsider.s, outsider.org)).send({ skuId, batchId, fromLocationId: brand.main, toLocationId: outsider.main, quantity: 1 });
    expect([403, 404]).toContain(steal.status);
    const quarantine = await api().post("/api/v1/inventory/quarantine").set(as(outsider.s, outsider.org)).send({ balanceId: bal!.id, quantity: 1, reason: "hostile" });
    expect(quarantine.status).toBe(404);
    const receipt = await move(outsider, { type: "RECEIPT", skuId, batchId, locationId: outsider.main, quantity: 5 });
    expect(receipt.status).toBe(404);
    const foreignLocation = await move(brand, { type: "RECEIPT", skuId, batchId, locationId: outsider.main, quantity: 5 });
    expect(foreignLocation.status).toBe(404);
  });
});

describe("recall and quarantine", () => {
  it("a recall quarantines recorded stock at every holder, blocks dispatch and stays private on public verification", async () => {
    const recall = await api().post("/api/v1/recalls").set(as(brand.s, brand.org)).send({ batchId, reason: "Sterility deviation in lot", initiate: true });
    expect(recall.status, JSON.stringify(recall.body)).toBe(201);

    const brandBal = await balance(brand, brand.main);
    const distBal = await balance(distributor, distributor.main);
    expect(brandBal).toMatchObject({ onHand: "0", available: "0" });
    expect(Number(brandBal!.quarantined)).toBeGreaterThan(0);
    expect(distBal).toMatchObject({ onHand: "0" });
    expect(Number(distBal!.quarantined)).toBeGreaterThanOrEqual(290);
    const distHeld = distBal!.quarantined;

    const blocked = await api().post("/api/v1/shipments").set(as(distributor.s, distributor.org)).send({ receiverOrganizationId: brand.org, originWarehouseId: distributor.warehouse, items: [{ skuId, batchId, fromLocationId: distributor.main, quantity: 1 }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("BATCH_ON_HOLD");
    const release = await api().post("/api/v1/inventory/quarantine/release").set(as(distributor.s, distributor.org)).send({ balanceId: distBal!.id, quantity: 1, reason: "Try release" });
    expect(release.body.error.code).toBe("BATCH_ON_HOLD");

    const trace = await api().get(`/api/v1/recalls/${recall.body.data.id}/inventory`).set(as(brand.s, brand.org));
    const holders = trace.body.data.batches[0].holders.map((h: { organizationId: string }) => h.organizationId);
    expect(holders).toEqual(expect.arrayContaining([brand.org, distributor.org]));
    expect(trace.body.data.batches[0].note).toMatch(/recorded/);

    // Recall return shipment to the brand moves quarantined stock and is recorded on the passport.
    const ret = await api().post("/api/v1/shipments").set(as(distributor.s, distributor.org)).send({ receiverOrganizationId: brand.org, originWarehouseId: distributor.warehouse, purpose: "RECALL_RETURN", recallId: recall.body.data.id, items: [{ skuId, batchId, fromLocationId: distributor.main, quantity: distHeld }] });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect((await api().post(`/api/v1/shipments/${ret.body.data.id}/dispatch`).set(as(distributor.s, distributor.org))).status).toBe(200);
    const got = await api().post(`/api/v1/shipments/${ret.body.data.id}/receive`).set(as(brand.s, brand.org)).send({ locationId: brand.shelf, items: [{ itemId: ret.body.data.items[0].id, receivedQty: distHeld }] });
    expect(got.body.data.status).toBe("RECEIVED");
    expect(await balance(brand, brand.shelf)).toMatchObject({ onHand: "0", quarantined: distHeld });

    const pub = await publicVerify((await prisma.product.findUniqueOrThrow({ where: { id: passportId } })).publicVerificationToken, "203.0.113.77");
    expect(pub.body.data.state).toBe("RECALLED");
    const body = JSON.stringify(pub.body);
    for (const secret of ["onHand", "quarantined", "reserved", "available", brand.warehouse, "A-01", shipmentLeak()]) expect(body).not.toContain(secret);

    const reconcile = await api().post("/api/v1/inventory/reconcile").set(as(distributor.s, distributor.org));
    expect(reconcile.body.data.consistent).toBe(true);
  });
});

function shipmentLeak() {
  return "SHP-";
}

describe("blockchain outage safety", () => {
  it("stock operations still commit when anchoring fails, and no proof is faked", async () => {
    const lot = await newBatch();
    await api().post(`/api/v1/batches/${lot}/passport`).set(as(brand.s, brand.org)).send({});
    await move(brand, { type: "RECEIPT", skuId, batchId: lot, locationId: brand.main, quantity: 50 });
    const { blockchainService } = await import("../../src/services/blockchain.service.js");
    const original = blockchainService.anchorEventProof.bind(blockchainService);
    blockchainService.anchorEventProof = async () => {
      throw new Error("RPC down");
    };
    try {
      const s = await shipment(brand, distributor, 10, {}, lot);
      const res = await api().post(`/api/v1/shipments/${s.id}/dispatch`).set(as(brand.s, brand.org));
      // The dispatch is committed and reported as successful even though anchoring threw.
      expect(res.status).toBe(200);
      const stored = await prisma.shipment.findUniqueOrThrow({ where: { id: s.id } });
      expect(stored.status).toBe("DISPATCHED");
      expect((await balance(brand, brand.main, lot))!.onHand).toBe("40");
      const fakeProofs = await prisma.blockchainProof.count({ where: { status: "CONFIRMED", transactionHash: null } });
      expect(fakeProofs).toBe(0);
    } finally {
      blockchainService.anchorEventProof = original;
    }
  });
});
