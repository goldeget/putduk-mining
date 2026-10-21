import { bindings, defineConfig, defineWorker } from "cf/config";

/** Staging Worker only. Hosts already bind admin.mining.putduk.com → this Worker. */
export default defineConfig({
  accountId: "9dc502d4ef06b3b5374591de6e6933ca",
  worker: defineWorker({
    name: "putduk-mining-admin-staging",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-10-19",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    // Preserve live staging host env on every cf deploy (secrets stay on CF; not listed here).
    env: {
      ADMIN_APP_URL: bindings.text("https://admin.mining.putduk.com"),
      AI_PROVIDER_DISPATCH_ENABLED: bindings.text("false"),
      APP_ENV: bindings.text("production"),
      APP_TIMEZONE: bindings.text("UTC"),
      NEXT_PUBLIC_APP_URL: bindings.text("https://admin.mining.putduk.com"),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.text(
        "sb_publishable_Pc0iVt3ubpnsRTNxbJ1KCg_kK76qtv-",
      ),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text(
        "https://osrmyjgmpdspdcwqjwuv.supabase.co",
      ),
    },
  }),
});
