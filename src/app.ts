import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config, isTest } from "./config.js";
import { fail, ok } from "./lib/errors.js";
import { prisma } from "./lib/prisma.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { adminRouter } from "./routes/admin.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { opsRouter } from "./routes/ops.routes.js";
import { inventoryRouter } from "./routes/inventory.routes.js";
import { organizationRouter } from "./routes/organization.routes.js";
import { productRouter } from "./routes/product.routes.js";
import { publicRouter, siteRouter } from "./routes/public.routes.js";
import { blockchainService } from "./services/blockchain.service.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(helmet({ contentSecurityPolicy: { directives: { "img-src": ["'self'", "data:", "https://tile.openstreetmap.org"] } } }));
  app.use(
    cors({
      origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
      credentials: true,
      allowedHeaders: ["Authorization", "Content-Type", "X-Organization-Id", "X-Request-Id", "X-Requested-With", "X-Refresh-Transport", "Idempotency-Key"],
      exposedHeaders: ["X-Request-Id", "RateLimit", "RateLimit-Policy"],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // Request id + structured access log (no bodies, tokens or raw IPs are logged).
  app.use((req, res, next) => {
    const incoming = req.header("x-request-id");
    const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", requestId);
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      if (isTest) return;
      const path = req.originalUrl.split("?")[0].replace(/\/verify\/[^/]+/, "/verify/:token");
      console.log(
        JSON.stringify({
          level: res.statusCode >= 500 ? "error" : "info",
          msg: "request",
          requestId,
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
        }),
      );
    });
    next();
  });

  // Liveness: the process is up.
  app.get("/health", (_req, res) => {
    res.json(ok({ status: "ok", service: "originx-api" }));
  });
  // Readiness: database reachable; blockchain status reported (degraded, not down, when unreachable).
  app.get("/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return res.status(503).json(fail("NOT_READY", "Database is unreachable."));
    }
    const chain = await blockchainService.status();
    res.json(ok({ status: chain.available || !chain.configured ? "ready" : "degraded", database: "ok", blockchain: { configured: chain.configured, available: chain.available, network: chain.network, chainId: chain.chainId } }));
  });

  const api = express.Router();
  api.use(apiLimiter);
  api.use("/auth", authRouter);
  api.use("/verify", publicRouter);
  api.use("/site", siteRouter);
  api.use("/admin", adminRouter);
  api.use("/organizations", organizationRouter);
  api.use("/products", productRouter);
  api.use("/", inventoryRouter);
  api.use("/", opsRouter);
  app.use("/api/v1", api);

  app.use((_req, res) => {
    res.status(404).json(fail("NOT_FOUND", "Route not found."));
  });
  app.use(errorHandler);
  return app;
}
