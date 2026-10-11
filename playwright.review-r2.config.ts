import { defineConfig } from "@playwright/test";
import authenticated from "./playwright.authenticated.config";
import { assertReviewedPrincipalCandidateSources } from "./scripts/principal-review-r2-source.mjs";

// This reviewed successor has its own exact source map and synthetic local DB.
// Earlier frozen maps/configuration are preserved, rather than silently relabeled.
assertReviewedPrincipalCandidateSources();

export default defineConfig({
  ...authenticated,
  outputDir: "test-results/review-r2-browser",
  retries: 0,
  use: {
    ...authenticated.use,
    // Auth cookies/tokens must not enter trace or video evidence.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
});
