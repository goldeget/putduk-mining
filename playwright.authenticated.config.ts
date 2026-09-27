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
};

export default defineConfig({
  testDir: "./tests/e2e/authenticated",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 120_000,
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
      command: "pnpm dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: {
        ...sharedEnv,
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
      },
    },
    {
      command: "pnpm dev:admin",
      url: "http://127.0.0.1:3100/login",
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: {
        ...sharedEnv,
        ADMIN_APP_URL: "http://127.0.0.1:3100",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
      },
    },
  ],
});
