import { defineConfig } from "@playwright/test";
import authenticated from "./playwright.authenticated.config";
import { assertBackend197BrowserCanonicalSources } from "./scripts/backend-successor-197-browser-source.mjs";

// Full inherited browser inventory and auth setup; the separate API lane stays intact.
assertBackend197BrowserCanonicalSources();
export default defineConfig({
  ...authenticated,
  outputDir: "test-results/backend-browser-197",
  retries: 0,
  use: {
    ...authenticated.use,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
});
