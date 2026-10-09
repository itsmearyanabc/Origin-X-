# ORIGINX — Implementation Plan

*The Verifiable Identity Layer for Physical Products.* Multi-tenant SaaS backend: Admin panel API, Organization panel API, public Consumer verification API.

Status: **implemented**. Every section below links to the code that realizes it. 61 automated tests run against real PostgreSQL and a real EVM chain.

---

## 1. Existing repository architecture (inspection findings)

Before the change, the repository already held a scaffold (Express 5 + TypeScript + Prisma + SQLite, JWT auth, services for products/events/custody/trust/recalls, a Solidity contract, seed, two tests). Findings:

| Area | Finding | Decision |
|---|---|---|
| Build | `tsc` failed with 20+ errors (Express 5 `req.params` typing). | Fixed via `param()` helper (`src/lib/http.ts`). |
| Tests | Main API test failed (500): `findUnique` on non-unique `productCode`. | Replaced by a global identity model + 61 tests. |
| Blockchain | "Development mode" invented `dev:…` pseudo transaction hashes and reported them as valid; EVM mode threw. | **Rewritten**: real EVM anchoring via ethers v6; never fabricates a hash (`src/services/blockchain.service.ts`). |
| Contract | No access control; event anchors could be overwritten. | Owner/anchorer roles, write-once anchors, identity status registry (`contracts/OriginXProofAnchor.sol`). |
| Tenancy | Platform admins silently became `ORG_OWNER` of any tenant; tenant id accepted from request body. | Admins get **no** implicit tenant access; tenant selected only by header and proven by membership. |
| RBAC | `ORG_ADMIN` could invite owners / remove owners; no permission matrix. | Central permission matrix (`ORG_PERMISSIONS`) + escalation guards. |
| Hash chain | Tampering in event N was not detected as a broken link at N+1; rewrite attacks undetectable. | Three-layer verification (content, linkage, blockchain). |
| Counterfeit | Genuine product was marked COUNTERFEIT when someone cloned it; attacker learned the victim's ids. | Claimant quarantined; owner alerted; nothing leaked to claimant. |
| Audit | Audit logs mutable. | Append-only enforced by **database triggers**. |
| Auth | Refresh JWTs could collide; reset tokens always returned. | Opaque rotating refresh tokens with reuse detection; dev tokens only in DEMO_MODE. |
| Database | SQLite. | **PostgreSQL** (Supabase in production) — requested deployment target. |

Reused: the overall layering (routes → services → Prisma), response envelope, Express 5/Prisma/Zod/Vitest stack, domain vocabulary.

## 2. Proposed (implemented) final architecture

See [ARCHITECTURE.md](ARCHITECTURE.md). Node 22 / TypeScript / Express 5 API → Prisma → PostgreSQL; ethers v6 → OriginXProofAnchor (EVM). Deployed as a Docker image on a Hostinger VPS behind nginx and Cloudflare; database on Supabase.

## 3. Multi-tenant architecture

Shared database, tenant column (`organizationId`) on every organization-owned table. Isolation is enforced **server-side** in three places:
1. `requireOrganization` (`src/middleware/tenant.ts`) — tenant chosen via `X-Organization-Id`, proven by an ACTIVE membership; same 403 whether the org exists or not.
2. `readableProductWhere()` (`src/services/product-access.ts`) — every product query is scoped to: brand owner, current custodian, past custodian, or pending transfer recipient. Anything else is a 404.
3. Service queries always include `organizationId` for incidents, recalls, batches, audit logs, members, invitations.

Client-provided `organizationId`, `currentOwner`, `trustScore`, `eventHash`, `verificationStatus` and blockchain status are ignored — the server derives them.

## 4. Authentication architecture

`src/services/auth.service.ts`: bcrypt (cost 12) passwords; short-lived HS256 access JWT (15 min) carrying `sub`, `sv` (session version) and `jti`; opaque 384-bit refresh tokens stored as hashes, rotated on every use, **family revoked on reuse**. Password reset and email verification use single-use hashed tokens. "Log out everywhere", password change/reset and admin suspension bump `sessionVersion`, invalidating all access tokens instantly. Three actor classes: platform admin (`platformRole`), organization user (memberships), consumer (no account).

## 5. Authorization architecture

Two independent matrices in `src/lib/constants.ts`:
- `ORG_PERMISSIONS` — 22 permissions × 5 org roles, enforced by `can(permission)`.
- `ADMIN_PERMISSIONS` — platform permissions × 4 admin roles, enforced by `requireAdmin(permission)`.

Resource-level rules live in services (brand owner vs custodian event authority, target-only transfer acceptance, owner-only recalls, role-escalation guards, last-owner protection).

## 6. Organization architecture

`Organization` (profile, primary + additional supply-chain types, status, verification, subscription), `OrganizationMember`, `Invitation` (hashed token, 7-day expiry), `OrganizationRelationship` (REQUESTED → ACCEPTED/REJECTED → SUSPENDED). Onboarding: register → create org (PENDING, caller becomes ORG_OWNER) → platform admin approves/verifies.

