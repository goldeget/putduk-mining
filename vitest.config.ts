import { backend197UnitFixturePlugin } from "./scripts/backend-successor-197-unit-fixture.mjs";
import { historicalRecoveryUnitPlugin } from "./scripts/historical-recovery-unit-stage.mjs";
import UnitCompletenessReporter from "./scripts/unit-completeness-reporter.mjs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [backend197UnitFixturePlugin(), historicalRecoveryUnitPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next enforces the marker in production builds; unit tests run on Node.
      "server-only": fileURLToPath(
        new URL(
          "./node_modules/next/dist/compiled/server-only/empty.js",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    reporters: ["default", "json", new UnitCompletenessReporter()],
    outputFile: { json: "test-results/workroom-application/web-vitest.json" },
    maxWorkers: 2,
    // Historical fixture integrity and full asset I/O remain bounded on slow disks.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Exact retired chrome assertions remain preserved in Git and are inventoried
    // by ci-workroom-unit-disposition.mjs; financial/auth tests are not excluded.
    exclude: [
      "tests/unit/product-mining-shell.test.ts",
      "tests/unit/product-wallet-shell.test.ts",
      "tests/unit/product-shell-scroll.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["domain/**/*.ts", "lib/**/*.ts"],
    },
  },
});
