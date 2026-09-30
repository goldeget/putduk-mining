import { defineConfig } from "@playwright/test";

/** Isolated browser assertions only. No application server, DB, auth or remote requests. */
export default defineConfig({
  testDir: "./tests/typography",
  testMatch: "route-readiness.spec.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 15_000,
  outputDir: "test-results/ui-readiness",
  use: {
    headless: true,
    launchOptions: process.env.PUTDUK_UI_TEST_EXECUTABLE
      ? { executablePath: process.env.PUTDUK_UI_TEST_EXECUTABLE }
      : {},
  },
});
