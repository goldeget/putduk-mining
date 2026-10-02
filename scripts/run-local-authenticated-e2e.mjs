/** Fresh project-scoped local QA. Credentials stay in child environment only. */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  assertCiTestTarget,
  assertLocalApiUrl,
  assertLocalDbUrl,
  buildIsolatedTestEnv,
  loadJobLocalAllowlist,
  readSupabaseStatus,
  registerActionMasks,
} from "./capture-local-supabase-env.mjs";

export function assertAppPort(value, fallback) {
  const port = String(value ?? fallback).trim();
  if (!/^[1-9][0-9]{1,4}$/.test(port) || Number(port) > 65535) {
    throw new Error("LOCAL_APP_PORT_REJECTED");
  }
  const parsed = new URL(`http://127.0.0.1:${port}`);
  if (parsed.hostname !== "127.0.0.1" || parsed.port !== String(Number(port))) {
    throw new Error("LOCAL_APP_ORIGIN_REJECTED");
  }
  return parsed.port;
}

export function prepareLocalAuthenticatedEnv({
  baseEnv,
  local,
  projectId,
  withdrawalKey,
  webPort,
  adminPort,
  writeStdout = () => {},
}) {
  const allow = loadJobLocalAllowlist();
  if (projectId !== allow.projectId) {
    throw new Error("LOCAL_PROJECT_SCOPE_REJECTED");
  }
  const safeWeb = assertAppPort(webPort, "3451");
  const safeAdmin = assertAppPort(adminPort, "3452");
  assertCiTestTarget(baseEnv);
  assertLocalApiUrl(local.apiUrl);
  assertLocalDbUrl(local.dbUrl);
  let password = "";
  try {
    password = new URL(local.dbUrl).password;
  } catch {
    password = "";
  }
  registerActionMasks(
    [local.publishableKey, local.secretKey, withdrawalKey, password],
    writeStdout,
    [local.secretKey, withdrawalKey],
  );
  return buildIsolatedTestEnv(baseEnv, local, {
    APP_TIMEZONE: "UTC",
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${safeWeb}`,
    ADMIN_APP_URL: `http://127.0.0.1:${safeAdmin}`,
    LOCAL_SUPABASE_PROJECT_ID: projectId,
    WITHDRAWAL_DATA_KEY: withdrawalKey,
    E2E_WEB_PORT: safeWeb,
    E2E_ADMIN_PORT: safeAdmin,
    E2E_REUSE_SERVER: "0",
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return entry
      .replaceAll("\\", "/")
      .endsWith("scripts/run-local-authenticated-e2e.mjs");
  }
}

function main() {
  const allow = loadJobLocalAllowlist();
  const local = readSupabaseStatus();
  const withdrawalKey = randomBytes(32).toString("base64");
  const env = prepareLocalAuthenticatedEnv({
    baseEnv: process.env,
    local,
    projectId: allow.projectId,
    withdrawalKey,
    webPort: process.env.E2E_WEB_PORT,
    adminPort: process.env.E2E_ADMIN_PORT,
    writeStdout: (line) => process.stdout.write(line),
  });
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
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
      windowsHide: true,
    },
  );
  process.exit(result.status ?? 1);
}

if (isDirectRun()) {
  main();
}
