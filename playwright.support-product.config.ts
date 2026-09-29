import { defineConfig, devices } from "@playwright/test";

/**
 * 레인 로컬 전용: DEV PORT 3424.
 * CI Browser foundation은 기존 playwright.config.ts(3000)를 유지한다.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/support.spec.ts"],
  fullyParallel: false,
  forbidOnly: true,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3424",
    trace: "on-first-retry",
    actionTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "node scripts/e2e-web-server.mjs pnpm exec next dev --hostname 127.0.0.1 --port 3424",
    env: {
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3424",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        "local-playwright-publishable-key-not-a-secret",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58421",
      NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY: "",
      CHANNEL_TALK_MEMBER_HASH_SECRET: "",
    },
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    url: "http://127.0.0.1:3424",
    reuseExistingServer: true,
    timeout: 300_000,
    stdout: "pipe",
  },
});
