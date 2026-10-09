# ORIGINX

**The Verifiable Identity Layer for Physical Products** — a multi-tenant SaaS that gives every product a Digital Product Passport and a tamper-evident, blockchain-anchored lifecycle that anyone can verify by scanning a QR code.

IDENTIFY → VERIFY → DETECT → EXPLAIN → RESPOND

- **Three surfaces, one API**: ORIGINX Admin console, Organization panel, public Consumer verification — plus the public website (React web app in `web/`).
- **Cryptographic event chain**: every lifecycle event is SHA-256 linked to the previous one; edits, deletions and re-hashing are detected.
- **Real blockchain anchoring**: identities, events and recall statuses are anchored on an EVM chain (`OriginXProofAnchor`); proofs are verified by reading the chain back. No chain ⇒ PENDING, never faked.
- **Two-party custody transfers**, supply-chain partnerships, **trust score engine**, **incidents**, **recalls**, **counterfeit / identity-collision detection**, cloned-QR detection, append-only audit.
- **Inventory layer**: SKU catalogue, warehouses, an append-only stock ledger (row-locked, idempotent), inter-organization shipments with partial receipt, recall quarantine across every holder — linked to batch passports and anchored provenance events.
- **Production-ready**: PostgreSQL/Supabase with DB-enforced immutability and RLS, Docker image, nginx + Cloudflare deployment, production config guards.

```bash
npm install && cp .env.example .env     # set JWT_ACCESS_SECRET, PRIVACY_HASH_SALT
npm run db:up && npm run db:migrate
npm run chain            # separate terminal
npm run chain:deploy && npm run db:seed && npm run db:seed:inventory && npm run dev
npm --prefix web install && npm --prefix web run dev   # web app on http://localhost:5173
npm run demo             # the four demo scenarios, live
npm test                 # 82 tests on real Postgres + a real chain
```

Docs: [Implementation plan](docs/IMPLEMENTATION_PLAN.md) · [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md) · [Security](docs/SECURITY.md) · [Setup](docs/SETUP.md) · [Deployment](docs/DEPLOYMENT.md) · [Demo script](docs/DEMO_SCRIPT.md) · [Inventory](docs/INVENTORY_MANAGEMENT.md) · [Inventory integration plan](docs/INVENTORY_INTEGRATION_PLAN.md)
