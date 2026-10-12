import { defineConfig, devices } from "@playwright/test";
import { assertKycRuntimeBinding } from "./tests/e2e/authenticated/helpers/kyc-runtime-binding";

const binding = assertKycRuntimeBinding();
export default defineConfig({
  testDir: "./tests/runtime-acceptance/kyc",
  testMatch: ["kyc-member-runtime.spec.ts", "kyc-admin-runtime.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 360_000,
  reporter: "line",
  use: {
    baseURL: binding.memberOrigin,
    trace: "off",
    screenshot: "off",
    video: "off",
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Deliberately no webServer/globalSetup: runtime must already be independently
  // authorized and bound to source/build/PID and exact fresh local namespace.
});
