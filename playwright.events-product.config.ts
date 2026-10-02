import { defineConfig, devices } from "@playwright/test";

/**
 * Events 레인 전용 브라우저 설정.
 * 공유 playwright.authenticated.config.ts(포트 3000)는 수정하지 않는다.
 * 이 레인의 개발/증거 서버는 3410만 사용한다.
 */

const isCI = Boolean(process.env.CI);
const isListing = process.argv.includes("--list");
const MEMBER_PORT = 3410;
const MEMBER_ORIGIN = `http://127.0.0.1:${MEMBER_PORT}`;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    if (isListing) {
      return name === "NEXT_PUBLIC_SUPABASE_URL"
        ? "http://127.0.0.1:54321"
        : "list-only-not-a-credential";
    }
    throw new Error(
      `${name} is required. CI must provide it. Do not generate a separate fallback key.`,
    );
  }
  if (value.includes("osrmyjgmpdspdcwqjwuv")) {
    throw new Error(`${name} points at the remote Supabase project.`);
  }
  return value;
}

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const secretKey = required("SUPABASE_SECRET_KEY");
const withdrawalDataKey = required("WITHDRAWAL_DATA_KEY");

if (
  supabaseUrl.includes("osrmyjgmpdspdcwqjwuv") ||
  !supabaseUrl.startsWith("http://")
) {
  throw new Error("Events Playwright refuses non-local Supabase credentials.");
}

const sharedEnv = {
  APP_ENV: "test",
  APP_TIMEZONE: "UTC",
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  WITHDRAWAL_DATA_KEY: withdrawalDataKey,
  FORCE_COLOR: process.env.FORCE_COLOR ?? "0",
};

const memberWebCommand = `node scripts/e2e-web-server.mjs pnpm exec next dev --hostname 127.0.0.1 --port ${MEMBER_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e/authenticated",
  testMatch: "**/events-product.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: 0,
  timeout: 180_000,
  reporter: isCI ? [["line"], ["github"]] : "list",
  use: {
    baseURL: MEMBER_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: memberWebCommand,
      url: MEMBER_ORIGIN,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
      stdout: (isCI ? "pipe" : "ignore") as "pipe" | "ignore",
      env: {
        ...process.env,
        ...sharedEnv,
        NEXT_PUBLIC_APP_URL: MEMBER_ORIGIN,
        NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY: "putduk-e2e-plugin-key",
        CHANNEL_TALK_MEMBER_HASH_SECRET: "aa".repeat(32),
        PORT: String(MEMBER_PORT),
      },
    },
  ],
});
