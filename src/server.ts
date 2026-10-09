import { config } from "./config.js";
import { createApp } from "./app.js";
import { prisma } from "./lib/prisma.js";
import { blockchainService, startAnchorWorker, stopAnchorWorker } from "./services/blockchain.service.js";
import { mailService } from "./services/mail.service.js";

const app = createApp();

const server = app.listen(config.port, async () => {
  const [chain, mail] = await Promise.all([blockchainService.status(), mailService.check()]);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "ORIGINX API started",
      port: config.port,
      env: config.nodeEnv,
      demoMode: config.demoMode,
      email: mail,
      blockchain: { configured: chain.configured, available: chain.available, network: chain.network, chainId: chain.chainId, contract: chain.contractAddress, reason: chain.reason },
    }),
  );
  startAnchorWorker();
});
server.keepAliveTimeout = 65_000; // above typical proxy idle timeouts (nginx/Cloudflare)
server.headersTimeout = 66_000;

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: "info", msg: "shutting down", signal }));
  stopAnchorWorker();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15_000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({ level: "error", msg: "unhandledRejection", reason: String(reason) }));
});
