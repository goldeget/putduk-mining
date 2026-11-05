import { defineConfig } from "@playwright/test";
import workroom from "./playwright.workroom.config";
export default defineConfig({
  ...workroom,
  testDir: "./test-results/workroom-auth/retained-source",
  testMatch: "financial-http.spec.ts",
  outputDir: "test-results/workroom-auth/private-financial-artifacts",
  reporter: [
    ["line"],
    [
      "json",
      { outputFile: "test-results/workroom-auth/financial-results.json" },
    ],
  ],
});
