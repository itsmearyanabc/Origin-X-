# Inventory Management Layer — Integration Plan

Status: **implemented** (see "Execution log" at the end). This plan was written after auditing the repository and before code changes.

## 1. Audit findings

| Area | Existing implementation | Relevance |
|---|---|---|
| Stack | Node 22 + TypeScript + Express 5 modular monolith; Prisma 6 + PostgreSQL (Supabase in prod); Vitest + Supertest on real Postgres + Hardhat; React 19 + Vite + Tailwind 4 web app in `web/` | Reused as-is |
| Auth / RBAC | JWT access + httpOnly rotating refresh cookie; `requireOrganization` (membership-proven tenant), `can(permission)` with `ORG_PERMISSIONS`; `requireAdmin` | Extended with inventory permissions |
| Tenancy | `organizationId` on tenant tables, `readableProductWhere` scope, 404 for foreign ids | Same patterns for new tables |
| Product | **Each `Product` row is a Digital Product Passport** (identity = productCode + serial). There is **no SKU catalogue and no quantity** anywhere | SKU catalogue genuinely missing → new `ProductSku`; passports link to it |
| Batch | `ProductBatch` (org, batchCode unique per org, dates) | Extended (SKU, unit, quality, hold status, batch passport link) |
| Custody | `CustodyTransfer` two-party state machine on a **whole passport** (`currentOwnerOrganizationId`) | Preserved. Quantity flows of a batch split across many holders, which whole-passport custody cannot express → inventory ledger becomes the record of *quantity custody*; whole-passport custody stays explicit and optional per shipment |
| Events / hash chain | `eventService.insert(tx)` + `afterCommit` anchoring; canonical JSON SHA-256; trust engine `analyzeCustody` | Reused; new system event types `DISPATCHED`, `RECALL_RETURN_RECEIVED`; custody analysis taught about shipment-backed quantity events |
| Blockchain | `BlockchainService` (PENDING when unavailable, never faked) | Reused unchanged |
| Recall / incident | `recallService.applyRecall/revertRecall`, `incidentService.ensureSystemIncident` | Hooked to allocate/release recalled stock |
| Audit | Append-only `AuditLog` (DB triggers) | All inventory actions audited |
| Shipments / orders / warehouses | **None exist** (only `SHIPMENT_CREATED` event type) | New `Shipment`, `ShipmentItem`, `Warehouse`, `StorageLocation`; no order system is introduced |
| Frontend | Org panel shell + dashboard, products, passport, custody, partners, incidents, recalls done; Verification/Batches/Team/Settings/Audit and the admin panel are placeholders | Inventory screens added to the existing shell & design system; placeholders completed |

## 2. Mapping requirements → model

| Requirement | Decision |
|---|---|
| Product catalogue (SKU, brand, unit of measure, status) | New `ProductSku` (owned by brand org, `@@unique([organizationId, sku])`). `Product.skuId` optional link (passport → catalogue). A SKU is never a unique instance |
| Batch (quantity, unit, quality, hold, passport) | Additive columns on `ProductBatch`: `skuId`, `unitOfMeasure`, `plannedQuantity`, `qualityStatus`, `holdStatus`, `passportProductId` (unique) |
| Batch passport | Optional; created through the existing `productService.create` with a batch-scoped identity (`productCode` = SKU, identity serial = `batch:<code>`), so it gets the normal on-chain identity, QR and hash chain |
| Warehouses / locations | New `Warehouse` (org, code unique per org), `StorageLocation` (warehouse, code unique per warehouse; default `MAIN` auto-created) |
| Balances | New `InventoryBalance` keyed by (org, location, SKU, batchKey) with buckets `onHand`, `reserved`, `quarantined`, `damaged` (Decimal 18,4). `available = onHand − reserved`. Quarantined/damaged are never available |
| Ledger | New `InventoryTransaction` (header: type, actor, refs, reason, idempotency key) + `InventoryLedgerEntry` (signed bucket deltas per balance key). **Entries are the source of truth**; balances are a cache verified by reconciliation |
| Reservations | New `InventoryReservation` (ACTIVE/RELEASED/CONSUMED) tied to shipment items |
| Shipments | New `Shipment` + `ShipmentItem`; `CustodyTransfer.shipmentId` optional link |
| Thresholds | New `ReorderRule` (org, SKU, threshold) — only user-configured values; no default thresholds |
| Discrepancies | New `InventoryDiscrepancy` (OPEN → ACKNOWLEDGED/RESOLVED) |
| Idempotency | New `IdempotencyRecord` (org, key) storing the first response |

## 3. Ledger semantics

