# ORIGINX Demo Script

Preparation (once): `npm run db:up`, `npm run chain` (separate terminal), `npm run chain:deploy`, `npm run db:reset`, `npm run dev`.
Then `npm run demo` runs everything below live, or `npm run demo -- <n>` for one scenario. Scenarios 2–4 change data; `npm run db:reset` restores it.

All demo accounts: password `OriginX-Demo-2026`.

## Scenario 1 — Normal (Vaccine Batch A92)
"An ABC Pharma vaccine moved Manufacturer → SwiftLogix → MetroCare Warehouse → HealthPlus Retail. A consumer scans the QR."

Open `GET /api/v1/verify/<A92 token>` (printed by the seed, also in `.originx-demo.json`). Expected:
- **HISTORY_VERIFIED** — "Lifecycle history cryptographically verified."
- Brand ABC Pharma ✓ verified · Origin Delhi, India · batch A92
- **Trust 100/100 EXCELLENT** · History **8/8** events verified · Blockchain **VERIFIED, 8/8** anchored events
- Each lifecycle step shows its event hash and the transaction hash on-chain.

Talking point: every step was accepted by the receiving company (two-party custody), hashed into a chain, and anchored on a blockchain — the consumer verifies all of it without an account.

## Scenario 2 — Tampering
Log in as `owner@abcpharma.local`, then `POST /api/v1/products/<A93 id>/demo/tamper {"mode":"naive","sequence":3}`.
- History **COMPROMISED**: event #3 stored hash ≠ recomputed hash; events #3–#5 marked affected; trust drops to 0 (HIGH_RISK); a CRITICAL `TAMPERED_RECORD` incident opens; consumer sees **HISTORY_COMPROMISED**.

Then the strong attacker: `{"mode":"rewrite","sequence":3}` on A94 — event #3 is edited **and every downstream hash is recomputed**, so the database chain is perfectly consistent (`databaseChainLooksValid: true`).
- The blockchain still holds the original hashes → `HASH_MISMATCH` for #3–#5, `INVALID_PROOF` penalty, `INVALID_BLOCKCHAIN_PROOF` incident.

Talking point: this is *why* the blockchain exists in ORIGINX — a hash chain alone can be rewritten by whoever controls the database; the public anchor cannot.

## Scenario 3 — Counterfeit
Log in as `owner@shadow.local` (unverified "Shadow Pharma Traders") and register the A92 identity: `POST /api/v1/products {"productCode":"RX-29481","serialNumber":"A92-000417", ...}`.
- Response: `collision.code = IDENTITY_COLLISION`, product **QUARANTINED**, identity **COUNTERFEIT** — no ABC Pharma data revealed.
- Scanning the clone's QR → **COUNTERFEIT**: "This product identity conflicts with an existing registered product." Trust 0.
- ABC Pharma receives a HIGH incident naming the claimant; the genuine product stays verified (with a consumer warning that a clone attempt exists).

## Scenario 4 — Recall
Scan Glucora insulin pen batch C7 → **HISTORY_VERIFIED**. As ABC Pharma: `POST /api/v1/recalls {"productId":"<C7 id>","reason":"Potency below specification","initiate":true}`. Scan again:
- **⚠ RECALLED** — "Product identity verified, but this product has been RECALLED." (never "verified ✓")
- The RECALLED status is also written on-chain, so it cannot be quietly removed from the database.

## Bonus
- Admin panel: `admin@originx.local` → `GET /api/v1/admin/dashboard`, `/platform-metrics`, approve `NovaMed Distributors`.
- ASK ORIGINX: `POST /api/v1/products/<id>/ask {"question":"Why did the trust score drop?"}` — answers only from verified facts.
- Tenant isolation: XYZ Electronics (`owner@xyz.local`) gets 404 on any ABC Pharma product.
