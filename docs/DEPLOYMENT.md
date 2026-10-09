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

## 2. Blockchain (Polygon Amoy testnet)
1. Create a **dedicated** wallet for anchoring (never a personal wallet). Fund it with test POL from a Polygon Amoy faucet.
2. On your machine (key only in the shell environment):
   ```bash
   BLOCKCHAIN_RPC_URL=https://rpc-amoy.polygon.technology BLOCKCHAIN_PRIVATE_KEY=0x... BLOCKCHAIN_NETWORK=polygon-amoy npm run chain:deploy
   ```
   Copy `contractAddress` from the output into `.env.production`.
3. Transactions are viewable at `https://amoy.polygonscan.com/tx/<hash>` (`BLOCKCHAIN_EXPLORER_TX_URL`).
   `BLOCKCHAIN_ANCHOR_POLICY=critical` anchors registration, QA, custody, delivery, recall and status events (the hash chain covers the events in between).

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

## 4. Cloudflare (free plan)
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

The server refuses to start in production with missing/default secrets, `DEMO_MODE=true`, wildcard CORS, or EVM mode without a key.
