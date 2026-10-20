import { bindings, defineConfig, defineWorker } from "cf/config";

import { qaValues, TARGETS } from "../../scripts/qa-cloudflare-policy.mjs";
import {
  productionTarget,
  productionValues,
} from "../../scripts/production-cloudflare-policy.mjs";

/** QA and release targets require explicit modes; the ordinary CI build stays unchanged. */
export default defineConfig(({ mode }) => {
  const production = productionTarget(mode, "admin");
  return {
    accountId: "9dc502d4ef06b3b5374591de6e6933ca",
    worker: defineWorker({
      name:
        production?.name ??
        (mode === "qa" ? TARGETS.admin.name : "putduk-mining-admin-staging"),
      ...(production
        ? {
            // Required secrets inherit on this existing Worker; values never enter source.
            env: {
              ...Object.fromEntries(
                Object.entries(
                  productionValues(
                    process.env.PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
                    production.role,
                  ),
                ).map(([name, value]) => [name, bindings.text(value)]),
              ),
              SUPABASE_SECRET_KEY: bindings.secret(),
              WITHDRAWAL_DATA_KEY: bindings.secret(),
            },
          }
        : mode === "qa"
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
                WITHDRAWAL_DATA_KEY: bindings.secret(),
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
  };
});
