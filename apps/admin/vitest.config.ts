import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import UnitCompletenessReporter from "../../scripts/unit-completeness-reporter.mjs";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    maxWorkers: 2,
    reporters: ["default", "json", new UnitCompletenessReporter()],
    outputFile: {
      json: "../../test-results/workroom-application/admin-vitest.json",
    },
  },
});
