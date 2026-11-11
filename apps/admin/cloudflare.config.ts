import { bindings, defineConfig, defineWorker } from "cf/config";

/** Existing named Worker; canonical admin host is admin.workroom.putduk.com. */
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
      runWorkerFirst: [
        "/*",
        "!/_next/static/*",
        "!/*/_next/static/*",
        "!/workroom-icon.svg",
        "!/workroom-*.png",
        "!/workroom-favicon.ico",
      ],
    },
    // Preserve live staging host env on every cf deploy (secrets stay on CF; not listed here).
    env: {
      ADMIN_APP_URL: bindings.text("https://admin.workroom.putduk.com"),
      AI_PROVIDER_DISPATCH_ENABLED: bindings.text("false"),
      APP_ENV: bindings.text("production"),
      APP_TIMEZONE: bindings.text("UTC"),
      NEXT_PUBLIC_APP_URL: bindings.text("https://admin.workroom.putduk.com"),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.text(
        "sb_publishable_GLyun5wTHeFb0vEjug52Mw_l4G9JqZx",
      ),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text(
        "https://awrubjiqkggaxcvtckbr.supabase.co",
      ),
    },
  }),
});
