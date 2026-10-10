# Inventory Management Layer

The inventory layer adds **quantity custody** to ORIGINX: who holds how much of which SKU and batch, where it sits, and how it moved between organizations. It runs beside the existing passport / custody / hash-chain system and reuses it. It does not replace any of it.

The design rationale and audit are in [INVENTORY_INTEGRATION_PLAN.md](INVENTORY_INTEGRATION_PLAN.md). This document is the reference for what is built.

- Code: `src/services/inventory/`, `src/routes/inventory.routes.ts`, `web/src/app/inventory/`.
- Migration: `prisma/migrations/20261010000000_inventory_layer`.

## 1. Concepts

| Concept | Model | Notes |
|---|---|---|
| SKU (catalogue item) | `ProductSku` | Owned by the brand organization; `sku` is unique per organization. A SKU is a *kind* of product, never a unique item. Optional `ReorderRule` sets a low-stock threshold (no default threshold is ever invented). |
| Batch | `ProductBatch` (extended) | Adds `skuId`, `unitOfMeasure`, `plannedQuantity`, `qualityStatus` (PENDING / APPROVED / REJECTED), `holdStatus` (NONE / QUARANTINED / RECALLED) and `passportProductId`. |
| Batch passport | `Product` with `passportType = BATCH` | Created by `POST /batches/:id/passport` through the normal `productService.create`. It gets the normal on-chain identity, QR code and hash chain. Identity is `canonicalIdentityHash(sku, "batch:<batchCode>")`. |
| Unit passport | `Product` with `passportType = UNIT` (default) | Unchanged existing behaviour. Can link to a SKU through `skuId`. |
| Warehouse / location | `Warehouse`, `StorageLocation` | Code is unique per organization or per warehouse. Every new warehouse gets a `MAIN` location automatically. |
| Balance | `InventoryBalance` | Keyed by (organization, location, SKU, batchKey). Holds `onHand`, `reserved`, `quarantined` and `damaged` as `Decimal(18,4)`. **A cache**: the ledger is the truth. |
| Transaction + ledger entries | `InventoryTransaction`, `InventoryLedgerEntry` | Each business action is one transaction header plus signed per-bucket deltas. Both tables are append-only at the database level. |
| Reservation | `InventoryReservation` | ACTIVE → RELEASED / CONSUMED. Always tied to a shipment item. |
| Shipment | `Shipment`, `ShipmentItem` | Moves stock between two ORIGINX organizations that have an accepted partnership. |
| Discrepancy | `InventoryDiscrepancy` | OPEN → ACKNOWLEDGED / RESOLVED. Deduplicated by `fingerprint`. |
| Idempotency | `IdempotencyRecord` | (organization, key) → stored first response. |

**Quantities.**
- `available = onHand − reserved`.
- Quarantined and damaged stock is never available.
- Quantities are validated to at most 4 decimal places, and to whole numbers for non-fractional units (PCS, BOX, CARTON, PALLET, PACK, DOSE, …).
- All arithmetic uses Prisma `Decimal`; floats are never used.

## 2. Ledger semantics

| Transaction type | Bucket deltas |
|---|---|
| `OPENING_BALANCE`, `RECEIPT`, `CUSTOMER_RETURN` | +onHand |
| `DISPATCH` (external, no shipment), `SUPPLIER_RETURN` | −onHand |
| `TRANSFER_OUT` / `TRANSFER_IN` (internal move) | −onHand at the source, +onHand at the destination, in one DB transaction |
| `RESERVATION` / `RESERVATION_RELEASE` | ±reserved |
| Shipment dispatch (`DISPATCH` with a `shipmentId`) | −reserved and −onHand at the sender |
| Shipment receipt (`RECEIPT` with a `shipmentId`) | +onHand (received) and +damaged (damaged) at the receiver. The missing quantity is recorded on the item; no stock is created for it |
| `DAMAGE` | onHand → damaged |
| `LOSS` | −onHand or −damaged |
| `STOCK_ADJUSTMENT` | ±any bucket; reason mandatory; OWNER / ADMIN only |
| `QUARANTINE` / `QUARANTINE_RELEASE` | onHand ↔ quarantined |
| `RECALL_ALLOCATION` | onHand → quarantined at every holder of the batch; active reservations released |
| `RECALL_RETURN` | Quarantined stock returned to the brand on a `RECALL_RETURN` shipment |

