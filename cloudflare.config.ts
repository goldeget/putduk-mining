import { bindings, defineConfig, defineWorker } from "cf/config";

import { qaValues, TARGETS } from "./scripts/qa-cloudflare-policy.mjs";
import {
  productionTarget,
  productionValues,
} from "./scripts/production-cloudflare-policy.mjs";

/** QA and release targets require explicit modes; the ordinary CI build stays unchanged. */
export default defineConfig(({ mode }) => {
  const production = productionTarget(mode, "member");
  const landing = production?.role === "landing";
  return {
    accountId: "9dc502d4ef06b3b5374591de6e6933ca",
    worker: defineWorker({
      name:
        production?.name ??
        (mode === "qa" ? TARGETS.member.name : "putduk-mining-web-staging"),
      ...(production
        ? {
            // Script-level domains, triggers and preview settings are retained separately.
            env: {
              ...Object.fromEntries(
                Object.entries(
                  productionValues(
                    process.env.PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
                    production.role,
                  ),
                ).map(([name, value]) => [name, bindings.text(value)]),
              ),
              ...(!landing
                ? {
                    SUPABASE_SECRET_KEY: bindings.secret(),
                    WITHDRAWAL_DATA_KEY: bindings.secret(),
                  }
                : {}),
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
                      "member",
                    ),
                  ).map(([name, value]) => [name, bindings.text(value)]),
                ),
                SUPABASE_SECRET_KEY: bindings.secret(),
                WITHDRAWAL_DATA_KEY: bindings.secret(),
              },
            }
          : {}),
      entrypoint: landing
        ? "./lib/cloudflare/landing-entry.ts"
        : "vinext/server/fetch-handler",
      compatibilityDate: "2026-10-19",
      compatibilityFlags: ["nodejs_compat"],
      assets: {
        htmlHandling: "none",
        notFoundHandling: "none",
        // Public files are already in the asset bundle. Worker-first routing
        // returns vinext's empty static-file signal for them, so the browser
        // receives HTTP 200 with no image bytes. Serve those files from the
        // asset binding, the same way hashed /_next/static files are served.
        runWorkerFirst: landing
          ? ["/*"]
          : [
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
  };
});
