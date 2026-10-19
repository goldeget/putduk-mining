import "server-only";

import {
  assertLocalApiUrl,
  loadJobLocalAllowlist,
} from "../../scripts/capture-local-supabase-env.mjs";

import {
  assertSupabasePreviewContext,
  getPublicEnv,
  parseSupabaseBrowserAuthConfig,
  type SupabaseBrowserAuthConfig,
} from "./public";

/** Public credentials only; never pass getServerEnv() into a Client Component. */
export function getSupabaseBrowserAuthConfig(): SupabaseBrowserAuthConfig {
  const env = getPublicEnv();
  const config = parseSupabaseBrowserAuthConfig({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const url = new URL(config.url);
  assertSupabasePreviewContext(
    config.url,
    process.env.APP_ENV,
    env.NEXT_PUBLIC_APP_URL,
  );
  if (url.protocol === "http:") {
    const runtimeEnv = process.env;
    if (!["development", "test"].includes(runtimeEnv.APP_ENV ?? ""))
      throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
    // Local credentials belong to this checkout's isolated project and port.
    // Production uses the exact approved remote and does not read local files.
    try {
      assertLocalApiUrl(config.url, loadJobLocalAllowlist());
    } catch {
      throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
    }
  }
  return config;
}
