/**
 * Test infrastructure — real dependencies, nothing mocked:
 *  - PostgreSQL: the `originx_test` database from docker-compose (reset + migrated every run,
 *    including the integrity-guard triggers and RLS).
 *  - Blockchain: a fresh Hardhat node on :8546 with OriginXProofAnchor deployed.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";
import { deployAnchor } from "../scripts/deploy-contract.js";

const root = path.resolve(import.meta.dirname, "..");
const CHAIN_PORT = Number(process.env.TEST_CHAIN_PORT ?? 8546);
const RPC_URL = `http://127.0.0.1:${CHAIN_PORT}`;
/** Maintenance connection used only to CREATE/DROP the per-run database. */
const TEST_DATABASE_ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://originx:originx_local_dev@127.0.0.1:5434/originx_test";
const runDatabase = `originx_test_${Date.now()}_${randomBytes(3).toString("hex")}`;
const TEST_DATABASE_URL = (() => {
  const url = new URL(TEST_DATABASE_ADMIN_URL);
  url.pathname = `/${runDatabase}`;
  url.search = "?schema=public";
  return url.toString();
})();

let chain: ChildProcess | null = null;

async function waitForRpc(timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Hardhat node did not start on ${RPC_URL}`);
}

export async function setup(project: TestProject) {
  // 1. Database: a brand-new, uniquely named database per run (never resets existing data).
  const admin = new PrismaClient({ datasourceUrl: TEST_DATABASE_ADMIN_URL });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${runDatabase}"`);
  } catch (error) {
    await admin.$disconnect();
    throw new Error(`Could not create the test database. Is Postgres running (npm run db:up)?\n${String(error)}`);
  }
  await admin.$disconnect();
  try {
    execSync("npx prisma migrate deploy", {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DATABASE_URL },
    });
  } catch (error) {
    const e = error as { stderr?: Buffer; stdout?: Buffer };
    throw new Error(`Could not migrate the test database.\n${e.stderr?.toString() ?? ""}${e.stdout?.toString() ?? ""}`);
  }

  // 2. Blockchain
  chain = spawn(process.execPath, [path.join(root, "node_modules/hardhat/internal/cli/cli.js"), "node", "--port", String(CHAIN_PORT)], {
    cwd: root,
    stdio: "ignore",
  });
  await waitForRpc();
  const deployment = await deployAnchor({ rpcUrl: RPC_URL, network: "hardhat-test", outFile: null });

  project.provide("testEnv", {
    databaseUrl: TEST_DATABASE_URL,
    rpcUrl: RPC_URL,
    contractAddress: deployment.contractAddress,
    chainId: deployment.chainId,
  });
}

export async function teardown() {
  chain?.kill();
  // Drop only the database this run created.
  const admin = new PrismaClient({ datasourceUrl: TEST_DATABASE_ADMIN_URL });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${runDatabase}" WITH (FORCE)`).catch(() => undefined);
  await admin.$disconnect();
}

declare module "vitest" {
  export interface ProvidedContext {
    testEnv: { databaseUrl: string; rpcUrl: string; contractAddress: string; chainId: number };
  }
}
