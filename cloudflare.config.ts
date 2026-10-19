import { defineConfig, defineWorker } from "cf/config";

/** Staging Worker only. DNS and custom domains stay unset until a later cutover. */
export default defineConfig({
  accountId: "9dc502d4ef06b3b5374591de6e6933ca",
  worker: defineWorker({
    name: "putduk-mining-web-staging",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-19",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
  }),
});
