/**
 * Anchors every PENDING blockchain proof (e.g. after the chain was unreachable). The API's
 * background worker does the same periodically; this is the manual / cron entry point.
 *
 *   npm run anchor:pending
 */
import { prisma } from "../lib/prisma.js";
import { blockchainService } from "../services/blockchain.service.js";

const status = await blockchainService.status();
if (!status.available) {
  console.error("Blockchain unavailable:", status.reason);
  process.exit(1);
}
let total = 0;
for (;;) {
  const result = await blockchainService.anchorPending(200);
  total += result.confirmed;
  if (result.processed === 0 || result.confirmed === 0) break;
}
const remaining = await prisma.blockchainProof.count({ where: { status: "PENDING" } });
console.log(`Anchored ${total} proof(s) on ${status.network} (chain ${status.chainId}). Still pending: ${remaining}.`);
await prisma.$disconnect();
