import "server-only";

import {
  assertLocalApiUrl,
  loadJobLocalAllowlist,
  type JobLocalAllowlist,
} from "../../scripts/capture-local-supabase-env.mjs";

import {
  getPublicEnv,
  parseSupabaseBrowserAuthConfig,
  type SupabaseBrowserAuthConfig,
} from "./public";

/** CI workerd has no checkout filesystem; only its admitted runner supplies this. */
function localBrowserAllowlist(
  runtimeEnv: Record<string, string | undefined>,
): JobLocalAllowlist {
  const scope = runtimeEnv.PUTDUK_WORKERD_LOCAL_AUTH_SCOPE;
  const raw = runtimeEnv.PUTDUK_WORKERD_LOCAL_ALLOWLIST;
  if (scope === undefined && raw === undefined) return loadJobLocalAllowlist();
  if (
    runtimeEnv.APP_ENV !== "test" ||
    scope !== "ci-auth-v1" ||
    runtimeEnv.PUTDUK_LOCAL_SUPABASE_CONFIG_PATH !== undefined ||
    typeof raw !== "string" ||
    raw.length > 512
  )
    throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
  const value = parsed as Record<string, unknown>;
  const validPort = (port: unknown): port is string =>
    typeof port === "string" &&
    /^[1-9][0-9]{0,4}$/.test(port) &&
    Number(port) <= 65_535;
  if (
    Object.keys(value).sort().join(",") !== "apiPort,dbPort,projectId" ||
    value.projectId !== "putduk-mining-ci-r2-20261009" ||
    !validPort(value.apiPort) ||
    !validPort(value.dbPort)
  )
    throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
  return {
    projectId: value.projectId,
    apiPort: value.apiPort,
    dbPort: value.dbPort,
  };
}

/** Public credentials only; never pass getServerEnv() into a Client Component. */
export function getSupabaseBrowserAuthConfig(): SupabaseBrowserAuthConfig {
  const env = getPublicEnv();
  const config = parseSupabaseBrowserAuthConfig({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const url = new URL(config.url);
  if (url.protocol === "http:") {
    const runtimeEnv = process.env;
    if (!["development", "test"].includes(runtimeEnv.APP_ENV ?? ""))
      throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
    // Local credentials belong to this checkout's isolated project and port.
    // Production uses the exact approved remote and does not read local files.
    try {
      assertLocalApiUrl(config.url, localBrowserAllowlist(runtimeEnv));
    } catch {
      throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
    }
  }
  return config;
}
