# Production deployment — Supabase + Hostinger VPS + Cloudflare

```
Browser / QR scan ──HTTPS──> Cloudflare (DNS proxy, TLS, WAF, rate rule)
                               │  TLS (Origin Certificate, Full strict)
                               ▼
                    Hostinger VPS ── UFW: 443 only from Cloudflare
                    ├─ originx-web container (nginx 443: React app + /api proxy, strict CSP)
                    └─ originx-api container (4000, read-only, non-root)
                               │ TLS
                               ▼
                    Supabase Postgres (pooler 6543 runtime, 5432 migrations)
                               │
                    Anchoring wallet ──> Polygon Amoy (EVM testnet) — OriginXProofAnchor
```

## 1. Supabase
1. Create a project (region close to the VPS). Note the database password.
2. Project Settings → Database → Connection string:
   - **Transaction pooler** (6543) → `DATABASE_URL` (append `?pgbouncer=true&connection_limit=5&sslmode=require`)
   - **Session pooler / direct** (5432) → `DIRECT_URL` (append `?sslmode=require`)
3. Nothing else: the container applies migrations on start. Migration `integrity_guards` enables RLS on every table and revokes Supabase API roles, so the auto-generated REST API exposes no ORIGINX data. Verify in Supabase → Advisors (no "RLS disabled" warnings).

