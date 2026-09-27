import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const isListing = process.argv.includes("--list");

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

const sharedEnv = {
  APP_ENV: "test",
  APP_TIMEZONE: "UTC",
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  SUPABASE_SECRET_KEY: secretKey,
  WITHDRAWAL_DATA_KEY: withdrawalDataKey,
  // Next가 gitignored .env.local의 원격 값을 읽지 않도록 로컬 값을 강제한다.
  FORCE_COLOR: process.env.FORCE_COLOR ?? "0",
};

if (
  supabaseUrl.includes("osrmyjgmpdspdcwqjwuv") ||
  !supabaseUrl.startsWith("http://")
) {
  throw new Error(
    "Authenticated Playwright refuses non-local Supabase credentials.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e/authenticated",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // 로컬 Docker·콜드 Next 기동을 고려. CI job timeout-minutes는 변경하지 않는다.
  timeout: 180_000,
  reporter: isCI ? [["line"], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/success-visual-evidence.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      testIgnore: "**/success-visual-evidence.spec.ts",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "visual-evidence",
      testMatch: "**/success-visual-evidence.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // 프로세스 그룹 래퍼로 next-server 고아 프로세스가 남아 CI가 멈추는 것을 방지
      command:
        "node scripts/e2e-web-server.mjs pnpm exec next dev --hostname 127.0.0.1 --port 3000",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: {
        ...process.env,
        ...sharedEnv,
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
      },
    },
    {
      command:
        "node scripts/e2e-web-server.mjs pnpm --dir apps/admin exec next dev --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100/login",
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: {
        ...process.env,
        ...sharedEnv,
        ADMIN_APP_URL: "http://127.0.0.1:3100",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
      },
    },
  ],
});