| Type | Bucket deltas |
|---|---|
| OPENING_BALANCE, RECEIPT, CUSTOMER_RETURN, TRANSFER_IN | +onHand at destination |
| DISPATCH (external), TRANSFER_OUT, SUPPLIER_RETURN | −onHand at source |
| RESERVATION / RESERVATION_RELEASE | ±reserved |
| Shipment dispatch | −reserved (consumes reservation) and −onHand at source (type DISPATCH, linked shipment) |
| Shipment receipt | +onHand (received), +damaged (damaged) at receiver location; missing recorded as LOSS with no stock (it never arrived) |
| DAMAGE | onHand → damaged |
| LOSS | −onHand (or −damaged) |
| STOCK_ADJUSTMENT | ±any bucket, reason mandatory, OWNER/ADMIN only |
| QUARANTINE / QUARANTINE_RELEASE | onHand ↔ quarantined |
| RECALL_ALLOCATION | onHand → quarantined (all holders), reservations released |
| RECALL_RETURN | quarantined returned to the brand via a recall-return shipment |

Invariants enforced in one DB transaction with `SELECT … FOR UPDATE` row locks: no bucket below zero; `reserved ≤ onHand`; held (recalled/quarantined/rejected-quality) batches cannot be reserved or ordinarily dispatched. Completed transactions are immutable (DB trigger); corrections are compensating transactions.

## 4. Shipment lifecycle

`DRAFT → RESERVED → READY_TO_DISPATCH → DISPATCHED → PARTIALLY_RECEIVED → RECEIVED`, plus `CANCELLED` (before dispatch), `REJECTED` (receiver refuses after dispatch) → `RETURNED` (sender books the stock back). `READY_TO_DISPATCH` is optional.
- Shipments are between ORIGINX organizations with an **accepted partnership** (same rule as custody). Internal moves use `/inventory/transfers` (TRANSFER_OUT + TRANSFER_IN), never shipments.
- Partial receipt: `received + damaged + missing ≤ dispatched − already resolved`; status becomes RECEIVED only when nothing is outstanding. Shortages/damage raise discrepancies.
- Custody: if `transferCustody` is set, dispatch opens an **existing-style `CustodyTransfer` request** for each batch passport the sender holds. Receipt never auto-accepts custody unless the receiver explicitly asks and the shipment is fully received; otherwise custody stays pending — nothing is fabricated.

## 5. Provenance integration

One hash-chained event per shipment per batch passport per action, written **in the same DB transaction** as the ledger entries (`eventService.insert(tx)`), anchored after commit (failures → PENDING proof, stock unaffected):
`DISPATCHED` (sender), `RECEIVED` (receiver, with received/damaged/missing), `STATUS_CHANGED` (batch hold/quarantine/quality), `RECALL_RETURN_RECEIVED`. Batches without a passport keep ledger + audit only. Trust engine `analyzeCustody` accepts shipment-backed quantity events only when the actor matches the shipment's sender/receiver.

## 6. Permissions (added to `ORG_PERMISSIONS`)

`inventory:read` (all) · `inventory:receive`, `inventory:move` (owner/admin/manager/operator) · `inventory:reserve`, `inventory:quarantine`, `shipments:manage`, `catalogue:manage` (owner/admin/manager) · `shipments:receive` (owner/admin/manager/operator) · `inventory:adjust`, `warehouses:manage` (owner/admin). Platform admins: read-only cross-tenant inventory overview & discrepancies.

## 7. Migration strategy

Single additive migration `20261010000000_inventory_layer`: new tables, nullable/defaulted columns on `ProductBatch`, `Product`, `CustodyTransfer`; RLS + Supabase revokes for new tables; append-only triggers for `InventoryTransaction`/`InventoryLedgerEntry`. No drops, no renames, no resets; existing rows remain valid (defaults `qualityStatus=PENDING`, `holdStatus=NONE`). Applied with `prisma migrate deploy`.

## 8. Risks / decisions

- Decimal arithmetic uses Prisma `Decimal` (no floats). Quantities validated to ≤ 4 dp and to integers for non-fractional units.
- Rate limiting and idempotency records are per database (multi-instance safe).
- Recall allocation works from **recorded** balances only; unrecorded stock is reported as unknown, never assumed.
- Batch passport identity uses `batch:<code>` as the identity serial — documented, additive, does not change existing identities.

## 9. Testing plan

New `tests/api/inventory.test.ts` and `tests/api/shipments.test.ts` on real Postgres + chain: receipts, opening balance, reservations, dispatch, internal transfer, returns, adjustments (RBAC), over-dispatch/over-reserve, concurrent dispatch, idempotent replays, duplicate receipt, partial/damaged/missing receipt, reconciliation, tenant isolation, custody consistency, provenance event linking and hash-chain validity, chain-down safety, recall allocation and dispatch blocking, public verification privacy. Full existing suite re-run.

## Execution log

See the end of `docs/INVENTORY_MANAGEMENT.md` for what was implemented and test results.
