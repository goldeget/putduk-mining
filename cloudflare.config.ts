import { bindings, defineConfig, defineWorker } from "cf/config";

/** Staging Worker only. Hosts already bind mining.putduk.com → this Worker. */
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
    // Preserve live staging host env on every cf deploy (secrets stay on CF; not listed here).
    env: {
      ADMIN_APP_URL: bindings.text("https://admin.mining.putduk.com"),
      AI_MODEL_LOW_COST: bindings.text("openai/gpt-oss-20b"),
      AI_PROVIDER: bindings.text("nvidia"),
      AI_PROVIDER_DISPATCH_ENABLED: bindings.text("true"),
      APP_ENV: bindings.text("production"),
      APP_TIMEZONE: bindings.text("UTC"),
      NEXT_PUBLIC_APP_URL: bindings.text("https://mining.putduk.com"),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.text(
        "sb_publishable_Pc0iVt3ubpnsRTNxbJ1KCg_kK76qtv-",
      ),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text(
        "https://osrmyjgmpdspdcwqjwuv.supabase.co",
      ),
    },
  }),
});
