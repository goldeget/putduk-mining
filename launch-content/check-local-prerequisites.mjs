import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { readSupabaseStatus } from "../scripts/capture-local-supabase-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const frozen = "f9b454a7c1b86dde1099b6e5a264092118258ead";
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (
  git("remote", "get-url", "origin") !==
  "https://github.com/goldeget/putduk-mining.git"
)
  throw new Error("REPOSITORY_SCOPE_REJECTED");
if (git("rev-parse", "parallel/admin-release") !== frozen)
  throw new Error("FROZEN_ADMIN_HEAD_CHANGED");
if (
  !/^project_id\s*=\s*"putduk-mining"$/m.test(
    fs.readFileSync("supabase/config.toml", "utf8"),
  )
)
  throw new Error("LOCAL_PROJECT_SCOPE_REJECTED");
const checks = {
  frozen_admin_ref: { status: "PASS", sha: frozen },
  checked_out_sha: git("rev-parse", "HEAD"),
  node: {
    status: process.version === "v24.21.0" ? "PASS" : "FAIL",
    version: process.version,
  },
  pnpm: {
    version: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
  },
  supabase_cli: {
    version: execFileSync("supabase", ["--version"], {
      encoding: "utf8",
    }).trim(),
  },
  docker: {
    driver: execFileSync("docker", ["info", "--format", "{{.Driver}}"], {
      encoding: "utf8",
    }).trim(),
  },
};
checks.pnpm.status = checks.pnpm.version === "12.6.0" ? "PASS" : "FAIL";
checks.supabase_cli.status =
  checks.supabase_cli.version === "2.113.0" ? "PASS" : "FAIL";
let browser;
try {
  browser = await chromium.launch({ headless: true });
  checks.bundled_chromium = { status: "PASS", version: browser.version() };
} catch {
  checks.bundled_chromium = {
    status: "BLOCKED",
    reason:
      "PINNED_BROWSER_UNAVAILABLE; official download returned cdn.playwright.dev 403",
  };
} finally {
  await browser?.close();
}
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
  });
  checks.system_chromium = {
    status: "PASS",
    version: browser.version(),
    authenticated_e2e: "NOT_EXECUTED",
  };
} catch {
  checks.system_chromium = {
    status: "BLOCKED",
    reason: "SYSTEM_BROWSER_LAUNCH_FAILED",
  };
} finally {
  await browser?.close();
}
try {
  // Credentials remain inside this function's scope and are never serialized.
  const local = readSupabaseStatus();
  if (local.apiUrl !== "http://127.0.0.1:58421")
    throw new Error("LOCAL_URL_MISMATCH");
  checks.local_supabase = {
    status: "PASS_PREREQUISITE_ONLY",
    api_origin: local.apiUrl,
    keys_recorded: false,
  };
} catch {
  checks.local_supabase = {
    status: "BLOCKED",
    reason:
      "LOCAL_STACK_NOT_READY; startup/image pull failed; no credentials invented or recorded",
  };
}
const specs = [
  "admin-today",
  "admin-members-product",
  "admin-exceptions-product",
  "admin-assistant-read-draft",
  "admin-session-totp",
  "deposit-product",
  "admin-krw-browser-money",
  "admin-usdt-browser-money",
];
for (const spec of specs)
  git("cat-file", "-e", `${frozen}:tests/e2e/authenticated/${spec}.spec.ts`);
const prerequisitesPresent =
  checks.local_supabase.status === "PASS_PREREQUISITE_ONLY" &&
  checks.bundled_chromium.status === "PASS" &&
  checks.node.status === "PASS" &&
  checks.pnpm.status === "PASS" &&
  checks.supabase_cli.status === "PASS";
const testStatus = prerequisitesPresent ? "UNRUN" : "BLOCKED";
const report = {
  observed_at_utc: new Date().toISOString(),
  observed_at_kst: new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date()),
  checks,
  admin_e2e: {
    status: testStatus,
    target_sha: frozen,
    specs: specs.map((name) => ({ name, status: testStatus, executed: false })),
    reason: prerequisitesPresent
      ? "Prerequisites are present; schema/auth evidence and actual frozen-HEAD tests still need execution. This probe never runs tests."
      : "Actual local DB/auth and pinned browser prerequisites are unresolved. This probe does not execute tests.",
  },
  production_mutation: false,
  source_modified: false,
};
fs.writeFileSync(
  "launch-content/evidence/admin-environment-preflight.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
process.exitCode = prerequisitesPresent ? 0 : 2;
