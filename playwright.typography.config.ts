import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

const localSupabaseEnv = {
  APP_ENV: "test",
  APP_TIMEZONE: "UTC",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "local-typography-publishable-key-not-a-secret",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58421",
  SUPABASE_SECRET_KEY: "local-typography-secret-key-not-a-secret",
};

const memberServer = "pnpm dev";
const adminServer = "pnpm dev:admin";

export default defineConfig({
  testDir: "./tests/typography",
  testIgnore: ["**/*protected*", "**/*.setup.ts"],
  fullyParallel: false,
  forbidOnly: isCI,
  globalTimeout: isCI ? 15 * 60_000 : 0,
  retries: 0,
  timeout: 120_000,
  workers: 1,
  reporter: isCI
    ? [
        ["line"],
        ["github"],
        ["json", { outputFile: "test-results/typography/report.json" }],
      ]
    : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "off",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  outputDir: "test-results/typography",
  webServer: [
    {
      command: memberServer,
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: {
        ...localSupabaseEnv,
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
      },
    },
    {
      command: adminServer,
      url: "http://127.0.0.1:3100/login",
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: {
        ...localSupabaseEnv,
        ADMIN_APP_URL: "http://127.0.0.1:3100",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
      },
    },
  ],
});
