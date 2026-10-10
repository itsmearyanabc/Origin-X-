/**
 * BlockchainService — anchors ORIGINX proofs on an EVM chain via the OriginXProofAnchor contract.
 *
 * Guarantees:
 *  - Only 32-byte hashes go on-chain (identity hash, event hash, status digest). Never product
 *    history, organization data or documents.
 *  - A proof only ever carries a transaction hash returned by the chain. If the chain is not
 *    configured or unreachable, the proof stays PENDING with no transaction hash and is retried by
 *    the anchor worker — nothing is faked.
 *  - Verification reads the contract state back from the chain and compares it with the database.
 */
import fs from "node:fs";
import path from "node:path";
import { Contract, Interface, JsonRpcProvider, Network, Wallet, type ContractRunner, type ContractTransactionResponse, type Signer, type TransactionReceipt } from "ethers";
import { config } from "../config.js";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { CHAIN_IDENTITY_STATUS, type IdentityStatus } from "../lib/constants.js";
import { fromBytes32, statusChangeDigest, toBytes32 } from "../lib/crypto.js";
import type { BlockchainProof, Prisma } from "@prisma/client";

const artifactPath = path.resolve(import.meta.dirname, "../../contracts/artifacts/OriginXProofAnchor.json");
export const anchorArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { abi: unknown[]; bytecode: string };
const anchorInterface = new Interface(anchorArtifact.abi as never);

const LOCAL_CHAIN_IDS = new Set([31337, 1337]);
const MAX_ATTEMPTS = 10;
/** Contract errors that will never succeed on retry. */
const PERMANENT_ERRORS = new Set(["IdentityAlreadyRegistered", "EventAlreadyAnchored", "EmptyHash", "InvalidStatus", "NotAnchorer"]);

export type ChainStatus = {
  mode: "evm" | "disabled";
  configured: boolean;
  available: boolean;
  network: string;
  chainId: number | null;
  contractAddress: string | null;
  anchorer: string | null;
  latestBlock: number | null;
  onChainIdentityCount: number | null;
  onChainEventCount: number | null;
  isLocalDevChain: boolean;
  reason?: string;
};

export type OnChainEvent = { exists: boolean; identityHash: string | null; anchoredAt: number | null };
export type OnChainIdentity = { exists: boolean; registeredAt: number | null; status: number | null; registrar: string | null };

type Connection = { provider: JsonRpcProvider; contract: Contract; signer: Signer; chainId: number; anchorer: string };

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function describeError(error: unknown): { name: string; message: string } {
  const e = error as { revert?: { name?: string }; data?: string; shortMessage?: string; message?: string; info?: { error?: { data?: string } } };
  if (e?.revert?.name) return { name: e.revert.name, message: e.revert.name };
  const data = e?.data ?? e?.info?.error?.data;
  if (typeof data === "string" && data.startsWith("0x")) {
    try {
      const parsed = anchorInterface.parseError(data);
      if (parsed) return { name: parsed.name, message: parsed.name };
    } catch {
      // not a contract error
    }
  }
  const message = (e?.shortMessage ?? e?.message ?? String(error)).slice(0, 300);
  return { name: "RPC_ERROR", message };
}

