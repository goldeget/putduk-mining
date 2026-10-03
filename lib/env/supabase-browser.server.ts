import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
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
  if (url.protocol === "http:") {
    const runtimeEnv = process.env;
    if (!["development", "test"].includes(runtimeEnv.APP_ENV ?? ""))
      throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
    // Local credentials belong to this checkout's isolated project and port.
    // Production uses the exact approved remote and does not read local files.
    const localConfig = readFileSync(
      resolve(process.cwd(), "supabase/config.toml"),
      "utf8",
    );
    const projectId = localConfig.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
    const apiSection = localConfig
      .split(/^\[api\][ \t]*\r?$/m)[1]
      ?.split(/^\[/m)[0];
    const apiPort = apiSection?.match(/^port\s*=\s*([0-9]+)\s*$/m)?.[1];
    if (
      !projectId ||
      !/^putduk-mining(?:-[a-z0-9-]+)?$/.test(projectId) ||
      url.port !== apiPort
    )
      throw new Error("SUPABASE_BROWSER_CONFIG_INVALID");
  }
  return config;
}
