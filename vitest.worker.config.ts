import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/worker/**/*.test.ts"],
    fileParallelism: false,
    reporters: ["default", "json"],
    outputFile: {
      json: "test-results/worker/vitest.json",
    },
  },
});
