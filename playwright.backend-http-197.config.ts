import { defineConfig } from "@playwright/test";
import authenticated from "./playwright.authenticated.config";
import { assertBackend197CanonicalSources } from "./scripts/backend-successor-197-source.mjs";

// Backend-only candidate evidence. Historical 191/193 and full UI gates stay separate.
const reviewed = assertBackend197CanonicalSources();
if (
  process.env.E2E_WITH_ADMIN_SERVER !== "1" ||
  process.env.E2E_NEXT_START !== "1" ||
  process.env.APP_ENV !== "test" ||
  process.env.LOCAL_SUPABASE_PROJECT_ID !== reviewed.projectId ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !==
    "http://127.0.0.1:" + reviewed.apiPort
)
  throw new Error("BACKEND_197_CANONICAL_HTTP_CONTEXT_REQUIRED");

const inherited = { ...authenticated };
delete inherited.globalSetup;

export default defineConfig({
  ...inherited,
  // The inherited setup rewrites an existing admin. This spec owns fresh synthetic actors.
  testMatch: "**/usdt-manual-full-payout-197.spec.ts",
  outputDir: "test-results/backend-http-197-api",
  retries: 0,
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  projects: [{ name: "backend-api", use: {} }],
  reporter: [
    ["line"],
    ["json", { outputFile: "test-results/backend-http-197-api/report.json" }],
  ],
  use: {
    ...authenticated.use,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
