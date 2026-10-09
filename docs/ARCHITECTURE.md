# ORIGINX Architecture

```
                         ORIGINX SaaS
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
     ADMIN PANEL        ORG USER PANEL        CONSUMER (QR scan, no login)
     web /admin         web /app              web /verify/:token
     /api/v1/admin      /api/v1/*             /api/v1/verify/:token
          |                   |                   |
          +-------------------+-------------------+
                              |
                Cloudflare (TLS, WAF, rate rules)
                              |
          nginx (origin TLS, serves web/dist, proxies /api) — VPS
                              |
                   API LAYER (Express 5, Zod)
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
     AUTH / RBAC        TENANT ENGINE        BUSINESS LOGIC
   requireAuth,        requireOrganization,  services/*
   requireAdmin        readableProductWhere
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
      PRODUCTS             EVENTS            TRUST ENGINE         INVENTORY
   identity, batches   append-only chain    scoreTrust()      SKUs, warehouses, ledger,
                                                              shipments → provenance events
          |                   |                   |
          v                   v                   v
      PASSPORT            HASH CHAIN          INCIDENTS / RECALLS
   private + public   SHA-256 linked events   system detection
                              |
                              v
                     BLOCKCHAIN PROOFS  ── ethers v6 ──>  OriginXProofAnchor (EVM)
                              |                           Hardhat (dev) / Polygon Amoy / any EVM
                              v
                        VERIFICATION
             content + linkage + on-chain read-back
                              |
                              v
             PostgreSQL (Supabase) — triggers: append-only audit,
             immutable events, immutable confirmed proofs; RLS on all tables
```

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| Config | `src/config.ts` | Env parsing, local chain deployment file, **production safety checks** (refuses to boot with unsafe settings). |
| Libraries | `src/lib/` | Canonical JSON + hashing, tokens, passwords, JWT, errors, pagination/sorting, client IP (Cloudflare-aware). |
| Middleware | `src/middleware/` | Authentication, tenant resolution, RBAC (`can()`), platform RBAC (`requireAdmin()`), rate limits, enumeration guard, error envelope. |
| Routes | `src/routes/` | Thin HTTP adapters: auth, organizations, products, inventory (catalogue, warehouses, ledger, shipments), ops (batches, custody, incidents, recalls, verification, analytics, audit, blockchain), admin, public verify + site contact. |
| Services | `src/services/` | All business rules. Routes never touch Prisma for writes. `services/inventory/` holds the ledger (row-locked postings, idempotency), catalogue, warehouses, shipments and provenance bridge — see [INVENTORY_MANAGEMENT.md](INVENTORY_MANAGEMENT.md). |
| Web app | `web/` | React 19 + Vite + Tailwind 4 SPA: public website, consumer verification, organization panel (incl. inventory), platform admin console. TanStack Query for server state; access token in memory, refresh via httpOnly cookie. |
| Data | `prisma/` | Schema, migrations (incl. integrity guards + Supabase RLS hardening), seed. |
| Chain | `contracts/`, `scripts/` | Solidity contract, compiled artifact, compile/deploy scripts. |
| CLIs | `src/cli/` | `create-admin` (production bootstrap), `anchor-pending` (retry anchoring). |

## Request flow (example: custody acceptance)

1. `POST /api/v1/custody-transfers/:id/accept` with `Authorization` + `X-Organization-Id`.
2. `requireAuth` → valid JWT, active user, current session version.
3. `requireOrganization` → caller is an ACTIVE member; org not suspended (writes).
4. `can("custody:respond")` → role allowed.
5. `custodyService.accept` → transfer addressed to this org, still pending, partnership still accepted; inside one DB transaction: re-check sender still holds custody, insert the hash-linked handoff event, mark transfer accepted, move custody.
6. After commit: anchor the event hash on-chain, write audit entries for both organizations, recompute the trust score.

## Verification engine (IDENTIFY → VERIFY → DETECT → EXPLAIN → RESPOND)

`verificationService.assess(productId)`:
1. **Verify** — `hashChainService.verifyProductHistory`: recompute every hash, check links and sequence, check sealed passport fields, read each anchored hash back from the contract.
2. **Detect / Respond** — open deduplicated system incidents (TAMPERED_RECORD, INVALID_BLOCKCHAIN_PROOF, BROKEN_CUSTODY_CHAIN), mark the product COMPROMISED.
3. **Score** — deterministic trust score with reasons.
4. **Explain** — public state + plain-language copy; ASK ORIGINX explains the same verified facts.

## Design principles

- The server computes every trust-relevant value; clients cannot supply hashes, scores, statuses, ownership or tenant.
- History is append-only — corrections are new events, enforced by the database, not just the code.
- The blockchain stores proofs, never data, and is never faked: no chain ⇒ PENDING.
- The core system works without AI and without the chain being reachable (degraded, honestly labelled).
