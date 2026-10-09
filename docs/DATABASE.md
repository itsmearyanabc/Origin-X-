# ORIGINX Database

PostgreSQL 17 (local Docker) / Supabase Postgres (production). Schema: [`prisma/schema.prisma`](../prisma/schema.prisma). Migrations: [`prisma/migrations`](../prisma/migrations).

## Entities

| Table | Purpose | Tenant column | Key constraints / indexes |
|---|---|---|---|
| `User` | Accounts (org users and platform admins) | — | unique `email`; `sessionVersion` for instant token revocation |
| `RefreshToken` | Hashed rotating refresh tokens | — | unique `tokenHash`; `familyId` for reuse detection |
| `OneTimeToken` | Hashed password-reset / email-verification tokens | — | unique `tokenHash` |
| `Organization` | Tenants + subscription/entitlement fields | (is the tenant) | unique `slug`; idx status, verificationStatus |
| `OrganizationMember` | User ↔ org with role | `organizationId` | unique (org, user) |
| `Invitation` | Hashed invite tokens | `organizationId` | unique `tokenHash` |
| `OrganizationRelationship` | Supply-chain partnerships | source/target org | unique (source, target, type) |
| `ProductBatch` | Batches (+ inventory: `skuId`, `unitOfMeasure`, `plannedQuantity`, `qualityStatus`, `holdStatus`, `passportProductId`) | `organizationId` | unique (org, batchCode); unique `passportProductId` |
| `Product` | Digital Product Passport core | `organizationId` (+ `currentOwnerOrganizationId`) | unique `publicVerificationToken`; idx productCode, batch, custodian, status, createdAt |
| `ProductIdentity` | Global identity, collision state | via product | unique `identityHash`; idx `canonicalIdentityHash` |
| `ProductEvent` | Hash-chained lifecycle events | `organizationId` | unique (product, sequence); idx eventHash, createdAt |
| `CustodyTransfer` | Two-party custody handoffs (+ optional `shipmentId`) | from/to org | idx product, from, to, status |
| `BlockchainProof` | Anchors (IDENTITY / EVENT / STATUS) | via product | idx eventHash, transactionHash, status |
| `TrustScoreSnapshot` | Trust score history | via product | idx (product, createdAt) |
| `Incident` | Manual + system incidents | `organizationId` | idx type, status, product |
| `Recall` | Product / batch recalls | `organizationId` | idx product, batch, status |
| `VerificationLog` | Every verification (hashed token/IP/UA) | via product | idx tokenHash, result, timestamp, ipHash |
| `AuditLog` | Append-only audit trail | `organizationId` (nullable for platform actions) | idx org, actor, action, resourceType, timestamp |
| `PlatformSetting` | Admin-managed settings | — | unique key |
| `ContactMessage` | Public website contact form (admin inbox) | — | idx status, createdAt |
| `DemoTamperUnlock` | Exists only inside the DEMO_MODE tamper transaction | — | — |

### Inventory layer (migration `20261010000000_inventory_layer`)

| Table | Purpose | Tenant column | Key constraints / indexes |
|---|---|---|---|
| `ProductSku` | SKU catalogue | `organizationId` | unique (org, sku) |
| `Warehouse` / `StorageLocation` | Sites and bins | `organizationId` | unique (org, code) / (warehouse, code) |
| `InventoryBalance` | Cached buckets `onHand`, `reserved`, `quarantined`, `damaged` (Decimal 18,4) | `organizationId` | unique (org, location, sku, batchKey); CHECK non-negative and `reserved ≤ onHand` |
| `InventoryTransaction` | Ledger header (type, actor, refs, reason) | `organizationId` | unique (org, idempotencyKey); idx sku, batch, shipment, type |
| `InventoryLedgerEntry` | Signed bucket deltas — **source of truth** | `organizationId` | idx (balance, bucket) |
| `InventoryReservation` | Stock held for shipment items | `organizationId` | idx (org, status), shipment, batch |
| `Shipment` / `ShipmentItem` | Inter-organization stock movements | sender / receiver org | CHECK `received + damaged + missing ≤ dispatched` |
| `ReorderRule` | User-set low-stock threshold | `organizationId` | unique (org, sku) |
| `InventoryDiscrepancy` | Detected stock problems | `organizationId` | idx (org, status), fingerprint |
| `IdempotencyRecord` | Stored first response per `Idempotency-Key` | `organizationId` | unique (org, key) |

`Product` gains `skuId` (optional) and `passportType` (`UNIT` default | `BATCH`). Semantics: [INVENTORY_MANAGEMENT.md](INVENTORY_MANAGEMENT.md).

Field-name mapping to the brief: the brief's product `productId` is `productCode` (business id; `id` is the internal primary key, never exposed publicly); `riskLevel` is LOW/MEDIUM/HIGH/CRITICAL, `trustLevel` holds EXCELLENT/TRUSTED/CAUTION/HIGH_RISK; JSON payloads are stored as text columns (`metadataJson`, `evidenceJson`, `trustScoreJson`) because event hashes are computed over their exact canonical JSON.

## Integrity guards (migration `20261009000100_integrity_guards`)

| Guard | Effect |
|---|---|
| `AuditLog_append_only`, `AuditLog_no_truncate` | UPDATE / DELETE / TRUNCATE rejected |
| `VerificationLog_append_only`, `…_no_truncate` | same |
| `ProductEvent_immutable` | Any change to hashed columns or deletion rejected (only `blockchainProofId` / `verificationStatus` may change). Relaxed only while a `DemoTamperUnlock` row exists. |
| `BlockchainProof_guard` | Proofs never deleted; CONFIRMED proofs immutable |
| RLS on every table, no policies | Supabase REST/GraphQL roles (`anon`, `authenticated`) can read nothing; grants revoked |

Inventory guards (migration `20261010000000_inventory_layer`):

| Guard | Effect |
|---|---|
| `InventoryTransaction_append_only`, `InventoryLedgerEntry_append_only` (+ `_no_truncate`) | Ledger rows can never be updated, deleted or truncated — corrections are compensating transactions |
| `InventoryBalance_no_delete`, `InventoryReservation_no_delete` | Balances and reservations are never deleted (they go to zero / RELEASED) |
| `InventoryBalance_non_negative`, `ShipmentItem_quantities_valid` | CHECK constraints — no negative stock, no over-receipt, whatever code path writes |
| RLS + revokes on all inventory tables | Same Supabase hardening as above |

These guards stop the application and ordinary users from rewriting history. A database superuser can still drop triggers — which is exactly what the cryptographic chain and the on-chain anchors detect.

## Migrations

```bash
npm run db:migrate            # apply (prisma migrate deploy) — also run automatically by the container
npm run db:migrate:dev        # create a new migration during development
```

| Migration | Contents |
|---|---|
| `20261009000000_init` | Core schema |
| `20261009000100_integrity_guards` | Triggers + RLS |
| `20261009000200_contact_messages` | `ContactMessage` |
| `20261010000000_inventory_layer` | Inventory tables, additive columns, inventory guards (additive only — no drops/renames) |

All migrations are additive; none resets or rewrites data.
On Supabase, migrations use `DIRECT_URL` (session/direct connection); the app uses the pooled `DATABASE_URL`.
