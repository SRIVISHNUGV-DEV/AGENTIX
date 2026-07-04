import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 60000,
    reporters: ["verbose"],
    singleFork: true,
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
