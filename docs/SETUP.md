# Local setup

Requirements: Node.js ≥ 20 (tested on 24), Docker Desktop.

```bash
npm install                 # also generates the Prisma client
cp .env.example .env        # then set JWT_ACCESS_SECRET and PRIVACY_HASH_SALT
npm run db:up               # Postgres 17 on localhost:5434 (databases originx, originx_test)
npm run db:migrate          # apply migrations (incl. integrity triggers + RLS)
```

## Blockchain (local)

Terminal 1 — keep it running (state is in memory):
```bash
npm run chain
```
Terminal 2:
```bash
npm run chain:deploy        # deploys OriginXProofAnchor, writes .originx-chain.json
```
The API picks the deployment up automatically. If you restart the chain, redeploy and re-seed — proofs from the old chain no longer exist (the API reports this as `UNAVAILABLE`, never as valid).

## Seed, run, demo

```bash
npm run db:seed             # demo organizations, users and products (password: OriginX-Demo-2026)
npm run db:seed:inventory   # optional: additive demo inventory (SKUs, warehouses, stock, shipments)
npm run db:seed:sales-demo  # optional: sample sales + warehouse map pins for HealthPlus; local DB only
npm run dev                 # API on http://localhost:4000
npm run demo                # runs the four demo scenarios against the running API
```
Seed, reset and demo scripts only run against a `localhost` database — they refuse Supabase or any remote URL.
Without SMTP settings, emails (verification, reset, invitations) are printed to the API log; in dev the forgot-password page also shows the link directly.

To start over: `npm run db:reset` (drops and re-creates the local database, then seeds; run `npm run db:seed:inventory` again afterwards). This is destructive for the local dev database only — run it yourself; tools such as Prisma refuse to run it on an AI agent's behalf.

## Web app (all three panels)

```bash
npm --prefix web install
npm --prefix web run dev    # http://localhost:5173 — proxies /api to :4000 (same-origin cookies, as in production)
```
| URL | Panel |
|---|---|
| `/` | Public website (landing, features, pricing, security, contact, legal) |
| `/verify`, `/verify/:token` | Consumer verification (no login; QR codes encode `APP_URL/verify/<token>`) |
| `/sign-in`, `/sign-up` | Organization accounts → `/app` (organization panel, incl. Inventory) |
| `/admin` | Platform console (accounts with a platform role, e.g. seeded `admin@originx.local`) |

`npm --prefix web run build` type-checks and writes `web/dist/` (served by nginx in production — see DEPLOYMENT.md).

## Tests

```bash
npm test
```
Needs Docker Postgres running (backend suite; the web app is checked with `npm --prefix web run typecheck`). Each run creates its own temporary database (`originx_test_<id>`), migrates it, starts its own Hardhat node on :8546, and removes the database afterwards. Nothing is mocked.

## Useful scripts

| Script | Purpose |
|---|---|
| `npm run typecheck` / `npm run build` | TypeScript check / compile to `dist/` |
| `npm run contract:compile` | Recompile the Solidity contract artifact |
| `npm run anchor:pending` | (after build) anchor every PENDING proof |
| `npm run admin:create` | (after build) create the first SUPER_ADMIN from `ADMIN_EMAIL`/`ADMIN_PASSWORD` |
