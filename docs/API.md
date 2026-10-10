# ORIGINX API (v1)

Base URL: `/api/v1`. JSON only.

**Responses**
```json
{ "success": true, "data": { }, "meta": { "total": 42, "page": 1, "pageSize": 20, "pageCount": 3 } }
{ "success": false, "error": { "code": "PRODUCT_NOT_FOUND", "message": "Product could not be found.", "details": [] } }
```
Common errors: `UNAUTHENTICATED` 401 · `FORBIDDEN` / `NOT_ORGANIZATION_MEMBER` / `ROLE_ESCALATION_DENIED` 403 · `*_NOT_FOUND` 404 · `CONFLICT` / `*_PENDING` / `IMMUTABLE_RECORD` 409 · `VALIDATION_ERROR` 422 (field paths in `details`) · `RATE_LIMITED` 429 · `INTERNAL_ERROR` 500 (no internals leaked).

**Headers**: `Authorization: Bearer <accessToken>`; tenant routes also need `X-Organization-Id: <organizationId>`. Retry-safe inventory writes accept `Idempotency-Key: <uuid>`. Lists accept `page`, `pageSize` (≤100), resource filters, and `sort=field` / `sort=-field` (whitelisted).

Permission names below refer to `ORG_PERMISSIONS` / `ADMIN_PERMISSIONS` in `src/lib/constants.ts`.

## Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/ready` | database + blockchain status (503 if DB down) |