Every write runs in one PostgreSQL transaction:
1. The affected balances are created if missing (`INSERT … ON CONFLICT DO NOTHING`), then row-locked with `SELECT … FOR UPDATE`.
2. The invariants are checked on the locked rows: no bucket below zero, and `reserved ≤ onHand`.
3. Held batches cannot be reserved or dispatched on ordinary shipments. This applies when `holdStatus` is not NONE (`BATCH_ON_HOLD`) or quality is REJECTED (`BATCH_QUALITY_REJECTED`).
4. The transaction header, ledger entries and balance updates are written.
5. Provenance events, if any, are written.
6. The audit log entry is written.

Completed transactions are never edited. A correction is a new, compensating transaction.

**Idempotency.** Every retry-safe write accepts an `Idempotency-Key` header. A replay with the same key returns the stored first response and does not move stock again.

**Reconciliation.** `POST /inventory/reconcile` recomputes every bucket from the ledger and compares it with the cached balances. Mismatches (`LEDGER_MISMATCH`) and negative buckets (`NEGATIVE_BALANCE`) are raised as CRITICAL discrepancies. It reports and flags; it never "repairs" history silently.

## 3. Shipment lifecycle

```
DRAFT ──reserve──> RESERVED ──ready──> READY_TO_DISPATCH ──dispatch──> DISPATCHED ──receive──> PARTIALLY_RECEIVED ──receive──> RECEIVED
  │                   │                     │                              │
  └──cancel──> CANCELLED <──────────────────┘                              └──reject (receiver)──> REJECTED ──return (sender)──> RETURNED
```

- `READY_TO_DISPATCH` is optional. Dispatch reserves automatically if needed.
- Cancelling before dispatch releases the reservations.
- Shipments require an **accepted partnership** between sender and receiver, the same rule as custody transfers. Moves inside one organization use `/inventory/transfers`.
- **Partial receipt.** Each receipt states `received`, `damaged` and `missing` per item. These must not exceed what is still outstanding. The status becomes `RECEIVED` only when nothing is outstanding. Damage and shortages raise `SHIPMENT_DAMAGE` / `SHIPMENT_SHORTAGE` discrepancies.
- **Custody integration.** With `transferCustody: true`, dispatch opens an ordinary `CustodyTransfer` request (linked by `shipmentId`) for each batch passport the sender currently holds. Receipt accepts that custody only if the receiver passes `acceptCustody: true` and the shipment is fully received. Otherwise custody stays pending, so nothing is fabricated.
- **Recall returns.** A shipment with `purpose = RECALL_RETURN` may carry quarantined, recalled stock back to the brand. Ordinary shipments may not.

## 4. Provenance (hash chain + blockchain)

Batches that have a batch passport get hash-chained events. They are written **in the same DB transaction** as the ledger entries (`eventService.insert(tx)`) and anchored on-chain after commit:

| Action | Event | Recorded by |
|---|---|---|
| Shipment dispatch | `DISPATCHED` | sender |
| Shipment receipt | `RECEIVED` (received / damaged / missing) | receiver |
| Batch hold, quarantine or quality change | `STATUS_CHANGED` | batch owner / holder |
| Recall-return receipt | `RECALL_RETURN_RECEIVED` | brand |

- **One event per shipment, per batch passport, per action.** Retries and idempotent replays never duplicate events.
- **Anchoring failure never rolls back stock.** The proof stays `PENDING` and the background worker (or `npm run anchor:pending`) retries it. No transaction hash is ever invented.
- **Trust engine.** `analyzeCustody` accepts shipment-backed quantity events only when the actor matches the shipment's sender or receiver.
- **Public verification.** It shows the batch's lifecycle events but never warehouse names, stock levels or partner quantities. `publicPlace` reduces locations to city or country.
- Batches without a passport keep the ledger and audit trail only.

## 5. Recalls

When a recall targets a batch (or the batch of a recalled passport), `recallService` calls `inventoryService.allocateRecall`:
- **Quarantine.** Recorded on-hand stock at **every** holder organization is moved to quarantined (`RECALL_ALLOCATION`).
- **Reservations.** Active reservations are released.
- **Dispatch block.** Further ordinary dispatch is blocked.

Cancelling the recall lifts the hold (`liftRecallHold`). Stock stays quarantined until it is explicitly released, which is a deliberate, conservative choice.

`GET /recalls/:id/inventory` reports where recalled stock is, per holder:
- on hand, quarantined and damaged;
- in transit;
- returned to the brand;
- quantities that left the recorded network.

