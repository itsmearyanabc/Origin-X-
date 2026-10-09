import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // One shared Postgres database and one chain: run files sequentially.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
