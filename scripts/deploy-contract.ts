/**
 * Deploys OriginXProofAnchor and records the deployment in .originx-chain.json (gitignored), which
 * the API reads when BLOCKCHAIN_* variables are not set.
 *
 *   npm run chain            # terminal 1: local Hardhat node on :8545
 *   npm run chain:deploy     # terminal 2: deploy to it
 *
 * For a public testnet (e.g. Polygon Amoy, Sepolia) set BLOCKCHAIN_RPC_URL and
 * BLOCKCHAIN_PRIVATE_KEY (a funded testnet key — never commit it) before running.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet, type Signer } from "ethers";

export async function deployAnchor(options: { rpcUrl: string; privateKey?: string; network?: string; outFile?: string | null }) {
  const provider = new JsonRpcProvider(options.rpcUrl);
  const { chainId } = await provider.getNetwork();
  const local = chainId === 31337n || chainId === 1337n;
  let signer: Signer;
  if (options.privateKey) signer = new Wallet(options.privateKey, provider);
  else if (local) signer = await provider.getSigner(0);
  else throw new Error("BLOCKCHAIN_PRIVATE_KEY is required to deploy to a non-local chain.");

  const artifact = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../contracts/artifacts/OriginXProofAnchor.json"), "utf8"),
  );
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await factory.deploy();
  const receipt = await contract.deploymentTransaction()!.wait(1);
  const deployment = {
    network: options.network ?? (local ? "hardhat-local" : `chain-${chainId}`),
    chainId: Number(chainId),
    rpcUrl: options.rpcUrl,
    contractAddress: await contract.getAddress(),
    deployer: await signer.getAddress(),
    deploymentTransaction: receipt!.hash,
    deploymentBlock: receipt!.blockNumber,
    deployedAt: new Date().toISOString(),
  };
  if (options.outFile !== null) {
    fs.writeFileSync(path.resolve(options.outFile ?? ".originx-chain.json"), JSON.stringify(deployment, null, 2));
  }
  provider.destroy();
  return deployment;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  deployAnchor({
    rpcUrl: process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545",
    privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY || undefined,
    network: process.env.BLOCKCHAIN_NETWORK || undefined,
  })
    .then((d) => {
      console.log("OriginXProofAnchor deployed");
      console.log(JSON.stringify(d, null, 2));
      console.log("Saved to .originx-chain.json");
    })
    .catch((error) => {
      console.error("Deployment failed:", error.shortMessage ?? error.message);
      process.exit(1);
    });
}