export class BlockchainService {
  private connection: Connection | null = null;
  private connecting: Promise<Connection | null> | null = null;
  private lastFailureAt = 0;
  private lastFailureReason = "";
  private txQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly settings = config.blockchain) {}

  isConfigured(): boolean {
    return this.settings.mode === "evm" && Boolean(this.settings.rpcUrl && this.settings.contractAddress);
  }

  networkName(): string {
    return this.isConfigured() ? this.settings.network : "not-configured";
  }

  explorerUrl(txHash: string | null | undefined): string | null {
    if (!txHash || !this.settings.explorerTxUrl) return null;
    return `${this.settings.explorerTxUrl.replace(/\/$/, "")}/${txHash}`;
  }

  /** Resets the cached connection (used by tests and after RPC failures). */
  reset() {
    this.connection?.provider.destroy();
    this.connection = null;
    this.connecting = null;
    this.lastFailureAt = 0;
  }

  private async rawChainId(): Promise<number> {
    const res = await withTimeout(
      fetch(this.settings.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      }),
      3_000,
      "eth_chainId",
    );
    const body = (await res.json()) as { result?: string };
    if (!body.result) throw new Error("RPC did not return a chain id");
    return Number(BigInt(body.result));
  }

  private async connect(): Promise<Connection | null> {
    if (!this.isConfigured()) return null;
    if (this.connection) return this.connection;
    // Back off for 5s after a failure so a down RPC doesn't slow every request.
    if (Date.now() - this.lastFailureAt < 5_000) return null;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      try {
        const chainId = await this.rawChainId();
        if (this.settings.expectedChainId && chainId !== this.settings.expectedChainId) {
          throw new Error(`Connected chain id ${chainId} does not match BLOCKCHAIN_CHAIN_ID ${this.settings.expectedChainId}`);
        }
        const network = Network.from({ chainId, name: this.settings.network });
        const provider = new JsonRpcProvider(this.settings.rpcUrl, network, { staticNetwork: network, polling: true, pollingInterval: 250 });
        const code = await withTimeout(provider.getCode(this.settings.contractAddress), 5_000, "getCode");
        if (code === "0x") {
          provider.destroy();
          throw new Error(
            `No OriginXProofAnchor contract at ${this.settings.contractAddress} on chain ${chainId}. ` +
              "If this is a local Hardhat chain that was restarted, run `npm run chain:deploy` and `npm run db:reset`.",
          );
        }
        let signer: Signer;
        if (this.settings.privateKey) {
          signer = new Wallet(this.settings.privateKey, provider);
        } else if (LOCAL_CHAIN_IDS.has(chainId)) {
          // Local development chain: use the node's first unlocked account (no key handled by the app).
          signer = await provider.getSigner(0);
        } else {
          provider.destroy();
          throw new Error("BLOCKCHAIN_PRIVATE_KEY is required for non-local chains.");
        }
        const anchorer = await signer.getAddress();
        const contract = new Contract(this.settings.contractAddress, anchorArtifact.abi as never, signer as ContractRunner);
        this.connection = { provider, contract, signer, chainId, anchorer };
        return this.connection;
      } catch (error) {
        this.lastFailureAt = Date.now();
        this.lastFailureReason = describeError(error).message;
        return null;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  async status(): Promise<ChainStatus> {
    const base: ChainStatus = {
      mode: this.settings.mode,
      configured: this.isConfigured(),
      available: false,
      network: this.networkName(),
      chainId: null,
      contractAddress: this.settings.contractAddress || null,
      anchorer: null,
      latestBlock: null,
      onChainIdentityCount: null,
      onChainEventCount: null,
      isLocalDevChain: false,
    };
    if (!base.configured) {
      return { ...base, reason: "Blockchain anchoring is not configured. Proofs are recorded as PENDING and anchored once a chain is configured." };
    }
    const conn = await this.connect();
    if (!conn) return { ...base, reason: this.lastFailureReason || "Blockchain RPC unavailable." };
    try {
      const [latestBlock, identities, events] = await withTimeout(
        Promise.all([
          conn.provider.getBlockNumber(),
          conn.contract.getFunction("identityCount")() as Promise<bigint>,
          conn.contract.getFunction("eventCount")() as Promise<bigint>,
        ]),
        5_000,
        "status",
      );
      return {
        ...base,
        available: true,
        chainId: conn.chainId,
        anchorer: conn.anchorer,
        latestBlock,
        onChainIdentityCount: Number(identities),
        onChainEventCount: Number(events),
        isLocalDevChain: LOCAL_CHAIN_IDS.has(conn.chainId),
      };
    } catch (error) {
      this.reset();
      this.lastFailureAt = Date.now();
      return { ...base, reason: describeError(error).message };
    }
  }

  // -------------------------------------------------------------------------
  // Proof creation
  // -------------------------------------------------------------------------

  async registerProductIdentity(productId: string, identityHash: string) {
    const proof = await prisma.blockchainProof.create({
      data: {
        productId,
        kind: "IDENTITY",
        network: this.networkName(),
        eventHash: identityHash,
        identityHash,
        timestamp: new Date(),
        status: "PENDING",
      },
    });
    return this.submit(proof);
  }

  async anchorEventProof(productId: string, eventId: string, eventHash: string, identityHash: string) {
    const proof = await prisma.blockchainProof.create({
      data: {
        productId,
        eventId,
        kind: "EVENT",
        network: this.networkName(),
        eventHash,
        identityHash,
        timestamp: new Date(),
        status: "PENDING",
      },
    });
    await prisma.productEvent.update({
      where: { id: eventId },
      data: { blockchainProofId: proof.id, verificationStatus: "PENDING_ANCHOR" },
    });
    return this.submit(proof);
  }

  /** Anchors an identity status change (e.g. RECALLED) so it is publicly visible and cannot be silently reverted. */
  async anchorIdentityStatus(productId: string, identityHash: string, status: IdentityStatus) {
    const proof = await prisma.blockchainProof.create({
      data: {
        productId,
        kind: "STATUS",
        network: this.networkName(),
        eventHash: statusChangeDigest(identityHash, status, `${Date.now()}`),
        identityHash,
        statusCode: CHAIN_IDENTITY_STATUS[status],
        timestamp: new Date(),
        status: "PENDING",
      },
    });
    return this.submit(proof);
  }

  /** Submits a PENDING proof. Transactions are serialized to keep nonces ordered. */
  private submit(proof: BlockchainProof): Promise<BlockchainProof> {
    const run = this.txQueue.then(() => this.submitNow(proof));
    this.txQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * Updates a proof only while it is still PENDING. Another submitter (the background worker, a
   * CLI, or a second API instance) may have confirmed it meanwhile; confirmed proofs are immutable
   * at the database level, so we never touch them and simply return the current row.
   */
  private async updatePending(id: string, data: Prisma.BlockchainProofUpdateManyMutationInput): Promise<{ proof: BlockchainProof; applied: boolean }> {
    const { count } = await prisma.blockchainProof.updateMany({ where: { id, status: "PENDING" }, data });
    return { proof: await prisma.blockchainProof.findUniqueOrThrow({ where: { id } }), applied: count === 1 };
  }

  private async submitNow(queued: BlockchainProof): Promise<BlockchainProof> {
    // Re-read: the caller's copy may be stale (e.g. the worker listed it before another submit ran).
    const proof = await prisma.blockchainProof.findUnique({ where: { id: queued.id } });
    if (!proof || proof.status !== "PENDING") return proof ?? queued;
    const conn = await this.connect();
    if (!conn) return proof; // stays PENDING; the worker retries later

    try {
      let transactionHash = proof.transactionHash;
      let receipt: TransactionReceipt | null;

      if (transactionHash) {
        // A prior attempt may have broadcast successfully and then timed out waiting for RPC
        // confirmation. Resume that exact transaction; never blindly submit a duplicate.
        receipt = await withTimeout(
          conn.provider.waitForTransaction(transactionHash, this.settings.confirmations),
          this.settings.txTimeoutMs,
          "transaction confirmation",
        );
        if (!receipt) return proof; // still pending: leave its hash attached and check next cycle
        if (receipt.status !== 1) {
          return (await this.updatePending(proof.id, { transactionHash: null, attempts: proof.attempts + 1, lastError: "RPC_ERROR: Previously broadcast transaction reverted." })).proof;
        }
      } else {
        const identity = toBytes32(proof.identityHash ?? proof.eventHash);
        let tx: ContractTransactionResponse;
        if (proof.kind === "IDENTITY") {
          tx = await conn.contract.getFunction("registerProductIdentity")(identity);
        } else if (proof.kind === "EVENT") {
          tx = await conn.contract.getFunction("anchorEventProof")(toBytes32(proof.eventHash), identity);
        } else {
          tx = await conn.contract.getFunction("setIdentityStatus")(identity, proof.statusCode ?? 0);
        }
        transactionHash = tx.hash;
        // Persist as soon as the signer returns the broadcast hash. A later timeout can now
        // recover by polling this transaction instead of issuing the operation a second time.
        await this.updatePending(proof.id, { transactionHash, chainId: conn.chainId, contractAddress: this.settings.contractAddress, network: this.settings.network });
        receipt = await withTimeout(tx.wait(this.settings.confirmations), this.settings.txTimeoutMs, "transaction confirmation");
      }
      if (!receipt || receipt.status !== 1) throw new Error("Transaction reverted");

      const { proof: confirmed, applied } = await this.updatePending(proof.id, {
        status: "CONFIRMED",
        network: this.settings.network,
        chainId: conn.chainId,
        contractAddress: this.settings.contractAddress,
        transactionHash: transactionHash ?? receipt.hash,
        blockNumber: receipt.blockNumber,
        confirmedAt: new Date(),
        attempts: proof.attempts + 1,
        lastError: null,
      });
      if (!applied) return confirmed; // another submitter confirmed it first and ran the follow-ups
      if (confirmed.kind === "EVENT" && confirmed.eventId) {
        await prisma.productEvent.update({ where: { id: confirmed.eventId }, data: { verificationStatus: "ANCHORED" } });
      }
      if (confirmed.kind === "IDENTITY") {
        await prisma.productIdentity.updateMany({
          where: { productId: confirmed.productId, identityHash: confirmed.eventHash },
          data: { blockchainIdentity: confirmed.transactionHash },
        });
        await prisma.product.update({ where: { id: confirmed.productId }, data: { blockchainIdentity: confirmed.transactionHash } });
      }
      return confirmed;
    } catch (error) {
      const { name, message } = describeError(error);
      if (name === "RPC_ERROR") this.reset();
      const attempts = proof.attempts + 1;
      const permanent = PERMANENT_ERRORS.has(name) || attempts >= MAX_ATTEMPTS;
      return (await this.updatePending(proof.id, { attempts, lastError: `${name}: ${message}`.slice(0, 500), status: permanent ? "FAILED" : "PENDING" })).proof;
    }
  }

  /**
   * Anchor worker: retries PENDING proofs (identities first, since events reference them).
   * `minIdleMs` skips proofs touched recently — another process may be waiting on their
   * transaction right now; the background worker uses it so it never races an in-flight submit.
   */
  async anchorPending(limit = 50, opts: { minIdleMs?: number } = {}) {
    if (!(await this.connect())) return { processed: 0, confirmed: 0, available: false };
    const kindOrder = { IDENTITY: 0, EVENT: 1, STATUS: 2 } as Record<string, number>;
    const idleSince = opts.minIdleMs ? { updatedAt: { lt: new Date(Date.now() - opts.minIdleMs) } } : {};
    const pending = (await prisma.blockchainProof.findMany({ where: { status: "PENDING", ...idleSince }, orderBy: { createdAt: "asc" }, take: limit })).sort(
      (a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    let confirmed = 0;
    for (const proof of pending) {
      const result = await this.submit(proof);
      if (result.status === "CONFIRMED") confirmed += 1;
    }
    return { processed: pending.length, confirmed, available: true };
  }

  /** Explicit operator retry for a proof exhausted by repeated transient failures. */
  async retryFailedProof(proofId: string) {
    const proof = await prisma.blockchainProof.findUnique({ where: { id: proofId } });
    if (!proof) throw notFound("Blockchain proof");
    if (proof.status !== "FAILED") throw new AppError("PROOF_NOT_FAILED", "Only failed proofs can be manually retried.", 409);
    const queued = await prisma.blockchainProof.update({
      where: { id: proofId },
      data: { status: "PENDING", attempts: 0, lastError: null },
    });
    // The background worker handles it asynchronously; the admin request must not wait on RPC
    // finality or create an HTTP timeout while a transaction is pending.
    return queued;
  }

  // -------------------------------------------------------------------------
  // On-chain reads & verification
  // -------------------------------------------------------------------------

  async lookupEvent(eventHash: string): Promise<OnChainEvent | null> {
    const conn = await this.connect();
    if (!conn) return null;
    try {
      const [exists, identityHash, anchoredAt] = (await withTimeout(
        conn.contract.getFunction("getEventAnchor")(toBytes32(eventHash)),
        5_000,
        "getEventAnchor",
      )) as [boolean, string, bigint];
      return exists
        ? { exists: true, identityHash: fromBytes32(identityHash), anchoredAt: Number(anchoredAt) }
        : { exists: false, identityHash: null, anchoredAt: null };
    } catch {
      this.reset();
      return null;
    }
  }

  async lookupIdentity(identityHash: string): Promise<OnChainIdentity | null> {
    const conn = await this.connect();
    if (!conn) return null;
    try {
      const [exists, registeredAt, status, registrar] = (await withTimeout(
        conn.contract.getFunction("getIdentity")(toBytes32(identityHash)),
        5_000,
        "getIdentity",
      )) as [boolean, bigint, bigint, string];
      return exists
        ? { exists: true, registeredAt: Number(registeredAt), status: Number(status), registrar }
        : { exists: false, registeredAt: null, status: null, registrar: null };
    } catch {
      this.reset();
      return null;
    }
  }

  /**
   * Deep verification of one proof: the transaction receipt must exist, have succeeded, target the
   * ORIGINX contract and emit a log carrying exactly this hash; the contract state must agree.
   */
  async verifyProof(proofId: string) {
    const proof = await prisma.blockchainProof.findUnique({ where: { id: proofId } });
    if (!proof) return { valid: false, result: "PROOF_NOT_FOUND" as const };
    const base = {
      proofId: proof.id,
      kind: proof.kind,
      anchoredHash: proof.eventHash,
      network: proof.network,
      chainId: proof.chainId,
      contractAddress: proof.contractAddress,
      transactionHash: proof.transactionHash,
      blockNumber: proof.blockNumber,
      explorerUrl: this.explorerUrl(proof.transactionHash),
    };
    if (proof.status !== "CONFIRMED" || !proof.transactionHash) {
      return { ...base, valid: false, result: proof.status === "FAILED" ? ("ANCHOR_FAILED" as const) : ("NOT_ANCHORED" as const), lastError: proof.lastError };
    }
    const conn = await this.connect();
    if (!conn) return { ...base, valid: null, result: "CHAIN_UNAVAILABLE" as const, reason: this.lastFailureReason };
    if (proof.chainId && proof.chainId !== conn.chainId) {
      return { ...base, valid: null, result: "DIFFERENT_CHAIN" as const };
    }
    if (proof.contractAddress && proof.contractAddress.toLowerCase() !== this.settings.contractAddress.toLowerCase()) {
      return { ...base, valid: null, result: "DIFFERENT_CONTRACT" as const };
    }
    try {
      const receipt = await withTimeout(conn.provider.getTransactionReceipt(proof.transactionHash), 5_000, "getTransactionReceipt");
      if (!receipt) {
        return {
          ...base,
          valid: LOCAL_CHAIN_IDS.has(conn.chainId) ? null : false,
          result: LOCAL_CHAIN_IDS.has(conn.chainId) ? ("LOCAL_CHAIN_RESET" as const) : ("TRANSACTION_NOT_FOUND" as const),
        };
      }
      const target = (receipt.to ?? "").toLowerCase() === (proof.contractAddress ?? "").toLowerCase();
      const parsedLogs = receipt.logs
        .filter((log) => log.address.toLowerCase() === (proof.contractAddress ?? "").toLowerCase())
        .map((log) => {
          try {
            return anchorInterface.parseLog(log);
          } catch {
            return null;
          }
        })
        .filter((parsed): parsed is NonNullable<typeof parsed> => Boolean(parsed));
      const logMatches = parsedLogs.some((parsed) => {
        if (proof.kind === "IDENTITY") {
          return parsed.name === "IdentityRegistered" && fromBytes32(String(parsed.args.identityHash ?? parsed.args[0])) === proof.eventHash;
        }
        if (proof.kind === "EVENT") {
          return parsed.name === "EventAnchored"
            && fromBytes32(String(parsed.args.eventHash ?? parsed.args[0])) === proof.eventHash
            && fromBytes32(String(parsed.args.identityHash ?? parsed.args[1])) === proof.identityHash;
        }
        return parsed.name === "IdentityStatusChanged"
          && fromBytes32(String(parsed.args.identityHash ?? parsed.args[0])) === proof.identityHash
          && Number(parsed.args.status ?? parsed.args[1]) === proof.statusCode;
      });
      let stateMatches = true;
      if (proof.kind === "EVENT") {
        const onChain = await this.lookupEvent(proof.eventHash);
        stateMatches = Boolean(onChain?.exists && onChain.identityHash === proof.identityHash);
      } else if (proof.kind === "IDENTITY") {
        stateMatches = Boolean((await this.lookupIdentity(proof.eventHash))?.exists);
      }
      const valid = receipt.status === 1 && target && logMatches && stateMatches;
      return {
        ...base,
        valid,
        result: valid ? ("VERIFIED" as const) : ("MISMATCH" as const),
        receiptStatus: receipt.status,
        targetsContract: target,
        logMatches,
        stateMatches,
      };
    } catch (error) {
      this.reset();
      return { ...base, valid: null, result: "CHAIN_UNAVAILABLE" as const, reason: describeError(error).message };
    }
  }

  async getProductProofs(productId: string) {
    return prisma.blockchainProof.findMany({ where: { productId }, orderBy: { createdAt: "asc" } });
  }
}

export const blockchainService = new BlockchainService();

let workerTimer: NodeJS.Timeout | null = null;

/** Starts the background anchor worker (server only — not in tests). */
export function startAnchorWorker() {
  if (workerTimer || !blockchainService.isConfigured()) return;
  workerTimer = setInterval(() => {
    // Lease: leave proofs alone while a request/CLI may still be waiting on their transaction.
    blockchainService.anchorPending(50, { minIdleMs: config.blockchain.txTimeoutMs + 30_000 }).catch(() => undefined);
  }, config.blockchain.retryIntervalMs);
  workerTimer.unref();
}

export function stopAnchorWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}
