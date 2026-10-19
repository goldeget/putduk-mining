import { bindings, defineConfig, defineWorker } from "cf/config";

import { qaValues, TARGETS } from "../../scripts/qa-cloudflare-policy.mjs";

/** Only explicit qa mode selects the isolated QA Worker. Other modes keep the existing target. */
export default defineConfig(({ mode }) => ({
  accountId: "9dc502d4ef06b3b5374591de6e6933ca",
  worker: defineWorker({
    name: mode === "qa" ? TARGETS.admin.name : "putduk-mining-admin-staging",
    ...(mode === "qa"
      ? {
          workersDev: true,
          previewUrls: false,
          triggers: [],
          env: {
            ...Object.fromEntries(
              Object.entries(
                qaValues(
                  process.env.PUTDUK_QA_SUPABASE_PUBLISHABLE_KEY,
                  "admin",
                ),
              ).map(([name, value]) => [name, bindings.text(value)]),
            ),
            SUPABASE_SECRET_KEY: bindings.secret(),
          },
        }
      : {}),
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-19",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: [
        "/*",
        "!/_next/static/*",
        "!/*/_next/static/*",
        "!/brand/*",
      ],
    },
  }),
}));