## 7. Admin architecture

`/api/v1/admin/*` (`src/routes/admin.routes.ts`, `src/services/admin.service.ts`): dashboard, metrics (verification volume, failures, counterfeit attempts, collisions, recalls, suspicious products, most-verified, unusual organizations), organizations (approve/reject/suspend/reactivate/verify), subscriptions, users (status, platform role), products, incidents, recalls, blockchain proofs/status/retry, audit & verification logs, settings. Interventions append events (`STATUS_CHANGED`) and on-chain status — never edit history. Every admin action is audited as `ADMIN_*`.

## 8. Consumer verification architecture

`GET /api/v1/verify/:token` — no login. Token: 192-bit random, URL-safe. Response: state + headline + safe public passport (brand, batch, origin, dates, status, trust, lifecycle with per-event integrity and tx hashes, blockchain summary, recall). Rate-limited, enumeration-guarded, `Cache-Control: no-store`, logged with salted hashes only.

## 9. Product architecture

`Product` (business `productCode` + optional `serialNumber`, batch, origin, dates, custodian, status, trust, verification/authenticity), `ProductBatch` (unique per org), `ProductIdentity`. Statuses: ACTIVE, DELIVERED, RECALLED, SUSPENDED, ARCHIVED, QUARANTINED.

## 10. Digital Product Passport architecture

- Private passport (`GET /products/:id/passport`): identity, product, custody (transfers + consistency analysis), full lifecycle with hashes, live history verification, trust breakdown, own incidents, recalls.
- Public passport: the consumer projection (section 8).
- Identity-defining fields (code, serial, batch, origin, dates, manufacturer) are **sealed** into the `PRODUCT_REGISTERED` event; later changes in the product row are detected as tampering (`passportIntegrity`).

## 11. Event architecture

`ProductEvent` — append-only, `(productId, sequence)` unique, inserted in a transaction with retry on sequence conflicts. Authority per type: brand-owner events (MANUFACTURED, QUALITY_APPROVED, CERTIFICATE_ADDED, STATUS_CHANGED), custodian events (SHIPMENT_CREATED, RECEIVED, WAREHOUSE_RECEIVED, RETAILER_RECEIVED, DELIVERED), shared (DOCUMENT_ADDED), platform-only (PRODUCT_REGISTERED, CUSTODY_TRANSFERRED, INCIDENT_CREATED, RECALL_INITIATED). Chronological order enforced; timestamps are server time. Custody handoffs: TRANSFER_REQUESTED/ACCEPTED/REJECTED/CANCELLED are transfer states (audited); acceptance writes one hash-chained handoff event.

## 12. Cryptographic architecture

`eventHash = SHA-256( canonical(payload) | previousEventHash )`, genesis = 64 zeros. Canonical JSON: recursively sorted keys, no whitespace, `undefined` omitted, ISO dates, versioned (`v: 1`). Payload: product, sequence, type, actor user/org, timestamp, location, metadata. Identity: `SHA-256("originx:identity:v1|CODE|SERIAL")` — organization-independent so clones collide. Secrets (refresh/reset/invite tokens) stored as SHA-256; IPs/user-agents as salted HMAC.

## 13. Blockchain architecture

`OriginXProofAnchor` (Solidity 0.8.30, compiled with solc-js, artifact committed). Only hashes on-chain: identity registration (write-once ⇒ global first-registrant registry), event anchors bound to an identity (write-once), identity status changes (e.g. RECALLED). `BlockchainService`: lazy connection with chain-id check and contract-code check; serialized transaction queue (nonce safety); receipts awaited with timeout; failures leave proofs PENDING (no tx hash) for the background anchor worker; permanent contract errors → FAILED. Verification reads contract state back and, for single proofs, checks receipt status, target address and emitted log. Networks: local Hardhat (dev/tests), Polygon Amoy testnet (hosted demo), any EVM chain (production).

## 14. Trust score architecture

`scoreTrust()` (`src/services/trust.service.ts`) — pure and deterministic. Factors: verified org +10, verified origin +10, complete custody +15, valid crypto chain +20, valid blockchain proofs +15, verified partners +10, unique identity +10, no open incidents +10. Penalties: tampered −40, identity collision −50, broken custody −20, invalid proof −30, unverified org −15, open critical incident −20. Clamped 0–100; levels EXCELLENT ≥90, TRUSTED ≥75, CAUTION ≥50, HIGH_RISK. Stored with full reasons on the product; history in `TrustScoreSnapshot`.

## 15. Incident architecture

`Incident` with MANUAL/SYSTEM source. System detection (deduplicated while open): TAMPERED_RECORD, INVALID_BLOCKCHAIN_PROOF, BROKEN_CUSTODY_CHAIN, IDENTITY_COLLISION, SUSPICIOUS_VERIFICATION_PATTERN (cloned QR). Status flow OPEN → INVESTIGATING → RESOLVED/DISMISSED (or RECALLED via recall). Tenants only ever see their own incidents.

