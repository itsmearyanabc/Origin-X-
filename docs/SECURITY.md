# ORIGINX Security

## Threat model (what the system defends against)

| Threat | Defence |
|---|---|
| Tenant A reading/changing Tenant B's data | Server-side tenant resolution from membership; every product query scoped by `readableProductWhere`; 404 (not 403) for foreign resources; client-supplied `organizationId`/owner ignored. Tested (`tests/api/tenancy-rbac.test.ts`). |
| Privilege escalation inside a tenant | Central permission matrix; only owners grant owner/admin; last owner protected; platform admins get no implicit tenant access. |
| Editing product history (insider or SQL access) | DB triggers make events/audit/verification logs immutable; SHA-256 chain detects edits; on-chain anchors detect full re-hashing ("rewrite attack"). |
| Forging trust (client-sent hash/score/status) | All computed server-side; platform-only event types rejected (422). |
| Counterfeit registration (cloned identity) | Organization-independent identity hash; on-chain write-once identity registry; quarantine + incidents; claimant learns nothing about the victim. |
| Cloned QR codes on fake packaging | Distinct-scanner anomaly detection → SUSPICIOUS + incident. |
| Token enumeration on the public endpoint | 192-bit random tokens; format check before DB; per-IP limiter; unknown-token lockout; `no-store`. |
| Credential stuffing / brute force | Auth rate limiter, constant-time-ish login (dummy bcrypt for unknown users), uniform errors, Cloudflare rules. |
| Stolen refresh token | Rotation with family revocation on reuse; `sessionVersion` revokes all access tokens. |
| Recalled product shown as safe | Public state precedence: RECALLED is never reported as verified; trust note explains score ≠ safety. |
| Faked blockchain proofs | Only real tx hashes are stored; verification re-reads contract state and receipts. |
| Leaking internals | Generic 500s, Prisma errors mapped, no stack traces, public projection whitelist, other tenants' event metadata redacted. |

## Controls

**Authentication** — bcrypt(12); HS256 access JWT 15 min with issuer + `jti` + session version; opaque 384-bit refresh tokens stored as SHA-256; single-use hashed reset/verification tokens; password policy (≥10 chars, letters + digits).

**Browser sessions** — the web app keeps the access token in memory only (never `localStorage`); the refresh token is an httpOnly, `Secure` (production), `SameSite=Lax` cookie scoped to `/api/v1/auth`, so scripts can't read it and it isn't sent to any other endpoint. Cookie-authenticated requests must carry `X-Requested-With` (a custom header cross-site forms cannot send) → CSRF-safe. Rotation with reuse detection revokes the whole family. App and API are one origin behind nginx, so no CORS credentials are needed.

**Authorization** — `can(permission)` for tenants, `requireAdmin(permission)` for platform staff; resource rules in services (brand owner vs custodian, target-only acceptance, owner-only recalls).

**Input** — Zod schemas on every write (422 with paths), body limit 100 KB, metadata ≤ 8 KB, whitelisted sort fields, strict update schemas.

**Transport & headers** — Helmet on the API, CORS allow-list (wildcard refused in production), HSTS at nginx, TLS Full (strict) between Cloudflare and origin. The web app is served with a strict CSP (`default-src 'self'`; no inline or third-party scripts; fonts self-hosted, no Google Fonts), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy` allowing only the camera (QR scanning on `/verify`).

**Rate limiting** — app: general 600/min, auth 30/15 min, verify 30/min, unknown-token lockout; nginx: 20 r/s burst 40 per visitor IP; Cloudflare: rate-limit rule on `/api/v1/auth/*` and `/api/v1/verify/*` (free plan: 1 rule). Counters are per instance — use Redis when scaling horizontally.

**Client IP** — `BEHIND_CLOUDFLARE=true` reads `CF-Connecting-IP`; only safe when the VPS firewall admits Cloudflare ranges only (see DEPLOYMENT.md). Raw IPs are never stored — HMAC with `PRIVACY_HASH_SALT`.

**Database** — integrity triggers; RLS enabled on every table with no policies and grants revoked from Supabase `anon`/`authenticated`; TLS (`sslmode=require`); least-exposed pooler credentials.

**Blockchain** — only hashes on-chain; contract restricts writes to authorized anchorers; anchors are write-once; dedicated hot wallet holding only test/gas funds; key only in server env; chain-id pinning (`BLOCKCHAIN_CHAIN_ID`) prevents anchoring to the wrong network.

**Secrets** — `.env*` gitignored; production config validation refuses to start with default/missing secrets, `DEMO_MODE=true`, wildcard CORS, or EVM mode without a key. Rotate `JWT_ACCESS_SECRET` to force global re-login.

**Container** — non-root, read-only root filesystem, `no-new-privileges`, tini as PID 1, healthcheck, no dev dependencies.

**Inventory** — every stock change is a ledger transaction under row locks (`SELECT … FOR UPDATE`) in one DB transaction; DB CHECK constraints forbid negative stock and over-receipt; ledger tables are append-only by trigger; `Idempotency-Key` makes retries safe; fine-grained permissions (`inventory:*`, `shipments:*`, `warehouses:manage`, `catalogue:manage`) with adjustments limited to OWNER/ADMIN and a mandatory reason; shipments only between accepted partners; public verification never exposes warehouses, stock levels or partner quantities. Platform admins have read-only cross-tenant inventory views.

**Public contact form** — rate-limited, honeypot field, length limits; messages are only visible to platform admins.

**Audit** — append-only `AuditLog` for auth, membership, product, event, custody, incident, recall, verification and every admin action (`ADMIN_*`).

**Demo mode** — the tamper endpoint and token echoes exist only with `DEMO_MODE=true`, which production refuses.

## Operational checklist
- [ ] Supabase: enable PITR/backups; restrict network access if on a paid plan; rotate DB password after setup.
- [ ] Cloudflare: SSL Full (strict), Always Use HTTPS, WAF managed rules, Bot Fight Mode, rate-limit rule.
- [ ] VPS: UFW allow 22 (your IP), 443/80 from Cloudflare ranges only; unattended upgrades; SSH keys only.
- [ ] Monitor `/ready`, container health, and PENDING/FAILED proof counts (`/admin/dashboard`).
- [ ] Keep the anchoring wallet minimally funded; alert on low balance.
