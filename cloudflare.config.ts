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
      // Public files are already in the asset bundle. Worker-first routing
      // returns vinext's empty static-file signal for them, so the browser
      // receives HTTP 200 with no image bytes. Serve those files from the
      // asset binding, the same way hashed /_next/static files are served.
      runWorkerFirst: [
        "/*",
        "!/_next/static/*",
        "!/*/_next/static/*",
        "!/brand/*",
        "!/ranks/*",
        "!/sw.js",
        "!/putduk-mining-indexnow-v1.txt",
        "!/README.md",
      ],
    },
  }),
});
