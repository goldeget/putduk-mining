import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

const localSupabaseEnv = {
  APP_ENV: "test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    "local-typography-publishable-key-not-a-secret",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58421",
  SUPABASE_SECRET_KEY: "local-typography-secret-key-not-a-secret",
};

export default defineConfig({
  testDir: "./tests/e2e/typography",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: 0,
  timeout: 120_000,
  reporter: isCI ? [["line"], ["github"]] : "list",
  outputDir: "test-results/typography",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3000",
    screenshot: "off",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: [
    {
      command: "pnpm dev",
      env: {
        ...localSupabaseEnv,
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: !isCI,
      stdout: isCI ? "pipe" : "ignore",
      timeout: 180_000,
      url: "http://127.0.0.1:3000",
    },
    {
      command: "pnpm dev:admin",
      env: {
        ...localSupabaseEnv,
        ADMIN_APP_URL: "http://127.0.0.1:3100",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      reuseExistingServer: !isCI,
      stdout: isCI ? "pipe" : "ignore",
      timeout: 180_000,
      url: "http://127.0.0.1:3100/login",
    },
  ],
});
