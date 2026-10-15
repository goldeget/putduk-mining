import { defineConfig } from "@playwright/test";
import backend201 from "./playwright.backend-browser-201.config";

if (process.env.CI_WORKERD_AUTH !== "1") {
  throw new Error("WORKERD_AUTH_OWNED_RUNNER_REQUIRED");
}
if (!process.env.WORKERD_AUTH_OUTPUT_DIR) {
  throw new Error("WORKERD_AUTH_PRIVATE_OUTPUT_REQUIRED");
}
const chromium = backend201.projects?.filter(
  (project) => project.name === "chromium",
);
if (chromium?.length !== 1) {
  throw new Error("WORKERD_AUTH_CHROMIUM_PROJECT_MISMATCH");
}

// The inherited config executes the existing canonical 201 source guard and
// retains real local-auth global setup. The runner owns both Wrangler servers.
export default defineConfig({
  ...backend201,
  testMatch: [
    "**/public-admin-boundary.spec.ts",
    "**/admin-session-totp.spec.ts",
    "**/first-krw-withdrawal.spec.ts",
    "**/first-usdt-withdrawal.spec.ts",
    "**/withdrawal-negative-guards.spec.ts",
  ],
  projects: chromium,
  webServer: [],
  workers: 1,
  retries: 0,
  outputDir: process.env.WORKERD_AUTH_OUTPUT_DIR,
  reporter: [["line"], ["json"]],
});
