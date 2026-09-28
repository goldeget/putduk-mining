import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

import { readSupabaseStatus } from "./scripts/capture-local-supabase-env.mjs";

const isCI = Boolean(process.env.CI);
const credentials = readSupabaseStatus();
const withdrawalDataKey = randomBytes(32).toString("base64");

process.env.APP_ENV = "test";
process.env.APP_TIMEZONE = "UTC";
process.env.NEXT_PUBLIC_SUPABASE_URL = credentials.apiUrl;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = credentials.publishableKey;
process.env.SUPABASE_SECRET_KEY = credentials.secretKey;
process.env.WITHDRAWAL_DATA_KEY = withdrawalDataKey;

const sharedEnv = {
  APP_ENV: "test",
  APP_TIMEZONE: "UTC",
  NEXT_PUBLIC_SUPABASE_URL: credentials.apiUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
  SUPABASE_SECRET_KEY: credentials.secretKey,
  WITHDRAWAL_DATA_KEY: withdrawalDataKey,
};

export default defineConfig({
  testDir: "./tests/typography",
  testMatch: ["**/*protected*", "**/*.setup.ts"],
  fullyParallel: false,
  forbidOnly: isCI,
  globalTimeout: isCI ? 19 * 60_000 : 0,
  retries: 0,
  timeout: 120_000,
  workers: 1,
  reporter: isCI
    ? [
        ["line"],
        ["github"],
        [
          "json",
          { outputFile: "test-results/typography-protected/report.json" },
        ],
      ]
    : [
        ["list"],
        [
          "json",
          { outputFile: "test-results/typography-protected/report.json" },
        ],
      ],
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "off",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "setup-member",
      testMatch: "**/protected-member.setup.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "setup-admin",
      testMatch: "**/protected-admin.setup.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "user",
      dependencies: ["setup-member"],
      testMatch: "**/protected-user-korean-line-break.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "test-results/typography-protected/member.json",
      },
    },
    {
      name: "admin",
      dependencies: ["setup-admin"],
      testMatch: "**/protected-admin-korean-line-break.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "test-results/typography-protected/admin.json",
      },
    },
  ],
  outputDir: "test-results/typography-protected",
  webServer: {
    // 3199는 두 앱과 Auth 조회가 준비된 뒤에만 열린다.
    command: "node scripts/typography-protected-servers.mjs",
    url: "http://127.0.0.1:3199/ready",
    reuseExistingServer: false,
    timeout: 600_000,
    gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
    env: {
      ...process.env,
      ...sharedEnv,
    },
  },
});
