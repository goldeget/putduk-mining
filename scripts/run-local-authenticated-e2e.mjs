/** Fresh project-scoped local QA. Credentials stay in child environment only. */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readSupabaseStatus } from "./capture-local-supabase-env.mjs";

const id = readFileSync("supabase/config.toml", "utf8").match(
  /^project_id\s*=\s*"([^"]+)"/m,
)?.[1];
if (!id || !/^putduk-mining(?:-[a-z0-9-]+)?$/.test(id))
  throw new Error("LOCAL_PROJECT_SCOPE_REJECTED");
const local = readSupabaseStatus();
const args = process.argv.slice(2);
const localCommand = {
  "--build-only": "build",
  "--verify": "verify",
  "--worker": "test:worker",
}[args[0]];
const result = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  [
    ...(localCommand
      ? [localCommand]
      : [
          "exec",
          "playwright",
          "test",
          "--config",
          "playwright.authenticated.config.ts",
          ...args,
        ]),
  ],
  {
    env: {
      ...process.env,
      APP_ENV: "test",
      APP_TIMEZONE: "UTC",
      NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3451"}`,
      ADMIN_APP_URL: `http://127.0.0.1:${process.env.E2E_ADMIN_PORT ?? "3452"}`,
      NEXT_PUBLIC_SUPABASE_URL: local.apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.publishableKey,
      SUPABASE_SECRET_KEY: local.secretKey,
      LOCAL_SUPABASE_DB_URL: local.dbUrl,
      LOCAL_SUPABASE_PROJECT_ID: id,
      WITHDRAWAL_DATA_KEY: randomBytes(32).toString("base64"),
      E2E_WEB_PORT: process.env.E2E_WEB_PORT ?? "3451",
      E2E_ADMIN_PORT: process.env.E2E_ADMIN_PORT ?? "3452",
      E2E_REUSE_SERVER: "0",
    },
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  },
);
process.exit(result.status ?? 1);