## 2. Blockchain (live: Ethereum Hoodi testnet)
Live deployment: contract `0xc2Db7e9692F8048841A23Cf4CE6f3c5f313464b4` on Hoodi (chain 560048), source verified on Sourcify. Any EVM chain works the same way (Polygon Amoy, Sepolia, …) — only the `BLOCKCHAIN_*` values change.
1. Use a **dedicated** wallet holding test funds only (0x-prefixed key in `BLOCKCHAIN_PRIVATE_KEY`; never a wallet with real money). Fund it with test ETH from the [Hoodi PoW faucet](https://hoodi-faucet.pk910.de). Sepolia's PoW faucet can't fund brand-new wallets (a first transfer needs ~207k gas there; the faucet sends 30k).
2. Keep `BLOCKCHAIN_MODE=disabled` and deploy from inside the API image (checks the chain ID, refuses to redeploy, verifies owner/anchorer on-chain):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm api node dist/cli/deploy-contract.js
   ```
   Run the `sed` line it prints (sets `BLOCKCHAIN_CONTRACT_ADDRESS`, switches to `evm`), then `docker compose -f docker-compose.prod.yml up -d --force-recreate api`.
3. `BLOCKCHAIN_ANCHOR_POLICY=critical` anchors registration, QA, custody, delivery, recall and status events (the hash chain covers the events in between). Proofs are confirmed by exactly one submitter: the background worker only retries proofs idle for longer than `BLOCKCHAIN_TX_TIMEOUT_MS` + 30 s, and confirmed proofs are never rewritten.

### 2a. Alternative: self-hosted private chain (no faucet, no money)
Runs the same `OriginXProofAnchor` contract on an Anvil node inside the Docker stack (`chain` service, profile `private-chain`). It is reachable only by the API (no published ports) and its state is saved to the `originx-chain-data` volume every 10 s and on shutdown, so proofs survive restarts and redeploys. Proofs are real contract transactions, but nobody outside the server can check them on an explorer — use Amoy when public verifiability matters.

1. Project `.env` (Compose interpolation file, next to `docker-compose.prod.yml`): add `COMPOSE_PROFILES=private-chain`.
2. `.env.production`: `BLOCKCHAIN_MODE=disabled`, `BLOCKCHAIN_PRIVATE_CHAIN=true`, `BLOCKCHAIN_NETWORK=originx-private`, `BLOCKCHAIN_CHAIN_ID=31337`, `BLOCKCHAIN_RPC_URL=http://chain:8545`, `BLOCKCHAIN_CONFIRMATIONS=1`, `BLOCKCHAIN_EXPLORER_TX_URL=` (empty), and a `0x`-prefixed `BLOCKCHAIN_PRIVATE_KEY`.
3. Start the chain: `docker compose -f docker-compose.prod.yml up -d chain`.
4. Deploy (funds the wallet with private-chain gas automatically; safe to re-run): `docker compose -f docker-compose.prod.yml run --rm api node dist/cli/deploy-contract.js`, then run the `sed` line it prints and `docker compose -f docker-compose.prod.yml up -d --force-recreate api`.
5. Back up the volume occasionally: `docker run --rm -v originx_originx-chain-data:/d -v "$PWD":/b alpine cp /d/state.json /b/chain-state.backup.json`.

The same `deploy-contract.js` CLI also deploys to Amoy (without `BLOCKCHAIN_PRIVATE_CHAIN`); there it requires test POL in the wallet. Moving from the private chain to Amoy later means a new contract address; proofs already anchored on the private chain are not migrated or relabelled.

## 2b. Email (SMTP)
Password resets, email verification and team invitations are sent by email; the API refuses to start in production without SMTP.
1. Pick a provider: Hostinger Mail (`smtp.hostinger.com`, port 465), Resend (`smtp.resend.com`, 465, user `resend`, password = API key), Brevo (`smtp-relay.brevo.com`, 587), or Amazon SES.
2. Verify your sending domain with the provider and add its SPF / DKIM (and a DMARC) record in Cloudflare DNS (DNS only, not proxied).
3. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` (e.g. `ORIGINX <no-reply@your-domain.com>`) and optionally `MAIL_ADMIN_NOTIFY` (gets "organization awaiting approval" and contact-form alerts).
4. After start, the log line `ORIGINX API started` shows `"email":{"configured":true,"ok":true}`; `ok:false` includes the SMTP error.

### 2c. Accounts, email verification and bot protection
- **Email verification** is a 6-digit code (10 min, single use, 5 wrong tries lock it, 60 s resend cooldown). Email sign-ups enter it before creating an organization; Google sign-ups are already verified by Google (only Google-verified addresses are accepted).
- **Google Sign-In:** in Google Cloud → Credentials, the OAuth client must list `https://<your domain>` under *Authorized JavaScript origins*, and the OAuth consent screen must be **Published** (in "Testing" only listed test users can sign in).
- **Cloudflare Turnstile** (free, no DNS move needed): Cloudflare dashboard → *Turnstile* → *Add widget* → hostname = your domain, widget mode *Managed* → put the site key and secret in `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`. Sign-in, sign-up, password reset and the contact form then require the check; tokens are verified server-side with Cloudflare (action- and hostname-bound). The web app reads the site key at runtime from `GET /api/v1/site/config`, so no rebuild is needed.
- **Website chatbot:** a local keyword rule engine (no AI API key, no cost); answers only from ORIGINX-authored snippets, never echoes visitor text; rate-limited per visitor (`CHAT_RATE_LIMIT`, default 20 / 10 min), questions capped at 1000 characters.

### 2d. Demo tenants for presentations
`docker compose -f docker-compose.prod.yml run --rm -e SHOWCASE_PASSWORD='…' api node dist/cli/seed-showcase.js --confirm` creates six clearly labelled "(Demo)" organizations through the real services (verified lifecycle, recall, counterfeit collision, stock, shipments, sales, scans). It resumes safely if interrupted and prints all logins and verification links. Suspend the "(Demo)" organizations in the admin console when no longer needed.

## 3. Hostinger VPS (Ubuntu)
```bash
# Docker
curl -fsSL https://get.docker.com | sh
# Firewall: SSH from your IP; web only from Cloudflare
ufw default deny incoming && ufw allow from <your-ip> to any port 22
for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do ufw allow from $ip to any port 443 proto tcp; ufw allow from $ip to any port 80 proto tcp; done
ufw enable
```
Note: Docker-published ports can bypass UFW rules; on the VPS also restrict at Hostinger's panel firewall (allow 443/80 from Cloudflare ranges) or use `ufw-docker`.

Deploy the code (git clone or rsync), then:
```bash
cp .env.production.example .env.production && chmod 600 .env.production   # fill in every value
# Cloudflare origin certificate → deploy/certs/origin.pem and deploy/certs/origin.key (chmod 600)
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api      # look for "ORIGINX API started" with blockchain.available=true
# The `web` service builds web/ into nginx (deploy/nginx/Dockerfile) and serves it with /api proxied to the API.
docker compose -f docker-compose.prod.yml exec -e ADMIN_EMAIL=you@company.com -e ADMIN_PASSWORD='<long random>' api node dist/cli/create-admin.js
```

### Existing host Nginx already owns ports 80/443

Do not stop or replace host Nginx: it may be serving other domains. Set these Compose interpolation values so the web container publishes only loopback ports:

```dotenv
ORIGINX_HTTP_BIND=127.0.0.1:8080
ORIGINX_HTTPS_BIND=127.0.0.1:8443
```

Compose does **not** read port interpolation values from the service's `.env.production` `env_file`. Pass them in the shell for each Compose invocation (as shown below), or place them in the project `.env` file. Keep blockchain and application secrets in `.env.production`.

Configure a separate host-Nginx virtual host for the Origin X hostname, retaining its existing certificate/TLS setup, with `proxy_pass http://127.0.0.1:8080;` and the usual forwarded headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`). Validate the new config with `nginx -t` before reloading. Do not reuse another site's `server_name` or remove its config. Recreate the app with `ORIGINX_HTTP_BIND=127.0.0.1:8080 ORIGINX_HTTPS_BIND=127.0.0.1:8443 docker compose -f docker-compose.prod.yml up -d --build`, then check `curl -i http://127.0.0.1:8080/ready` and `curl -i https://<originx-hostname>/ready`; both should return 200. The HTTPS container listener is available on loopback port 8443 if a deployment specifically needs TLS between host Nginx and the container.

## 4. Cloudflare proxy (optional, free plan)
Turnstile (2c) works without this. Proxying the whole domain through Cloudflare adds DDoS protection and a WAF, but moves DNS for the entire domain: import **every** existing record first (MX/SPF/DMARC for mail, the Resend `send`/`rsend`/`resend._domainkey` records, other sites' A records) and keep mail records *DNS only* (grey cloud). After switching, set `BEHIND_CLOUDFLARE: "true"` only once the origin firewall admits Cloudflare's IP ranges only.
1. Add the domain; DNS `A @ → <VPS IP>` (and `www` if wanted), **Proxied** (orange cloud). The web app and API share this origin (`https://your-domain.com`, API under `/api/v1`); set `APP_URL=https://your-domain.com` (QR codes point to `APP_URL/verify/<token>`) and `CORS_ORIGINS` to the same origin.
2. SSL/TLS → **Full (strict)**; Edge Certificates → Always Use HTTPS, min TLS 1.2.
3. SSL/TLS → Origin Server → create certificate → save as `deploy/certs/origin.pem` / `origin.key`.
4. Security → WAF → managed rules on; Bot Fight Mode on.
5. Security → WAF → Rate limiting rule (1 free): URI path starts with `/api/v1/auth/` → 20 requests / 10 s → block.
6. Caching: add a Cache Rule "bypass cache" for URI path starts with `/api/`. Static files under `/assets/` are fingerprinted and sent `immutable` — Cloudflare may cache them; `index.html` is `no-cache` so deploys apply immediately.

## 5. Operations
| Task | Command |
|---|---|
| Update | `git pull && docker compose -f docker-compose.prod.yml up -d --build` (migrations run automatically) |
| Health | `curl https://your-domain.com/ready` |
| Retry anchoring | `docker compose -f docker-compose.prod.yml exec api node dist/cli/anchor-pending.js` (the API also retries every 30 s) |
| Logs | JSON lines: `docker compose -f docker-compose.prod.yml logs api` |
| Backups | Supabase automatic backups / PITR |

The server refuses to start in production with missing/default secrets, `DEMO_MODE=true`, wildcard CORS, a non-https or placeholder `APP_URL`, no SMTP, or EVM mode without a key.

**No demo data in production.** `db:seed`, `db:seed:inventory`, `db:reset` and `demo` refuse to run unless `DATABASE_URL` points at `localhost` (and `NODE_ENV` is not production); the production image does not even contain the TypeScript tooling to run them. The only production bootstrap is `create-admin`. Demo tooling in the web app (the tamper button, demo reset links) is compiled out of production builds.
