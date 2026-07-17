import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 60000,
    reporters: ["verbose"],
    singleFork: true,
    // Suites share one SQLite file (AGENTIX_HOME/.agentix-test). Running test
    // files in parallel races the WAL open and throws SQLITE_BUSY. Force
    // sequential file execution so DB-touching suites never collide.
    fileParallelism: false,
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e.test.ts", "node_modules"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@agentix/shared": resolve(__dirname, "./packages/shared"),
      "@agentix/core": resolve(__dirname, "./packages/core"),
      "@agentix/services": resolve(__dirname, "./packages/services"),
    },
  },
});
