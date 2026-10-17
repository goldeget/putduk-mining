import { defineConfig } from "@playwright/test";

// Checker regressions run separately from public/protected route acceptance.
export default defineConfig({
  testDir: "./tests/typography",
  testMatch: "harness-regression.ts",
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  timeout: 120_000,
  outputDir: "test-results/typography-harness/artifacts",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/typography-harness/report.json" }],
  ],
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
