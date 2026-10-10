# ORIGINX — Remaining work

Updated 2026-10-10 from the current repository state. This is a delivery queue, not a list of missing screens: sales monitoring, warehouse coordinates/map pins, the super-admin network map, and local demo seeds are already implemented.

## P0 — Restore and verify the live deployment

The VPS already runs host Nginx on ports 80 and 443. The Origin X web container cannot publish those same ports; the observed result was a failed web container and public `/ready` returning 502. Keep the existing sites untouched and bind Origin X to loopback ports instead:

```dotenv
ORIGINX_HTTP_BIND=127.0.0.1:8080
ORIGINX_HTTPS_BIND=127.0.0.1:8443
```

Then configure a dedicated host-Nginx server block for `originx.armedias.com` to proxy to `http://127.0.0.1:8080` (HTTP) or `https://127.0.0.1:8443` (if using the container's TLS listener). Since host Nginx already terminates TLS for other domains, the simplest setup is host TLS termination and proxying to the container's HTTP listener. Do not reload Nginx until `nginx -t` succeeds. Deploy/recreate the stack, then verify:

```bash
docker compose -f docker-compose.prod.yml ps
curl -i http://127.0.0.1:8080/ready
curl -i https://originx.armedias.com/ready
```

Expected: both web/API containers healthy and `/ready` returns HTTP 200. Run this before creating demo organizations or troubleshooting UI behavior; a 502 is a routing/container issue, not a frontend issue. See [DEPLOYMENT.md](DEPLOYMENT.md).

## P1 — Validate the real release data and workflows

- Confirm the production migration completed and the organization owner can sign in.
- Create a real warehouse with its address and map pin; confirm it appears in the organization map and super-admin network map.
- Create a SKU and opening balance, record a priced sale, then confirm available stock decreases and the sales chart, order count, currency totals, and product ranking update.
- Validate role permissions: users without dispatch permission must not be able to record a sale; non-super-admins must not see cross-tenant inventory.
- Keep test/demo data in a local development database. Production intentionally refuses demo seeding; bootstrap the actual super-admin with the documented CLI and create a normal test organization through signup only if the owner explicitly wants a real production test tenant.

## P2 — Finish blockchain production readiness

The on-chain contract, identity/event/status anchors, retry worker, and proof verification are implemented. We are proceeding with **Polygon Amoy testnet** (chain ID 80002) as the pilot target; no mainnet deployment or real-fund spend is authorized by that assumption. Before treating proofs as production-grade:

- Choose the target chain (keep Amoy for the pilot, or explicitly select a mainnet). Mainnet deployment consumes real funds and old Amoy proofs remain on Amoy; never relabel or silently migrate them.
- Deploy the contract to the chosen chain, record its address and deployment transaction, and configure a dedicated funded relayer key, expected chain ID, RPC endpoint, explorer URL and confirmation depth.
- Confirm the relayer is authorized by the contract owner; verify one new identity, lifecycle event and recall/status change against the target chain explorer and the public verification page.
- Monitor `PENDING`/`FAILED` proof counts and RPC health. Admins can now manually retry exhausted proofs; the current worker has one configured RPC endpoint, so add provider failover/alerting before relying on it for a high-availability production SLA.
- Back up the contract address, chain ID, deployment transaction and owner-key recovery procedure. The owner key can authorize/revoke anchorers; the relayer key should be isolated and hold only required gas funds.

The proof verifier checks event type and full event arguments (including exact status code), and refuses to compare a proof against a different configured contract. Broadcast transaction hashes are persisted before waiting for confirmation, so retries resume the same transaction rather than issuing duplicates. Production startup now rejects incomplete or malformed EVM settings. Backend typecheck/build pass; the integration regression test is added but could not run here because local PostgreSQL/Docker is unavailable.

## P3 — Complete sales lifecycle (product decision needed before implementation)

Current sales records snapshot customer/reference, SKU, quantity, unit price, currency and line total; each sale commits stock dispatch and provenance together. The next meaningful accounting features are sale cancellation/returns with stock-restoration ledger entries and an audit trail, followed by invoice numbering/PDF and tax/discount fields. Define whether a return is full or line-level, who may approve it, and how taxes/discounts are represented before changing the financial model.

## P4 — Production operations and scale

- Verify SMTP delivery end-to-end for account verification, password reset and invitations. Production startup already requires SMTP configuration.
- Add centralized error/uptime alerting and rehearse a database restore.
- Add Redis-backed rate-limit and enumeration counters before running multiple API instances; current counters are per-process memory.
- Integrate a billing provider before enabling paid subscription collection; entitlement checks already exist.

## P5 — Optional chain-cost optimization

Merkle batching for blockchain anchors is optional and should wait until transaction volume and target-chain costs justify its added proof workflow.

## Current data boundary

Revenue means recorded completed sales, not recognized accounting revenue. Totals stay separated by currency; there is no FX conversion. The system is an inventory/provenance platform, not yet an invoicing or tax-compliance system. Demo datasets are seeded locally by `npm run db:seed:inventory` and `npm run db:seed:sales-demo`; never run those against production.
