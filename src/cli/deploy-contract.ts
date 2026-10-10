/**
 * Deploys OriginXProofAnchor to the chain configured by BLOCKCHAIN_* (production bootstrap).
 * Runs inside the API image, so the VPS needs no Node/npm tooling:
 *
 *   docker compose -f docker-compose.prod.yml run --rm api node dist/cli/deploy-contract.js
 *
 * Keep BLOCKCHAIN_MODE=disabled while running it (the API refuses EVM mode without a contract),
 * then put the printed address in BLOCKCHAIN_CONTRACT_ADDRESS and switch the mode to evm.
 *
 * Safe to re-run: if BLOCKCHAIN_CONTRACT_ADDRESS already holds this contract, nothing is deployed.
 * On the self-hosted private chain (BLOCKCHAIN_PRIVATE_CHAIN=true) the wallet is funded with
 * private-chain gas via anvil_setBalance — that coin exists only on this chain and has no value.
 */
import fs from "node:fs";
import path from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, parseEther, toQuantity } from "ethers";
import { config } from "../config.js";

const fail = (message: string): never => {
  console.error(`STOPPED: ${message}`);
  process.exit(1);
};

const artifact = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../contracts/artifacts/OriginXProofAnchor.json"), "utf8")) as { abi: unknown[]; bytecode: string };
const { rpcUrl, privateKey, expectedChainId, contractAddress, privateChain, confirmations, explorerTxUrl } = config.blockchain;

if (!rpcUrl) fail("BLOCKCHAIN_RPC_URL is not set.");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail("BLOCKCHAIN_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key.");
if (!expectedChainId) fail("BLOCKCHAIN_CHAIN_ID must be set so the contract cannot land on the wrong network.");

const provider = new JsonRpcProvider(rpcUrl);
try {
  const chainId = Number((await provider.getNetwork()).chainId);
  if (chainId !== expectedChainId) fail(`The RPC is on chain ${chainId}, but BLOCKCHAIN_CHAIN_ID is ${expectedChainId}.`);
  const wallet = new Wallet(privateKey, provider);

  if (/^0x[0-9a-fA-F]{40}$/.test(contractAddress) && (await provider.getCode(contractAddress)) !== "0x") {
    const existing = new Contract(contractAddress, artifact.abi as never, provider);
    const authorized = (await existing.anchorers(wallet.address)) as boolean;
    console.log(`Already deployed at ${contractAddress} on chain ${chainId} (wallet ${authorized ? "is" : "is NOT"} an authorized anchorer) — nothing to do.`);
    process.exit(0);
  }

  let balance = await provider.getBalance(wallet.address);
  if (balance === 0n && privateChain) {
    await provider.send("anvil_setBalance", [wallet.address, toQuantity(parseEther("1000"))]);
    // Read through a raw call: ethers briefly caches identical requests, which would return the old 0.
    balance = BigInt(await provider.send("eth_getBalance", [wallet.address, "latest"]));
    console.log("Funded the wallet with private-chain gas (no real value).");
  }
  console.log(`Chain ${chainId} | wallet ${wallet.address} | balance ${formatEther(balance)}`);
  if (balance === 0n) fail("The wallet has no gas on this chain yet (for Amoy: get test POL from a faucet), then run this again.");

  const contract = await new ContractFactory(artifact.abi as never, artifact.bytecode, wallet).deploy();
  const tx = contract.deploymentTransaction()!;
  console.log(`Deploying… transaction ${tx.hash}`);
  const receipt = await tx.wait(confirmations);
  const address = await contract.getAddress();

  const live = new Contract(address, artifact.abi as never, provider);
  const owner = (await live.owner()) as string;
  if (owner.toLowerCase() !== wallet.address.toLowerCase() || !((await live.anchorers(wallet.address)) as boolean)) {
    fail("The deployed contract did not verify (owner/anchorer mismatch).");
  }
  console.log(`\nDEPLOYED and verified on chain ${chainId}.`);
  console.log(`  Contract:    ${address}`);
  console.log(`  Transaction: ${receipt!.hash} (block ${receipt!.blockNumber})`);
  if (explorerTxUrl) console.log(`  View:        ${explorerTxUrl.replace(/\/$/, "")}/${receipt!.hash}`);
  console.log(`\nNext, on the VPS:\n  sed -i 's/^BLOCKCHAIN_CONTRACT_ADDRESS=.*/BLOCKCHAIN_CONTRACT_ADDRESS=${address}/; s/^BLOCKCHAIN_MODE=.*/BLOCKCHAIN_MODE=evm/' .env.production`);
} catch (error) {
  const e = error as { shortMessage?: string; message?: string };
  fail(e.shortMessage ?? e.message ?? String(error));
} finally {
  provider.destroy();
}
