import { defineConfig } from "@playwright/test";
import authenticated from "./playwright.authenticated.config";
import { assertBackendHttpCanonicalSources } from "./scripts/backend-http-canonical-source.mjs";

// Current canonical generation; the frozen 191 configuration stays historical.
assertBackendHttpCanonicalSources();

export default defineConfig({
  ...authenticated,
  outputDir: "test-results/backend-http-193-browser",
  retries: 0,
  use: {
    ...authenticated.use,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
});
