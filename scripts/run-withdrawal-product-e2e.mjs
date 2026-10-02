import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertCiTestTarget,
  assertLocalApiUrl,
  assertLocalDbUrl,
  buildIsolatedTestEnv,
  readSupabaseStatus,
  registerActionMasks,
} from "./capture-local-supabase-env.mjs";

/**
 * 로컬 출금 product E2E 러너.
 * 비밀값은 콘솔에 출력하지 않고, 저장소 파일에도 쓰지 않는다.
 * SHARED_FILE_REQUEST 전까지 admin 서버를 끈다.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function prepareWithdrawalProductEnv({
  baseEnv,
  local,
  withdrawalKey,
  writeStdout = () => {},
}) {
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
    WITHDRAWAL_DATA_KEY: withdrawalKey,
    E2E_SKIP_ADMIN_SERVER: "1",
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
      .endsWith("scripts/run-withdrawal-product-e2e.mjs");
  }
}

function main() {
  const local = readSupabaseStatus();
  const withdrawalKey = randomBytes(32).toString("base64");
  const env = prepareWithdrawalProductEnv({
    baseEnv: process.env,
    local,
    withdrawalKey,
    writeStdout: (line) => process.stdout.write(line),
  });
  const result = spawnSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.authenticated.config.ts",
      "--project=chromium",
      "tests/e2e/authenticated/withdrawal-product.spec.ts",
    ],
    {
      cwd: root,
      env,
      stdio: "inherit",
      shell: true,
    },
  );
  process.exit(result.status ?? 1);
}

if (isDirectRun()) {
  main();
}
