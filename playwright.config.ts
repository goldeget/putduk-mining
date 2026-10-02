import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/authenticated/**", "**/support-typography.spec.ts"],
  fullyParallel: true,
  forbidOnly: isCI,
  globalTimeout: isCI ? 3 * 60_000 : 0,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm dev",
    env: {
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        "local-playwright-publishable-key-not-a-secret",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58421",
      NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY: "",
      CHANNEL_TALK_MEMBER_HASH_SECRET: "",
    },
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !isCI,
    stdout: isCI ? "pipe" : "ignore",
  },
});