## 16. Recall architecture

Brand owner only; product or whole batch. DRAFT → INITIATED → IN_PROGRESS → COMPLETED, or CANCELLED. Initiation: product RECALLED, identity RECALLED, `RECALL_INITIATED` event anchored, RECALLED status anchored on-chain, linked incident → RECALLED. Cancellation of an issued recall restores the previous status via an appended `STATUS_CHANGED` event (never by editing history). Consumers see **RECALLED** — never "verified".

## 17. Counterfeit detection architecture

On registration: (a) same canonical identity already registered, (b) same product code registered by another organization, or (c) identity already present on-chain ⇒ the new record is QUARANTINED with a derived (non-canonical) identity, status COUNTERFEIT, never anchored; CRITICAL incident for the claimant (redacted), HIGH incident with evidence for the genuine owner; public verification of the clone returns COUNTERFEIT. Post-sale cloning (copied QR codes) is detected from distinct-scanner volume per token.

## 18. Audit architecture

`AuditLog` — append-only (UPDATE/DELETE/TRUNCATE rejected by triggers). Every sensitive action writes one: auth events, org/member/role/invitation changes, relationships, product create/update/archive, events, custody, incidents, recalls, verifications, admin actions (`ADMIN_*`), demo tamper. Fields: org, actor, action, resource, metadata, timestamp, salted IP hash.

## 19. Database schema

See [DATABASE.md](DATABASE.md). 20 tables, foreign keys, indexes on tenant/product/batch/token/hash/time columns, unique constraints on identity hash, verification token, (product, sequence), (org, batchCode), (org, user).

## 20. API architecture

See [API.md](API.md). REST under `/api/v1`, envelope `{success, data, meta?}` / `{success:false, error:{code,message,details?}}`, Zod validation (422 with field paths), pagination (`page`, `pageSize` ≤100), whitelisted sorting (`sort=-trustScore`), filters per resource.

## 21. Security architecture

See [SECURITY.md](SECURITY.md).

## 22. Testing architecture

Vitest + Supertest. Global setup creates a **brand-new PostgreSQL database per run** (migrated, triggers + RLS included; dropped afterwards) and starts a **real Hardhat chain** with the contract deployed. Unit tests: canonicalization, hash chain (incl. critical A/B/C), trust, custody analysis, public-state precedence. API tests: auth, tenancy (critical cross-tenant test), RBAC, lifecycle, custody, blockchain proofs (read back from chain), both tamper attacks, DB immutability, counterfeit, recalls, public/private separation (critical), enumeration, cloned QR, admin, AI fallback, offline-chain retry.

## 23. Deployment architecture

See [DEPLOYMENT.md](DEPLOYMENT.md): Cloudflare (DNS, proxy, TLS Full-strict, WAF, rate rule) → Hostinger VPS (UFW allows only Cloudflare to 443) → nginx (origin cert) → API container (read-only FS, non-root, healthcheck, runs migrations on start) → Supabase Postgres (pooled runtime / direct migrations, RLS on all tables) ; anchoring wallet → Polygon Amoy.

## 24. Seed / demo data architecture

`prisma/seed.ts` builds everything through the real services (real hashes, handoffs, proofs): platform admins; ABC Pharma (all five roles), SwiftLogix, MetroCare Warehouse, HealthPlus Retail, XYZ Electronics, Shadow Pharma Traders (unverified counterfeit actor), NovaMed Distributors (pending approval); accepted partnerships; Vaccine Batch A92 (full 8-event lifecycle), A93/A94 (tamper demos), Glucora insulin batch C7 (recall demo), Aero X1 earbuds. `scripts/demo.ts` runs the four scenarios live. See [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

## 25. Implementation sequence (as executed)

1. Repository inspection and gap analysis (section 1).
2. Contract hardening, solc compile pipeline, deploy script.
3. Schema redesign → PostgreSQL migrations + integrity-guard/RLS migration.
4. Core libs: config (production guards), crypto, errors, pagination, HTTP/IP helpers.
5. Middleware: auth, tenant resolution + RBAC, rate limiting (Cloudflare-aware), error handling.
6. Services: auth, organizations/relationships, entitlements, products/identity/collisions, events, hash-chain verification, blockchain, custody, trust, incidents, recalls, verification (public/private), analytics, admin, AI, demo.
7. Routes and app assembly (health/readiness, request ids, structured logs).
8. Test infrastructure on real Postgres + real chain; 61 tests.
9. Seed through real services; live demo script.
10. Production image, compose, nginx, env templates; production smoke test.
11. Documentation.

### Known gaps / next steps
- Email delivery provider (tokens are currently returned only in DEMO_MODE).
- Redis-backed rate limiting/enumeration counters for multi-instance deployments.
- Payment provider for subscriptions (entitlements already enforced via `ENFORCE_ENTITLEMENTS`).
- Optional Merkle batching of anchors to cut gas on mainnet.
- Frontend panels (APIs are ready).
