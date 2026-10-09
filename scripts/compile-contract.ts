/**
 * Compiles contracts/OriginXProofAnchor.sol with solc-js and writes the ABI + bytecode to
 * contracts/artifacts/OriginXProofAnchor.json. The artifact is committed so the API and the
 * deploy script never need a Solidity compiler at runtime.
 *
 *   npm run contract:compile
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const solc = require("solc");

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "contracts", "OriginXProofAnchor.sol");
const outDir = path.join(root, "contracts", "artifacts");

const input = {
  language: "Solidity",
  sources: { "OriginXProofAnchor.sol": { content: fs.readFileSync(sourcePath, "utf8") } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);

const contract = output.contracts["OriginXProofAnchor.sol"].OriginXProofAnchor;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "OriginXProofAnchor.json"),
  JSON.stringify(
    {
      contractName: "OriginXProofAnchor",
      compiler: `solc ${solc.version()}`,
      evmVersion: input.settings.evmVersion,
      abi: contract.abi,
      bytecode: `0x${contract.evm.bytecode.object}`,
    },
    null,
    2,
  ),
);
console.log("Compiled OriginXProofAnchor ->", path.relative(root, path.join(outDir, "OriginXProofAnchor.json")));