The report states plainly that stock never recorded in ORIGINX cannot be located.

## 6. Alerts

`GET /inventory/alerts?expiringWithinDays=30&unconfirmedAfterDays=3` returns:
- **Low stock:** only for SKUs with a user-configured reorder threshold.
- **Expiring / expired:** batches holding stock that expire within the window.
- **Unconfirmed incoming shipments:** dispatched to you more than N days ago and not yet received.
- **Held / quarantined stock.**
- **Open discrepancies.**

## 7. Permissions

| Permission | OWNER | ADMIN | MANAGER | OPERATOR | VIEWER |
|---|:-:|:-:|:-:|:-:|:-:|
| `inventory:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inventory:receive` (receipt, opening balance, customer return, damage) | ✓ | ✓ | ✓ | ✓ | |
| `inventory:move` (internal transfer) | ✓ | ✓ | ✓ | ✓ | |
| `inventory:dispatch` (external dispatch, supplier return) | ✓ | ✓ | ✓ | ✓ | |
| `shipments:receive` | ✓ | ✓ | ✓ | ✓ | |
| `inventory:reserve`, `inventory:quarantine`, `shipments:manage`, `catalogue:manage` | ✓ | ✓ | ✓ | | |
| `inventory:adjust` (adjustments, loss, discrepancies, reconcile), `warehouses:manage` | ✓ | ✓ | | | |

- `POST /inventory/movements` checks the permission for the specific movement type.
- **Platform admins** get read-only, cross-tenant views: `/admin/inventory/overview` and `/admin/inventory/discrepancies`.
- **Tenant isolation.** Every query is scoped to the caller's organization. Foreign IDs return 404.

## 8. Endpoints (`/api/v1`, tenant-scoped: `X-Organization-Id` required)

| Method | Path | Permission |
|---|---|---|
| GET / POST | `/catalogue/skus` | inventory:read / catalogue:manage |
| GET / PATCH | `/catalogue/skus/:id` | inventory:read / catalogue:manage |
| PUT | `/catalogue/skus/:id/reorder-rule` | catalogue:manage `{threshold \| null}` |
| PATCH | `/batches/:id` | catalogue:manage `{skuId?, unitOfMeasure?, plannedQuantity?, qualityStatus?}` |
| POST | `/batches/:id/passport` | products:create — create the batch passport |
| POST | `/batches/:id/hold` | inventory:quarantine `{status: QUARANTINED | NONE, reason, incidentId?}` |
| GET | `/batches/:id/inventory` | inventory:read |
| GET / POST | `/warehouses`; GET / PATCH `/warehouses/:id` | inventory:read / warehouses:manage |
| POST | `/warehouses/:id/locations`; PATCH `/locations/:id` | warehouses:manage |
| GET | `/inventory/summary`, `/inventory/products`, `/inventory/balances`, `/inventory/transactions`, `/inventory/reservations` | inventory:read |
| POST | `/inventory/movements` | per type (see §7) `{type, skuId, batchId?, locationId, quantity, reason?, bucket?, direction?}` |
| POST | `/inventory/transfers` | inventory:move `{skuId, batchId?, fromLocationId, toLocationId, quantity}` |
| POST | `/inventory/quarantine`, `/inventory/quarantine/release` | inventory:quarantine |
| GET | `/inventory/alerts`, `/inventory/discrepancies` | inventory:read |
| PATCH | `/inventory/discrepancies/:id` | inventory:adjust `{status, note?}` |
| POST | `/inventory/reconcile` | inventory:adjust |
| GET / POST | `/shipments`; GET `/shipments/:id` | inventory:read / shipments:manage |
| POST | `/shipments/:id/reserve` · `/ready` · `/dispatch` · `/cancel` · `/return` | shipments:manage |
| POST | `/shipments/:id/receive` | shipments:receive `{locationId, items:[{itemId, receivedQty?, damagedQty?, missingQty?}], notes?, acceptCustody?}` |
| POST | `/shipments/:id/reject` | shipments:receive `{reason}` |
| GET | `/recalls/:id/inventory` | recalls:read |

Errors use the standard envelope. Inventory-specific codes include:
- `INSUFFICIENT_STOCK`, `BATCH_ON_HOLD`, `INVALID_SHIPMENT_STATE`, `RECEIPT_EXCEEDS_OUTSTANDING`, `IDEMPOTENCY_KEY_REUSED`, `REQUEST_IN_PROGRESS` (409);
- `NOT_A_PARTNER` (403);
- `INVALID_QUANTITY` or `VALIDATION_ERROR` (422), for example for fractional quantities on whole-unit SKUs.

