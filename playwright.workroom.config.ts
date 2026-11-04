import { defineConfig, devices } from "@playwright/test";

const listing = process.argv.includes("--list");
const env = { ...process.env, APP_ENV: "test", E2E_NEXT_START: "1" };
if (!listing) {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
  const targets: Record<string, string> = {
    "putduk-mining-ci-r2-20261009": "http://127.0.0.1:63421",
    "putduk-mining-workroom-local-20261104": "http://127.0.0.1:64531",
  };
  if (url.origin !== targets[process.env.LOCAL_SUPABASE_PROJECT_ID ?? ""])
    throw new Error("WORKROOM_DISPOSABLE_TARGET_REQUIRED");
}
const memberPort = process.env.E2E_WEB_PORT ?? "3000";
const adminPort = process.env.E2E_ADMIN_PORT ?? "3100";
for (const port of [memberPort, adminPort])
  if (!/^\d{4,5}$/.test(port) || Number(port) > 65535)
    throw new Error("INVALID_LOCAL_PORT");
export default defineConfig({
  testDir: "./tests/e2e/workroom",
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  failOnFlakyTests: true,
  retries: 0,
  timeout: 180_000,
  reporter: [
    ["line"],
    [
      "json",
      {
        outputFile:
          process.env.WORKROOM_E2E_REPORT_PATH ??
          "test-results/workroom-auth/results.json",
      },
    ],
  ],
  outputDir: "test-results/workroom-auth/artifacts",
  // Traces can contain passwords, TOTP secrets and cookies. Only sanitized visual receipts are saved explicitly.
  use: {
    baseURL: `http://127.0.0.1:${memberPort}`,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node scripts/e2e-web-server.mjs pnpm exec next start --hostname 127.0.0.1 --port ${memberPort}`,
      url: `http://127.0.0.1:${memberPort}/login`,
      reuseExistingServer: process.env.WORKROOM_REUSE_SERVER === "1",
      timeout: 180_000,
      env: { ...env, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${memberPort}` },
    },
    {
      command: `node scripts/e2e-web-server.mjs pnpm --dir apps/admin exec next start --hostname 127.0.0.1 --port ${adminPort}`,
      url: `http://127.0.0.1:${adminPort}/login`,
      reuseExistingServer: process.env.WORKROOM_REUSE_SERVER === "1",
      timeout: 180_000,
      env: {
        ...env,
        NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${adminPort}`,
        ADMIN_APP_URL: `http://127.0.0.1:${adminPort}`,
      },
    },
  ],
});
