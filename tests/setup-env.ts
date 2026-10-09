/** Runs in every test worker before the test file is imported, so src/config.ts sees these values. */
import { inject } from "vitest";

const env = inject("testEnv");

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: env.databaseUrl,
  DIRECT_URL: env.databaseUrl,
  JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-32-characters",
  PRIVACY_HASH_SALT: "test-privacy-salt",
  DEMO_MODE: "true",
  ENFORCE_ENTITLEMENTS: "false",
  BLOCKCHAIN_MODE: "evm",
  BLOCKCHAIN_RPC_URL: env.rpcUrl,
  BLOCKCHAIN_CONTRACT_ADDRESS: env.contractAddress,
  BLOCKCHAIN_CHAIN_ID: String(env.chainId),
  BLOCKCHAIN_NETWORK: "hardhat-test",
  BLOCKCHAIN_PRIVATE_KEY: "",
  BLOCKCHAIN_DEPLOYMENT_FILE: ".originx-chain.test-none.json",
  // Tests vary the client IP through CF-Connecting-IP.
  BEHIND_CLOUDFLARE: "true",
  API_RATE_LIMIT: "100000",
  AUTH_RATE_LIMIT: "100000",
  VERIFY_RATE_LIMIT: "100000",
  UNKNOWN_TOKEN_LIMIT: "5",
  CLONE_SCAN_THRESHOLD: "4",
  AI_API_KEY: "",
  AI_PROVIDER: "",
});
