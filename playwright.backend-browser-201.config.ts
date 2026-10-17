import { defineConfig } from "@playwright/test";
import authenticated from "./playwright.authenticated.config";
import { assertBackend201BrowserCanonicalSources } from "./scripts/backend-successor-201-browser-source.mjs";

// Full inherited browser inventory and auth setup; the separate API lane stays intact.
assertBackend201BrowserCanonicalSources();
if (process.env.PUTDUK_BACKEND_SOURCE_REVISION !== "201")
  throw Error("BACKEND201_EXPLICIT_BROWSER_CONTEXT_REQUIRED");
export default defineConfig({
  ...authenticated,
  outputDir: "test-results/backend-browser-201",
  retries: 0,
  use: {
    ...authenticated.use,
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
});
