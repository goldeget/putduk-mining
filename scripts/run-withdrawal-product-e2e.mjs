import {
  appendFileSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  readSupabaseStatus,
  formatGithubEnv,
} from "./capture-local-supabase-env.mjs";

/**
 * 로컬 출금 product E2E 러너.
 * 비밀값은 콘솔에 출력하지 않는다.
 * SHARED_FILE_REQUEST 전까지 admin 서버를 끈다.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".tmp-withdrawal-product-env");

writeFileSync(envFile, "");
const credentials = readSupabaseStatus();
appendFileSync(envFile, formatGithubEnv(credentials));
appendFileSync(
  envFile,
  `WITHDRAWAL_DATA_KEY=${randomBytes(32).toString("base64")}\n`,
);

const env = { ...process.env, E2E_SKIP_ADMIN_SERVER: "1" };
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq <= 0) continue;
  env[line.slice(0, eq)] = line.slice(eq + 1);
}

try {
  unlinkSync(envFile);
} catch {
  // ignore
}

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
