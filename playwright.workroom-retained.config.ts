import { defineConfig } from "@playwright/test";
import workroom from "./playwright.workroom.config";
export default defineConfig({
  ...workroom,
  testDir: "./tests/e2e",
  testMatch: [
    "admin-isolation.spec.ts",
    "withdrawal-evidence-redaction.spec.ts",
    "support-typography.spec.ts",
  ],
  outputDir: "test-results/workroom-auth/private-retained-artifacts",
  reporter: [
    ["line"],
    [
      "json",
      { outputFile: "test-results/workroom-auth/retained-results.json" },
    ],
  ],
});
