/** Disposable CI acceptance. This entry point never contacts the operational project. */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  makeReceipt,
  verifyReceipt,
  assertPlaywrightReport,
} from "./ci-workroom-evidence.mjs";
import {
  parseShellEnv,
  mergeStatusStreams,
  selectLocalCredentials,
  credentialMaskValues,
  registerActionMasks,
  omitLiveProviders,
  redactStatusText,
} from "./capture-local-supabase-env.mjs";

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "goldeget/putduk-mining" ||
  process.env.APP_ENV !== "test"
)
  throw Error("WORKROOM_DISPOSABLE_CI_REQUIRED");
verifyReceipt(
  JSON.parse(
    readFileSync("test-results/workroom-application/receipt.json", "utf8"),
  ),
);
let env = omitLiveProviders({
  ...process.env,
  APP_ENV: "test",
  NEXT_PUBLIC_APP_ENV: "test",
  APP_TIMEZONE: "UTC",
});
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit", env });
run(process.execPath, [
  "scripts/workroom-source-integrity.mjs",
  "--verify",
  "--require-clean",
]);
const startedAt = Date.now();
const parent = mkdtempSync(
  resolve(process.env.RUNNER_TEMP ?? tmpdir(), "workroom-acceptance-"),
);
const stage = resolve(parent, "native");
const baseline = resolve(stage, "baseline");
const evidence = "test-results/workroom-acceptance";
mkdirSync(evidence, { recursive: true });
run(process.execPath, [
  "scripts/workroom-native-stage.mjs",
  "--prepare",
  stage,
]);
let started = false;
try {
  const startup = spawnSync(
    "supabase",
    ["start", "--workdir", baseline, "--yes"],
    { env, encoding: "utf8", timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
  );
  console.log(
    redactStatusText((startup.stdout ?? "") + (startup.stderr ?? "")),
  );
  if (startup.status !== 0 || startup.error)
    throw Error("WORKROOM_LOCAL_START_FAILED");
  started = true;
  const status = spawnSync(
    "supabase",
    ["status", "--workdir", baseline, "-o", "env"],
    { env, encoding: "utf8" },
  );
  if (status.status !== 0 || status.error)
    throw Error("WORKROOM_LOCAL_STATUS_FAILED");
  const credentials = selectLocalCredentials(
    mergeStatusStreams(status.stdout, status.stderr),
  );
  registerActionMasks(
    credentialMaskValues(credentials),
    (line) => console.log(line),
    [credentials.secretKey, credentials.publishableKey],
  );
  if (
    credentials.apiUrl !== "http://127.0.0.1:63421" ||
    new URL(credentials.dbUrl).port !== "63422"
  )
    throw Error("WORKROOM_EXACT_LOCAL_TARGET_REQUIRED");
  env = {
    ...env,
    NEXT_PUBLIC_SUPABASE_URL: credentials.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: credentials.publishableKey,
    SUPABASE_SECRET_KEY: credentials.secretKey,
    LOCAL_SUPABASE_DB_URL: credentials.dbUrl,
    LOCAL_SUPABASE_PROJECT_ID: "putduk-mining-ci-r2-20261009",
  };
  run(process.execPath, ["scripts/workroom-auth-seed-existing.mjs"]);
  Object.assign(
    env,
    parseShellEnv(
      readFileSync("test-results/workroom-auth/existing.env", "utf8"),
    ),
  );
  run(process.execPath, [
    "scripts/assert-admin-auth-admission-concurrency.mjs",
  ]);
  run(process.execPath, [
    "scripts/workroom-native-runner.mjs",
    "--baseline",
    "--stage",
    stage,
  ]);
  run(process.execPath, [
    "scripts/workroom-native-runner.mjs",
    "--cutover",
    "--stage",
    stage,
  ]);
  const workerStartedAt = Date.now();
  run("pnpm", ["test:worker"]);
  run(process.execPath, [
    "scripts/assert-worker-report.mjs",
    "test-results/worker/vitest.json",
    "--started-after",
    String(workerStartedAt),
  ]);
  run("supabase", [
    "db",
    "lint",
    "--workdir",
    resolve(stage, "successor"),
    "--local",
    "--schema",
    "public,app_private",
    "--level",
    "warning",
    "--fail-on",
    "warning",
  ]);
  run("supabase", [
    "db",
    "advisors",
    "--workdir",
    resolve(stage, "successor"),
    "--local",
    "--type",
    "security",
    "--level",
    "warn",
    "--fail-on",
    "warn",
  ]);
  run(process.execPath, [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.workroom.config.ts",
    "--fail-on-flaky-tests",
  ]);
  const browserPath = "test-results/workroom-auth/results.json";
  const browserFiles = readdirSync("tests/e2e/workroom").filter((name) =>
    name.endsWith(".spec.ts"),
  );
  if (browserFiles.length !== 12)
    throw Error("WORKROOM_REVIEWED_BROWSER_ROSTER_CHANGED");
  assertPlaywrightReport(
    JSON.parse(readFileSync(browserPath, "utf8")),
    browserFiles,
  );
  run(process.execPath, [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.workroom-retained.config.ts",
    "--fail-on-flaky-tests",
  ]);
  const retainedPath = "test-results/workroom-auth/retained-results.json";
  assertPlaywrightReport(JSON.parse(readFileSync(retainedPath, "utf8")));
  run(process.execPath, ["scripts/workroom-auth-retained-stage.mjs"]);
  run(process.execPath, [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.workroom-financial.config.ts",
    "--fail-on-flaky-tests",
  ]);
  const financialPath = "test-results/workroom-auth/financial-results.json";
  assertPlaywrightReport(JSON.parse(readFileSync(financialPath, "utf8")));
  run(process.execPath, [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.workroom-public-successor.config.ts",
    "--fail-on-flaky-tests",
  ]);
  const publicSuccessorPath =
    "test-results/workroom-auth/public-successor-results.json";
  assertPlaywrightReport(JSON.parse(readFileSync(publicSuccessorPath, "utf8")));
  // Each financial contention case gets a new task-owned 201 database, followed
  // by the exact same 202 cutover and preserved finalization assertions.
  for (const caseId of ["A", "B", "D", "E"]) {
    run("supabase", ["db", "reset", "--local", "--workdir", baseline]);
    for (const phase of ["baseline", "cutover"])
      run(process.execPath, [
        "scripts/workroom-native-runner.mjs",
        `--${phase}`,
        "--stage",
        stage,
        `--principal=${caseId}`,
      ]);
  }
  run(process.execPath, [
    "scripts/workroom-native-runner.mjs",
    "--verify-complete",
    "--stage",
    stage,
  ]);
  cpSync(resolve(stage, "evidence"), "test-results/workroom-native", {
    recursive: true,
  });
  const native = [
    "baseline",
    "cutover",
    ...["A", "B", "D", "E"].flatMap((id) => [
      `principal${id}-baseline`,
      `principal${id}-cutover`,
    ]),
  ].map((phase) => `test-results/workroom-native/${phase}.json`);
  for (const path of native) {
    const report = JSON.parse(readFileSync(path, "utf8"));
    if (
      report.state !== "PASSED" ||
      report.head !== env.CI_HEAD_SHA ||
      !report.records?.length
    )
      throw Error("WORKROOM_NATIVE_INCOMPLETE");
  }
  writeFileSync(
    `${evidence}/receipt.json`,
    JSON.stringify(
      makeReceipt({
        gate: "native-worker-auth",
        startedAt,
        files: [
          ...native,
          browserPath,
          retainedPath,
          financialPath,
          publicSuccessorPath,
          "test-results/workroom-auth/retained-source/provenance.json",
          "test-results/worker/report.json",
        ],
      }),
      null,
      2,
    ) + "\n",
  );
} finally {
  // Copy native diagnostics even when a phase fails. Credentials and Auth DOM are excluded by upload paths.
  try {
    cpSync(resolve(stage, "evidence"), "test-results/workroom-native", {
      recursive: true,
    });
  } catch {
    // A failed startup may not have created a native evidence directory yet.
  }
  if (started) run("supabase", ["stop", "--workdir", baseline, "--no-backup"]);
}
