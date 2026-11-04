import { defineConfig } from "@playwright/test";
import workroom from "./playwright.workroom.config";
export default defineConfig({
  ...workroom,
  testDir: "./test-results/workroom-auth/retained-source",
  testMatch: ["support-successor.spec.ts", "transfer-successor.spec.ts"],
  outputDir: "test-results/workroom-auth/private-public-artifacts",
  reporter: [
    ["line"],
    [
      "json",
      {
        outputFile: "test-results/workroom-auth/public-successor-results.json",
      },
    ],
  ],
});
