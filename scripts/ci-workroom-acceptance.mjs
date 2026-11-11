/** Disposable CI acceptance. This entry point never contacts the operational project. */
import { execFileSync, spawnSync, spawn } from "node:child_process";
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
const workerd = process.env.WORKROOM_CI_RUNTIME === "workerd";
const profile = process.env.WORKROOM_CI_PROFILE ?? "full";
const smoke = profile === "pr-smoke";
if (!new Set(["full", "pr-smoke"]).has(profile))
  throw Error("WORKROOM_UNKNOWN_PROFILE");
if (smoke && workerd)
  throw Error("WORKROOM_WORKER_RUNTIME_REQUIRES_FULL_ACCEPTANCE");
if (process.env.WORKROOM_CI_RUNTIME && !workerd)
  throw Error("WORKROOM_UNKNOWN_RUNTIME");
const buildReceipt = JSON.parse(
  readFileSync(
    workerd
      ? "test-results/workroom-cloudflare-build/receipt.json"
      : "test-results/workroom-application/receipt.json",
    "utf8",
  ),
);
verifyReceipt(buildReceipt);
if (workerd && buildReceipt.gate !== "cloudflare-build")
  throw Error("WORKROOM_CLOUDFLARE_RECEIPT_REQUIRED");
let env = omitLiveProviders({
  ...process.env,
  APP_ENV: "test",
  NEXT_PUBLIC_APP_ENV: "test",
  APP_TIMEZONE: "UTC",
});
const run = (command, args) =>
  execFileSync(command, args, { stdio: "inherit", env });
const runBrowserSuite = (config, portBase) => {
  const previous = env;
  if (!workerd) {
    env = { ...env };
    if (portBase === undefined) {
      delete env.E2E_WEB_PORT;
      delete env.E2E_ADMIN_PORT;
    } else {
      env.E2E_WEB_PORT = String(portBase);
      env.E2E_ADMIN_PORT = String(portBase + 1);
    }
    delete env.WORKROOM_REUSE_SERVER;
  }
  try {
    run(process.execPath, [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      config,
      "--fail-on-flaky-tests",
    ]);
  } finally {
    env = previous;
  }
};
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
const previewServers = [];
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
  if (workerd) {
    const { inventory } = await import("./ci-workroom-cloudflare-output.mjs");
    const review = JSON.parse(
      readFileSync(
        "test-results/workroom-cloudflare-build/output-review.json",
        "utf8",
      ),
    );
    for (const output of review)
      if (
        JSON.stringify(inventory(output.root)) !==
        JSON.stringify(output.inventory)
      )
        throw Error("WORKROOM_OUTPUT_INVENTORY_CHANGED");
    for (const app of ["member", "admin"])
      previewServers.push(
        spawn(
          process.execPath,
          ["scripts/ci-workroom-workerd-server.mjs", app],
          { env, stdio: "inherit" },
        ),
      );
    for (const port of [3000, 3100]) {
      const deadline = Date.now() + 180000;
      let ready = false;
      while (Date.now() < deadline) {
        if (previewServers.some((child) => child.exitCode !== null))
          throw Error("WORKROOM_PREVIEW_EXITED");
        try {
          const r = await fetch(
            "http://127.0.0.1:" + port + "/__workroom_ci_runtime",
            { signal: AbortSignal.timeout(2000) },
          );
          if (r.ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!ready) throw Error("WORKROOM_PREVIEW_START_TIMEOUT");
    }
    run(process.execPath, ["scripts/ci-workroom-workerd-preflight.mjs"]);
    env.WORKROOM_REUSE_SERVER = "1";
  }
  // Historical first-administrator assertions run before maintenance identities.
  run(process.execPath, [
    "scripts/workroom-native-runner.mjs",
    "--legacy",
    "--stage",
    stage,
  ]);
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
  const legacyWorkerStartedAt = Date.now();
  run("pnpm", ["test:worker"]);
  run(process.execPath, [
    "scripts/ci-workroom-worker-report.mjs",
    "test-results/worker/vitest.json",
    "--started-after",
    String(legacyWorkerStartedAt),
  ]);
  cpSync("test-results/worker", "test-results/workroom-worker-201", {
    recursive: true,
  });
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
    "scripts/ci-workroom-worker-report.mjs",
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
  runBrowserSuite("playwright.workroom.config.ts");
  const browserPath = "test-results/workroom-auth/results.json";
  const browserFiles = readdirSync("tests/e2e/workroom").filter((name) =>
    name.endsWith(".spec.ts"),
  );
  if (browserFiles.length !== 13)
    throw Error("WORKROOM_REVIEWED_BROWSER_ROSTER_CHANGED");
  assertPlaywrightReport(
    JSON.parse(readFileSync(browserPath, "utf8")),
    browserFiles,
  );
  // The PR profile ends after this complete member/admin suite. The full
  // acceptance workflow keeps the retained-data, financial and contention runs.
  if (!smoke) {
    // Isolate browser phases from one another. Regular Next runs get a fresh
    // app process on a dedicated port pair; workerd keeps its preflighted clones.
    runBrowserSuite("playwright.workroom-retained.config.ts", 3200);
    const retainedPath = "test-results/workroom-auth/retained-results.json";
    assertPlaywrightReport(JSON.parse(readFileSync(retainedPath, "utf8")));
    run(process.execPath, ["scripts/workroom-auth-retained-stage.mjs"]);
    runBrowserSuite("playwright.workroom-financial.config.ts", 3300);
    const financialPath = "test-results/workroom-auth/financial-results.json";
    assertPlaywrightReport(JSON.parse(readFileSync(financialPath, "utf8")));
    runBrowserSuite("playwright.workroom-public-successor.config.ts", 3400);
    const publicSuccessorPath =
      "test-results/workroom-auth/public-successor-results.json";
    assertPlaywrightReport(
      JSON.parse(readFileSync(publicSuccessorPath, "utf8")),
    );
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
  }
  cpSync(resolve(stage, "evidence"), "test-results/workroom-native", {
    recursive: true,
  });
  const native = (
    smoke
      ? ["legacy", "baseline", "cutover"]
      : [
          "legacy",
          "baseline",
          "cutover",
          ...["A", "B", "D", "E"].flatMap((id) => [
            `principal${id}-baseline`,
            `principal${id}-cutover`,
          ]),
        ]
  ).map((phase) => `test-results/workroom-native/${phase}.json`);
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
        gate: workerd
          ? "workerd-native-worker-auth"
          : smoke
            ? "native-worker-auth-pr-smoke"
            : "native-worker-auth",
        startedAt,
        files: [
          ...native,
          ...(workerd
            ? [
                "test-results/workroom-cloudflare-runtime/preflight.json",
                "test-results/workroom-cloudflare-runtime/member-clone.json",
                "test-results/workroom-cloudflare-runtime/admin-clone.json",
              ]
            : []),
          browserPath,
          ...(smoke
            ? []
            : [
                "test-results/workroom-auth/retained-results.json",
                "test-results/workroom-auth/financial-results.json",
                "test-results/workroom-auth/public-successor-results.json",
                "test-results/workroom-auth/retained-source/provenance.json",
              ]),
          "test-results/worker/report.json",
          "test-results/workroom-worker-201/report.json",
        ],
      }),
      null,
      2,
    ) + "\n",
  );
} finally {
  for (const server of previewServers) server.kill("SIGTERM");
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