## 9. Web app

In the organization panel, under **Inventory**:

| Page | Route | Contents |
|---|---|---|
| Overview | `/app/inventory` | KPIs and alerts |
| Products | `/app/inventory/products` | SKUs; SKU detail with per-location and per-batch balances and the reorder rule |
| Movements | `/app/inventory/movements` | The ledger, plus the record-movement and transfer dialogs |
| Warehouses | `/app/inventory/warehouses` | Warehouses and their locations |
| Shipments | `/app/inventory/shipments` | List, create, detail with the lifecycle actions, partial-receipt form, custody and provenance links |

The **Batches** page also shows SKU, unit, quality, hold and batch-passport actions. Buttons appear only when the user's role grants the permission, mirroring `ORG_PERMISSIONS`.

## 10. Migration

The migration is additive only. It creates tables, adds nullable or defaulted columns, and adds CHECK constraints, append-only triggers, RLS and Supabase revokes. It drops nothing and renames nothing. Existing rows stay valid with the defaults `qualityStatus = PENDING`, `holdStatus = NONE` and `passportType = UNIT`.

```bash
npm run db:migrate          # prisma migrate deploy — applies 20261010000000_inventory_layer
npm run db:seed:inventory   # optional, additive demo inventory on top of the base seed
npm run db:seed:sales-demo  # sample priced sales and warehouse coordinates (development only)
```

**Production.** The API container runs `prisma migrate deploy` on start. Take a Supabase backup first, as for any migration.

## 11. Known limitations

- **No orders, invoicing, pricing or valuation.** Shipments are created directly; this is a stock and custody layer, not an ERP.
- **No barcode or RFID hardware integration**, by design. Stock is recorded by people or by API clients.
- **Unit passports are not counted as stock automatically.** A unit passport and a SKU balance are linked by `skuId`, but receiving stock does not create unit passports. Quantity provenance is tracked at batch level through batch passports.
- **"PENDING" quality allows dispatch.** Only REJECTED blocks dispatch. Tighten this if your QA process requires APPROVED before release.
- **Rate-limit and enumeration counters are in memory, per API instance.** Use Redis before scaling horizontally. Idempotency records are already stored in the database.
- **Recall allocation only covers recorded stock.** Stock held by organizations outside ORIGINX is reported as unknown.

## 12. Testing

`tests/api/inventory.test.ts` runs on real PostgreSQL and a real Hardhat chain. Nothing is mocked. It covers:

- receipts and balance consistency; unit-of-measure validation;
- internal transfers; damage, returns and audited adjustments (RBAC);
- ledger ↔ balance reconciliation; database-level append-only ledger;
- over-reserve and over-dispatch prevention; concurrent dispatch; idempotent dispatch replay;
- the full shipment dispatch with provenance and a custody request; outsider isolation;
- partial receipt with damaged and missing quantities; hash-chain validity without duplicate events;
- reject → return; cancel → reservation release; partnership requirement;
- cross-tenant isolation;
- recall allocation, dispatch blocking and public-verification privacy;
- safety when anchoring fails (stock commits, the proof stays PENDING, nothing is faked).

```bash
npm test                    # full suite (needs Docker Postgres; starts its own chain on :8546)
npx vitest run tests/api/inventory.test.ts
```

## Execution log

| Step | Status |
|---|---|
| Audit of the existing system + integration plan | Done ([INVENTORY_INTEGRATION_PLAN.md](INVENTORY_INTEGRATION_PLAN.md)) |
| Additive migration `20261010000000_inventory_layer` | Written and applied to the local dev database with `prisma migrate deploy`. Not yet applied to Supabase; that happens on deploy |
| Services, routes, permissions, recall and trust-engine hooks | Implemented |
| Provenance events + anchoring after commit | Implemented; anchoring failures leave PENDING proofs |
| Additive inventory seed (`prisma/seed-inventory.ts`) | Implemented; run on the local dev database |
| Organization-panel inventory UI + Batches extensions | Implemented; browser-checked against real data |
| Admin cross-tenant inventory overview / discrepancies | Implemented (API + admin dashboard card) |
| Automated tests | Executed 2026-10-09: full backend suite **82/82 passed** (8 files, 151.7 s), including the 19 inventory tests. Web app: `tsc --noEmit` 0 errors, production build succeeds |