## Auth — `/auth`
Browser sessions: the access token (15 min) is returned in JSON and kept in memory only; the refresh token is an **httpOnly cookie** `ox_rt` (`Secure` in production, `SameSite=Lax`, path `/api/v1/auth`). Requests that authenticate with that cookie (`/refresh`, `/logout`) must send `X-Requested-With: XMLHttpRequest` (CSRF guard → `CSRF_HEADER_REQUIRED` 403). Non-browser clients may send `X-Refresh-Transport: body` to receive/send the refresh token in JSON instead.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/register` | — | `{email, password, fullName}` → session (sets cookie) |
| POST | `/login` | — | → `{user, accessToken}` + cookie |
| POST | `/refresh` | cookie (or body) | rotate; reuse revokes the family (`TOKEN_REUSED`) |
| POST | `/logout` | cookie (or body) | revokes this session, clears the cookie |
| POST | `/logout-all` | bearer | revokes every session (bumps session version) |
| POST | `/forgot-password` | — | always `{accepted:true}` |
| POST | `/reset-password` | — | `{token, password}` |
| POST | `/change-password` | bearer | `{currentPassword, newPassword}` |
| POST | `/verify-email/request` | bearer | emails a 6-digit code (10 min, 60 s resend cooldown → `OTP_RESEND_TOO_SOON` 429) |
| POST | `/verify-email/otp` | bearer | `{code}` — confirms the email; 5 wrong tries lock the code (`INVALID_CODE` / `CODE_LOCKED` / `CODE_EXPIRED`) |
| POST | `/verify-email` | — | `{token}` — legacy confirmation links sent before codes |
| POST | `/google` | — | `{credential}` Google ID token; only Google-verified emails (`GOOGLE_EMAIL_UNVERIFIED`) |
| GET | `/me` | bearer | profile, account type, organizations + roles |

## Organizations — `/organizations`
| Method | Path | Permission |
|---|---|---|
| POST | `/` | any user (creates PENDING org, caller = ORG_OWNER) |
| POST | `/invitations/accept` | invitee `{token}` |
| GET / PATCH | `/current` | org:read / org:settings |
| GET | `/current/entitlements` | org:read |
| GET | `/current/members` | members:read |
| PATCH / DELETE | `/current/members/:memberId` | members:manage (+ owner-only for owner/admin) |
| GET / POST | `/current/invitations` | members:manage |
| DELETE | `/current/invitations/:id` | members:manage |
| GET | `/current/discover?q=&type=` | relationships:read |
| GET / POST | `/current/relationships` | relationships:read / manage |
| POST | `/current/relationships/:id/accept` · `/reject` · `/suspend` | relationships:manage |

## Products & passports — `/products`
| Method | Path | Permission |
|---|---|---|
| POST | `/` | products:create — returns `collision` when quarantined |
| GET | `/?q=&status=&scope=registered\|custody&batchCode=&trustLevel=&sort=` | products:read |
| GET / PATCH | `/:id` | products:read / products:update (brand owner; name, category, description only) |
| POST | `/:id/archive` | products:archive |
| GET | `/:id/passport` | products:read — private Digital Product Passport |
| GET | `/:id/qr` | products:read — `{token, url, svg, pngDataUrl}` |
| GET / POST | `/:id/events` | products:read / events:create `{eventType, location?, metadata?}` |
| POST | `/:id/verify-history` | products:read — full integrity report |
| GET | `/:id/trust-score`, `/:id/trust-score/history` | products:read |
| GET | `/:id/blockchain/proofs`, `/:id/blockchain/proofs/:proofId/verify` | products:read |
| GET | `/:id/verifications`, `/:id/custody-transfers` | products:read |
| POST | `/:id/ask` | products:read — ASK ORIGINX `{question}` |
| POST | `/:id/demo/tamper` | demo:tamper — **DEMO_MODE only**, `{mode: naive\|rewrite, sequence?}` |

## Operations (tenant-scoped)
| Method | Path | Permission |
|---|---|---|
| GET / POST | `/batches`, GET `/batches/:id` | products:read / create |
| GET / POST | `/custody-transfers?direction=incoming\|outgoing&status=` | products:read / custody:request `{productId, toOrganizationId, note?}` |
| POST | `/custody-transfers/:id/accept` | custody:respond `{receiptEventType?, location?}` |
| POST | `/custody-transfers/:id/reject` · `/cancel` | custody:respond / custody:request |
| GET / POST | `/incidents`, GET `/incidents/:id` | incidents:read / create |
| PATCH | `/incidents/:id` | incidents:manage `{status, note?}` |
| GET / POST | `/recalls`, GET `/recalls/:id` | recalls:read / manage `{productId \| batchId, reason, incidentId?, initiate?}` |
| POST | `/recalls/:id/transition` | recalls:manage `{status}` |
| POST | `/verification/scan` | verification:scan `{token}` |
| GET | `/verification/logs` | analytics:read |
| GET | `/analytics/dashboard`, `/analytics/most-verified` | analytics:read |
| GET | `/entitlements`, `/blockchain/status` | org:read |
| GET | `/audit-logs?action=&resourceType=&resourceId=` | audit:read |

## Inventory (tenant-scoped)
Catalogue (`/catalogue/skus`), batch extensions (`/batches/:id`, `/passport`, `/hold`, `/inventory`), warehouses and locations, the stock ledger (`/inventory/*`), shipments (`/shipments/*`) and recall inventory (`/recalls/:id/inventory`). Full endpoint table, bodies, permissions and error codes: [INVENTORY_MANAGEMENT.md §8](INVENTORY_MANAGEMENT.md#8-endpoints-apiv1-tenant-scoped-x-organization-id-required).

## Public website
| Method | Path | Notes |
|---|---|---|
| POST | `/site/contact` | No auth. `{name, email, company?, topic, message}`; rate-limited; stored for the admin inbox |

## Public consumer verification
| Method | Path | Notes |
|---|---|---|
| GET | `/verify/:token` | No auth. States: `AUTHENTIC`, `HISTORY_VERIFIED`, `RECALLED`, `SUSPICIOUS`, `COUNTERFEIT`, `HISTORY_COMPROMISED`, `UNKNOWN`. Rate-limited + enumeration guard. |

Example (abridged):
```json
{
  "state": "RECALLED",
  "headline": "⚠ Product identity verified, but this product has been RECALLED.",
  "identityVerified": true, "historyVerified": true, "blockchainVerified": true, "recalled": true,
  "warnings": [],
  "passport": {
    "productName": "Glucora Insulin Pen 100 IU/ml", "productCode": "GLU-C7-PEN", "batch": "C7",
    "brand": { "name": "ABC Pharma", "verified": true }, "origin": { "country": "IN", "location": "Baddi, Himachal Pradesh" },
    "trust": { "score": 100, "level": "EXCELLENT", "note": "This score rates the authenticity of the product record, not its safety. …" },
    "recall": { "status": "INITIATED", "reason": "…" },
    "lifecycle": [{ "sequence": 1, "eventType": "PRODUCT_REGISTERED", "eventHash": "…", "integrity": "VALID", "blockchain": { "result": "VERIFIED", "transactionHash": "0x…" } }],
    "blockchain": { "status": "VERIFIED", "network": "polygon-amoy", "chainId": 80002, "contractAddress": "0x…" }
  }
}
```

## Admin — `/admin` (platform roles only)
| Method | Path | Permission |
|---|---|---|
| GET | `/dashboard`, `/platform-metrics` | admin:read |
| GET | `/organizations?status=&verificationStatus=&type=&q=`, `/organizations/:id` | admin:read |
| POST | `/organizations/:id/approve` · `reject` · `suspend` · `reactivate` · `verify` · `unverify` | admin:orgs:manage `{reason?}` |
| PUT | `/organizations/:id/subscription` | admin:subscriptions `{plan, status?, expiresAt?, productLimit?, userLimit?}` |
| GET | `/users`; PATCH `/users/:id/status`, `/users/:id/platform-role` | admin:read / admin:users:manage |
| GET | `/products`; POST `/products/:id/identity-status` | admin:read / admin:compliance `{status, reason}` |
| GET / PATCH | `/incidents`, `/incidents/:id` | admin:read / admin:compliance |
| GET | `/recalls`, `/verification-logs` | admin:read |
| GET | `/audit-logs` | admin:audit |
| GET | `/blockchain/status`, `/blockchain/proofs`, `/blockchain/proofs/:id/verify` | admin:read |
| POST | `/blockchain/anchor-pending` | admin:blockchain |
| POST | `/blockchain/proofs/:id/retry` | admin:blockchain (FAILED proof only; audited) |
| GET / PUT | `/settings`, `/settings/:key` | admin:read / admin:settings |
| GET / PATCH | `/contact-messages`, `/contact-messages/:id` | admin:read / admin:orgs:manage `{status}` |
| GET | `/inventory/overview` | admin:read — cross-tenant stock, shipment and discrepancy totals (read-only) |
| GET | `/inventory/discrepancies` | admin:audit |

Brief → implementation route mapping: `/organization-members` → `/organizations/current/members`; `/relationships` → `/organizations/current/relationships`; `/product-events` → `/products/:id/events`; `/digital-passports` → `/products/:id/passport` (private) and `/verify/:token` (public); `/trust-score` → `/products/:id/trust-score`; `/blockchain` → `/products/:id/blockchain/*`, `/blockchain/status`, `/admin/blockchain/*`; `/verification` → `/verify/:token`, `/verification/*`.
