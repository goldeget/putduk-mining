import { defineConfig } from "@playwright/test";
import authenticated from "./playwright.authenticated.config";
import { assertBackend202BrowserCanonicalSources } from "./scripts/backend-successor-202-browser-source.mjs";

// Full inherited browser inventory and auth setup; the separate API lane stays intact.
assertBackend202BrowserCanonicalSources();
if (process.env.PUTDUK_BACKEND_SOURCE_REVISION !== "202")
  throw Error("BACKEND202_EXPLICIT_BROWSER_CONTEXT_REQUIRED");
export default defineConfig({
  ...authenticated,
  outputDir: "test-results/backend-browser-202",
  retries: 0,
  use: {
    ...authenticated.use,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
});
