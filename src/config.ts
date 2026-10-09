import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const DEV_ACCESS_SECRET = "dev-access-secret-change-me-32chars";
const DEV_REFRESH_SECRET = "dev-refresh-secret-change-me-32chars";

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

/**
 * Local chain deployment written by `npm run chain:deploy`. Used only when the BLOCKCHAIN_*
 * variables are not set explicitly, so a fresh clone works with a local Hardhat node.
 */
type LocalDeployment = { rpcUrl: string; chainId: number; contractAddress: string; network: string };

function readLocalDeployment(): LocalDeployment | null {
  const file = path.resolve(process.env.BLOCKCHAIN_DEPLOYMENT_FILE ?? ".originx-chain.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as LocalDeployment;
  } catch {
    return null;
  }
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const local = readLocalDeployment();

export const config = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  /** Public origin of the web app (frontend and API share it in production: /api is proxied). */
  appUrl: process.env.APP_URL ?? "http://localhost:5173",
  /** Base URL that QR codes point at: the consumer verification page of the web app. */
  publicVerifyBaseUrl: process.env.PUBLIC_VERIFY_BASE_URL || `${process.env.APP_URL ?? "http://localhost:5173"}/verify`,
  corsOrigins: (process.env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()),
  /** Express "trust proxy" setting: e.g. "loopback" when nginx runs on the same VPS. */
  trustProxy: process.env.TRUST_PROXY ?? "loopback",
  /**
   * When true, the client IP is read from Cloudflare's CF-Connecting-IP header. Only enable this
   * when the origin firewall accepts traffic exclusively from Cloudflare IP ranges, otherwise the
   * header can be spoofed.
   */
  behindCloudflare: bool("BEHIND_CLOUDFLARE", false),
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? DEV_ACCESS_SECRET,
  jwtRefreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  /** Salt for privacy-preserving IP / user-agent hashes in logs. */
  privacySalt: process.env.PRIVACY_HASH_SALT ?? "originx-dev-privacy-salt",
  demoMode: bool("DEMO_MODE", true),
  enforceEntitlements: bool("ENFORCE_ENTITLEMENTS", false),
  blockchain: {
    /** "evm" anchors proofs on an EVM chain. "disabled" records proofs as PENDING (never faked). */
    mode: (process.env.BLOCKCHAIN_MODE ?? "evm") as "evm" | "disabled",
    rpcUrl: process.env.BLOCKCHAIN_RPC_URL || local?.rpcUrl || "",
    contractAddress: process.env.BLOCKCHAIN_CONTRACT_ADDRESS || local?.contractAddress || "",
    privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY ?? "",
    network: process.env.BLOCKCHAIN_NETWORK || local?.network || "hardhat-local",
    expectedChainId: process.env.BLOCKCHAIN_CHAIN_ID ? Number(process.env.BLOCKCHAIN_CHAIN_ID) : local?.chainId,
    confirmations: Number(process.env.BLOCKCHAIN_CONFIRMATIONS ?? 1),
    txTimeoutMs: Number(process.env.BLOCKCHAIN_TX_TIMEOUT_MS ?? 60_000),
    explorerTxUrl: process.env.BLOCKCHAIN_EXPLORER_TX_URL ?? "",
    /** Anchor every lifecycle event ("all") or only custody/recall/status-critical ones ("critical"). */
    anchorPolicy: (process.env.BLOCKCHAIN_ANCHOR_POLICY ?? "all") as "all" | "critical",
    retryIntervalMs: Number(process.env.BLOCKCHAIN_RETRY_INTERVAL_MS ?? 30_000),
  },
  verification: {
    /** Distinct scanners of one token within 24h before the token is treated as possibly cloned. */
    cloneScanThreshold: Number(process.env.CLONE_SCAN_THRESHOLD ?? 25),
    unknownTokenLimitPer10Min: Number(process.env.UNKNOWN_TOKEN_LIMIT ?? 20),
  },
  /** Outgoing email over SMTP (password reset, email verification, invitations). */
  mail: {
    host: process.env.SMTP_HOST ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    /** true = implicit TLS (port 465); false = STARTTLS upgrade (port 587, required). */
    secure: bool("SMTP_SECURE", Number(process.env.SMTP_PORT ?? 587) === 465),
    /** Refuse to send without STARTTLS (keep true in production; false only for local SMTP catchers). */
    requireTls: bool("SMTP_REQUIRE_TLS", true),
    user: process.env.SMTP_USER ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    /** e.g. "ORIGINX <no-reply@your-domain.com>" — must be a sender your SMTP provider allows. */
    from: process.env.MAIL_FROM ?? "",
    /** Optional inbox notified about new contact-form messages and organizations awaiting approval. */
    adminNotify: process.env.MAIL_ADMIN_NOTIFY ?? "",
  },
  ai: {
    provider: process.env.AI_PROVIDER ?? "",
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "claude-sonnet-5-5",
  },
};

export const isProduction = nodeEnv === "production";
export const isTest = nodeEnv === "test";

if (isProduction) {
  const problems: string[] = [];
  if (!process.env.JWT_ACCESS_SECRET || config.jwtAccessSecret === DEV_ACCESS_SECRET || config.jwtAccessSecret.length < 32) {
    problems.push("JWT_ACCESS_SECRET must be set to a random value of at least 32 characters");
  }
  if (!process.env.PRIVACY_HASH_SALT) problems.push("PRIVACY_HASH_SALT must be set");
  if (config.demoMode) problems.push("DEMO_MODE must be false in production");
  if (config.corsOrigins.includes("*")) problems.push("CORS_ORIGINS must list explicit origins in production");
  if (!process.env.DATABASE_URL) problems.push("DATABASE_URL must be set");
  if (!/^https:\/\/[^/]+$/.test(config.appUrl) || /your-domain|localhost/.test(config.appUrl)) {
    problems.push("APP_URL must be the public https origin of the app (e.g. https://originx.example.com, no trailing slash) — QR codes and email links use it");
  }
  if (!config.mail.secure && !config.mail.requireTls) problems.push("SMTP_REQUIRE_TLS must not be false in production");
  if (!config.mail.host || !config.mail.from) {
    problems.push("SMTP_HOST and MAIL_FROM must be set — password resets, email verification and invitations are delivered by email");
  }
  if (config.blockchain.mode === "evm" && !config.blockchain.privateKey) {
    problems.push("BLOCKCHAIN_PRIVATE_KEY must be set for production anchoring (or set BLOCKCHAIN_MODE=disabled)");
  }
  if (problems.length) throw new Error(`Unsafe production configuration:\n- ${problems.join("\n- ")}`);
}
