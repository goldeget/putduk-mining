/** Source-bound successor planning and evidence validation; import never starts services. */
import {
  readFileSync,
  realpathSync,
  lstatSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import {
  assertBackend202CanonicalSources,
  assertBackend202LocalSources,
} from "./backend-successor-202-source.mjs";
import { bindBackend197Concurrency } from "./backend-successor-197-concurrency.mjs";
import { readBackend197LocalExecutionProfile } from "./backend-successor-197-local-profile.mjs";
import {
  USDT_195_FROZEN_SOURCES,
  buildKrw195Fixture,
  buildPrincipal195Fixture,
  buildConcurrency195Fixture,
} from "./usdt-manual-195-native-fixture-v3.mjs";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";
import { execFileSync } from "node:child_process";
import { assertBackend202CatalogProof } from "./backend-successor-202-catalog.mjs";
import { backend202HttpPaths } from "./backend-successor-202-http-paths.mjs";
import {
  assertUsdt195Tap,
  assertUsdt195Concurrency,
} from "./usdt-manual-195-results.mjs";
const ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const fail = (reason) => {
  throw Error("BACKEND202_CI_" + reason);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const BACKEND202_UNIT_FILES = Object.freeze([
  "tests/unit/backend-successor-197-source.test.ts",
  "tests/unit/backend-successor-197-consumer.test.ts",
  "tests/unit/backend-successor-197-native-stage.test.ts",
  "tests/unit/usdt-manual-195-native-fixture-v3.test.ts",
  "tests/unit/ci-backend-195-usdt-artifacts-v2.test.ts",
  "tests/unit/usdt-manual-195-runner.test.ts",
  "tests/unit/withdrawal-lifecycle-worker-v2.test.ts",
  "tests/unit/usdt-manual-payout-contract.test.ts",
  "tests/unit/withdrawal-release-hold-receipt.test.ts",
  "tests/unit/nonmoney-award-worker.test.ts",
  "tests/unit/ai-chat-audit-persistence-failure.test.ts",
  "tests/unit/ai-member-help-route.test.ts",
  "tests/unit/ai-persistence-recovery-regression.test.ts",
]);
export function planBackend202Gates(boundary) {
  if (
    boundary?.scope !== "CANONICAL_CI" ||
    boundary.repository !== "goldeget/putduk-mining" ||
    boundary.projectId !== "putduk-mining-ci-r2-20261009" ||
    boundary.apiPort !== 63421 ||
    boundary.dbPort !== 63422 ||
    boundary.migrationSources !== 202 ||
    boundary.evidenceSources !== 334 ||
    boundary.runtimeSources !== 33 ||
    !/^[0-9a-f]{64}$/.test(boundary.manifestSha256 ?? "") ||
    boundary.migrationVersions?.length !== 202
  )
    fail("EXACT_BOUNDARY_REQUIRED");
  return Object.freeze({
    candidate: 202,
    state: "NOT_TESTED",
    wholeCi: "NOT_VERIFIED",
    release: "NOT_VERIFIED",
    uiIntegration: "PENDING",
    gates: Object.freeze(
      [
        {
          id: "unit197",
          command: ["pnpm", "exec", "vitest", "run", ...BACKEND202_UNIT_FILES],
        },
        {
          id: "ownerAdminConcurrency202",
          entry: "scripts/owner-admin-202-concurrency.mjs",
          arguments:
            "EXPLICIT_FLAGS_FRESH_ID_NEW_OWNED_DATABASE_EXTERNAL_OUTPUT",
          expected: {
            connections: 2,
            commits: 1,
            duplicateLosers: 1,
            auth: 1,
            profiles: 1,
            roles: 1,
            audit: 1,
            receipts: 1,
            originalDatabaseApplicationWrites: 0,
          },
          retry: "FORBIDDEN_SAME_CONTAINER",
        },
        {
          id: "nativeConcurrency197",
          entry: "scripts/usdt-manual-202-runner.mjs",
          arguments: "EXPLICIT_FLAGS_FRESH_ID_NEW_EXTERNAL_OUTPUT",
          expected: { krw: 80, principal: 388, concurrency: 41 },
          retry: "FORBIDDEN_SAME_CONTAINER",
        },
        {
          id: "permission197",
          command: [
            "pnpm",
            "exec",
            "supabase",
            "test",
            "db",
            "supabase/tests/database/withdrawal_completion_notification_original.sql",
            "supabase/tests/database/safe_mode_closed_outbox_ack.sql",
            "supabase/tests/database/usdt_manual_full_payout_contract.sql",
            "supabase/tests/database/withdrawal_lifecycle_outbox_ack.sql",
          ],
        },
        {
          id: "http197",
          command: [
            "pnpm",
            "exec",
            "playwright",
            "test",
            "--config",
            "playwright.backend-http-202.config.ts",
            "--project",
            "backend-api",
            "--fail-on-flaky-tests",
          ],
        },
      ].map((g) =>
        Object.freeze({
          ...g,
          required: true,
          skipped: 0,
          flaky: 0,
          expectedFailures: 0,
        }),
      ),
    ),
    wholeWorkflow: "EXISTING11_JOBS_AND20_MINUTE_CONTROLLER_REQUIRED",
    fullUi: "NOT_REPLACED",
  });
}
/** Read artifacts from a completed current runner only. No exit-only, hash-only PASS. */
export function assertBackend202NativeProof(report, files, context) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b),
    epoch = (x) => Number.isSafeInteger(x) && x > 0,
    pin = (x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  const boundary = context?.boundary,
    targetBoundary = context?.executionBoundary ?? boundary;
  if (
    !["LOCAL_QA", "CANONICAL_CI"].includes(context?.scope) ||
    boundary?.scope !== context.scope ||
    boundary?.migrationSources !== 202 ||
    !pin(boundary?.manifestSha256) ||
    !pin(context?.containerId) ||
    !epoch(context?.startedAt) ||
    !epoch(context?.finishedAt) ||
    context.finishedAt < context.startedAt ||
    !context.source ||
    context.source.repository !== "goldeget/putduk-mining" ||
    !/^[0-9a-f]{40}$/.test(context.source.sourceSha ?? "")
  )
    fail("EXECUTION_CONTEXT_REQUIRED");
  if (
    context.scope === "CANONICAL_CI" &&
    (context.source.scope !== "CI" ||
      context.source.worktreeClean !== true ||
      !/^\d+$/.test(context.source.runId ?? "") ||
      !Number.isSafeInteger(context.source.attempt) ||
      context.source.attempt < 1)
  )
    fail("CLEAN_CURRENT_CI_REQUIRED");
  if (
    report?.kind !== "USDT202_NATIVE_CONCURRENCY_EXECUTION" ||
    report.state !== "PASSED" ||
    report.acceptance !== "NATIVE_AND_CONCURRENCY_ONLY" ||
    report.actualTransfers !== false ||
    report.cleanupPerformed !== false ||
    report.scope !== context.scope ||
    !equal(report.source, context.source) ||
    report.sourceManifestSha256 !== boundary.manifestSha256 ||
    report.runnerManifestSha256 !== boundary.manifestSha256 ||
    report.runnerGuardSha256 !== context.guardSha256 ||
    !pin(context.guardSha256) ||
    !epoch(report.startedAt) ||
    !epoch(report.finishedAt) ||
    report.startedAt < context.startedAt ||
    report.finishedAt > context.finishedAt ||
    report.finishedAt < report.startedAt ||
    report.phases?.length !== 3 ||
    report.release !== "NOT_VERIFIED" ||
    report.committedSyntheticFixtures !== true ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(report.runId ?? "")
  )
    fail("CURRENT_NATIVE_EXECUTION_REQUIRED");
  const target = report.target,
    expectedName = "supabase_db_" + targetBoundary.projectId;
  if (
    target?.containerId !== context.containerId ||
    target.containerName !== expectedName ||
    target.volumeName !== expectedName ||
    !epoch(Date.parse(target.createdAt)) ||
    !epoch(Date.parse(target.volumeCreatedAt)) ||
    report.startedAt - Date.parse(target.createdAt) < 0 ||
    report.finishedAt - Date.parse(target.createdAt) > 3600000 ||
    report.startedAt - Date.parse(target.volumeCreatedAt) < 0 ||
    report.finishedAt - Date.parse(target.volumeCreatedAt) > 3600000
  )
    fail("FRESH_OWNED_TARGET_REQUIRED");
  if (
    report.freshPreflight?.exact202 !== true ||
    report.freshPreflight.emptyAuthAndMoney !== true ||
    !epoch(report.freshPreflight.observedAt) ||
    report.freshPreflight.observedAt < report.startedAt ||
    report.freshPreflight.observedAt > report.finishedAt ||
    report.testToolPreparation?.pgtap !== true ||
    report.testToolPreparation.exitCode !== 0
  )
    fail("FRESH_PREFLIGHT_REQUIRED");
  assertBackend202CatalogProof(
    report.freshPreflight.catalog,
    boundary.migrationVersions,
    context.containerId,
    {
      startedAt: report.startedAt,
      observedAt: report.freshPreflight.observedAt,
    },
  );
  if (
    report.executionProfile &&
    (target.createdAt !== report.executionProfile.containerCreatedAt ||
      target.volumeCreatedAt !== report.executionProfile.volumeCreatedAt)
  )
    fail("EXACT_PROFILE_CREATION_REQUIRED");
  const contract = JSON.parse(
    readFileSync(
      resolve(
        ROOT,
        "tests/e2e/fixtures/usdt-manual-195-concurrency-contract.json",
      ),
      "utf8",
    ),
  );
  const expectedRaw = ["krw.tap", "principal.tap", "concurrency.result.json"];
  if (!equal(Object.keys(files).sort(), expectedRaw.sort()))
    fail("EXACT_RAW_ROSTER_REQUIRED");
  let preceding = report.freshPreflight.observedAt;
  for (const [index, id, count] of [
    [0, "krw", 80],
    [1, "principal", 388],
    [2, "concurrency", null],
  ]) {
    const phase = report.phases[index],
      expected = context.derivatives?.[id],
      name = id + (id === "concurrency" ? ".result.json" : ".tap"),
      raw = files[name];
    if (
      phase?.id !== id ||
      phase.state !== "PASSED" ||
      phase.exitCode !== 0 ||
      !epoch(phase.startedAt) ||
      !epoch(phase.finishedAt) ||
      phase.startedAt < preceding ||
      phase.finishedAt > report.finishedAt ||
      phase.finishedAt < phase.startedAt ||
      phase.rawArtifact !== name ||
      typeof raw !== "string" ||
      hash(raw) !== phase.rawArtifactSha256 ||
      !pin(phase.stdoutSha256) ||
      !pin(phase.stderrSha256) ||
      !expected ||
      phase.originalSha256 !== expected.originalSha256 ||
      phase.derivativeSha256 !== expected.sha256 ||
      !equal(phase.changes, expected.changes) ||
      !equal(phase.scopedChanges, expected.scopedChanges) ||
      phase.artifact !== id + (id === "concurrency" ? ".py" : ".sql")
    )
      fail("PHASE_NOT_VERIFIED");
    if (id === "concurrency" && phase.launcherSha256 !== context.launcherSha256)
      fail("LAUNCHER_CHANGED");
    const proof =
      count === null
        ? assertUsdt195Concurrency(raw, 0, context.scope, contract)
        : assertUsdt195Tap(raw, 0, count);
    if (!equal(proof, phase.proof)) fail("PROOF_MISMATCH");
    preceding = phase.finishedAt;
  }
  return Object.freeze({
    candidate: 202,
    native: "VALIDATED",
    release: "NOT_VERIFIED",
    wholeCi: "NOT_VERIFIED",
  });
}
export function verifyBackend202NativeDirectory(output, containerId) {
  const scope = process.platform === "win32" ? "LOCAL_QA" : "CANONICAL_CI";
  const boundary =
    scope === "LOCAL_QA"
      ? assertBackend202LocalSources(ROOT)
      : assertBackend202CanonicalSources(ROOT);
  const profile =
    scope === "LOCAL_QA" ? readBackend197LocalExecutionProfile() : null;
  const expectedParent =
    scope === "LOCAL_QA" ? "D:/PUTDUK-MINING-QA" : process.env.RUNNER_TEMP;
  if (
    !expectedParent ||
    resolve(dirname(output)) !== realpathSync(expectedParent) ||
    realpathSync(output) !== resolve(output) ||
    lstatSync(output).isSymbolicLink() ||
    !/^putduk-mining-usdt202-[0-9a-f-]{36}$/.test(basename(output)) ||
    !/^[0-9a-f]{64}$/.test(containerId) ||
    (profile && profile.containerId !== containerId)
  )
    fail("OWNED_ARTIFACT_DIRECTORY_REQUIRED");
  const names = [
    "execution.json",
    "krw.sql",
    "principal.sql",
    "concurrency.py",
    "krw.tap",
    "principal.tap",
    "concurrency.result.json",
  ];
  const owned = (name) => {
    if (!names.includes(name) && name !== "artifact-manifest.json")
      fail("ARTIFACT_NAME_REJECTED");
    const path = resolve(output, name);
    if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink())
      fail("ARTIFACT_LINK_REJECTED");
    const bytes = readFileSync(path);
    if (bytes.length > 8 * 1024 * 1024) fail("ARTIFACT_SIZE_REJECTED");
    return bytes;
  };
  const manifest = JSON.parse(owned("artifact-manifest.json"));
  if (
    manifest.version !== 1 ||
    manifest.state !== "PASSED" ||
    !Array.isArray(manifest.files) ||
    !equalSorted(
      manifest.files.map((r) => r.path),
      names,
    ) ||
    manifest.files.some(
      (r) =>
        Object.keys(r).sort().join(",") !== "path,sha256" ||
        hash(owned(r.path)) !== r.sha256,
    )
  )
    fail("EXACT_MANIFEST_REQUIRED");
  const report = JSON.parse(owned("execution.json"));
  if (
    report.runId !== manifest.runId ||
    JSON.stringify(report.executionProfile) !== JSON.stringify(profile)
  )
    fail("RUN_OR_PROFILE_MISMATCH");
  const leasePath = resolve(
    dirname(output),
    ".usdt202-container-" + containerId + ".lock",
  );
  if (
    realpathSync(leasePath) !== leasePath ||
    lstatSync(leasePath).isSymbolicLink()
  )
    fail("EXACT_LEASE_REQUIRED");
  const lease = JSON.parse(readFileSync(leasePath));
  if (
    Object.keys(lease).sort().join(",") !== "containerId,output,runId" ||
    lease.containerId !== containerId ||
    lease.output !== resolve(output) ||
    lease.runId !== report.runId
  )
    fail("EXACT_LEASE_REQUIRED");
  const derivatives = {};
  for (const [id, build] of [
    ["krw", buildKrw195Fixture],
    ["principal", buildPrincipal195Fixture],
    ["concurrency", buildConcurrency195Fixture],
  ]) {
    const derivative = build(
      readFileSync(resolve(ROOT, USDT_195_FROZEN_SOURCES[id].path)),
      { fullPayoutConfirmed: true },
    );
    let text = derivative.sql;
    const scoped =
      id === "concurrency"
        ? bindBackend197Concurrency(derivative, scope, profile, containerId)
        : derivative;
    text = scoped.sql;
    derivatives[id] = {
      originalSha256: USDT_195_FROZEN_SOURCES[id].sha256,
      sha256: hash(text),
      scopedChanges: scoped.scopedChanges ?? [],
      changes: derivative.changes.map((c) => ({
        name: c.name,
        beforeSha256: c.beforeSha256,
        afterSha256: c.afterSha256,
        matches: c.matches,
      })),
    };
    if (
      hash(owned(id + (id === "concurrency" ? ".py" : ".sql"))) !==
      derivatives[id].sha256
    )
      fail("DERIVATIVE_CHANGED");
  }
  const source = collectCiSourceEvidence(process.env, (...args) =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    }).trim(),
  );
  const raw = Object.fromEntries(
    ["krw.tap", "principal.tap", "concurrency.result.json"].map((name) => [
      name,
      owned(name).toString("utf8"),
    ]),
  );
  return assertBackend202NativeProof(report, raw, {
    scope,
    boundary,
    containerId,
    source,
    startedAt: Date.now() - 20 * 60000,
    finishedAt: Date.now(),
    guardSha256: hash(
      readFileSync(resolve(ROOT, "scripts/backend-successor-202-source.mjs")),
    ),
    launcherSha256: hash(
      readFileSync(
        resolve(ROOT, "scripts/usdt-manual-197-concurrency-bootstrap.py"),
      ),
    ),
    derivatives,
    executionBoundary: profile
      ? {
          ...boundary,
          projectId: profile.projectId,
          apiPort: profile.apiPort,
          dbPort: profile.dbPort,
        }
      : boundary,
  });
}
function currentCiSource() {
  const source = collectCiSourceEvidence(process.env, (...args) =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    }).trim(),
  );
  if (
    source.scope !== "CI" ||
    source.worktreeClean !== true ||
    process.env.GITHUB_JOB !== "database"
  )
    fail("ACTUAL_DATABASE_CI_REQUIRED");
  return source;
}
export function recordBackend202HttpStart() {
  const boundary = assertBackend202CanonicalSources(ROOT),
    source = currentCiSource();
  const paths = backend202HttpPaths(ROOT),
    output = paths.evidenceOutput,
    intent = paths.intent,
    report = paths.report;
  if (existsSync(intent) || existsSync(report) || existsSync(paths.proof))
    fail("STALE_HTTP_ARTIFACT_REJECTED");
  if (existsSync(output) && realpathSync(output) !== output)
    fail("HTTP_OUTPUT_LINK_REJECTED");
  mkdirSync(output, { recursive: true });
  writeFileSync(
    intent,
    JSON.stringify(
      {
        kind: "BACKEND202_HTTP_CURRENT_INTENT",
        source,
        manifestSha256: boundary.manifestSha256,
        guardSha256: hash(
          readFileSync(
            resolve(ROOT, "scripts/backend-successor-202-source.mjs"),
          ),
        ),
        startedAt: Date.now(),
        command: [
          "playwright",
          "test",
          "--config",
          "playwright.backend-http-202.config.ts",
          "--project",
          "backend-api",
          "--fail-on-flaky-tests",
        ],
        expectedTests: 1,
        uiIntegration: "PENDING",
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return { state: "INTENT_RECORDED_NOT_EXECUTED", expectedTests: 1 };
}
export function assertBackend202HttpReport(
  report,
  intent,
  source,
  boundary,
  now,
) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b),
    epoch = (x) => Number.isSafeInteger(x) && x > 0;
  planBackend202Gates(boundary);
  if (
    !epoch(now) ||
    intent?.kind !== "BACKEND202_HTTP_CURRENT_INTENT" ||
    !epoch(intent.startedAt) ||
    now - intent.startedAt < 0 ||
    now - intent.startedAt > 20 * 60000 ||
    !same(intent.source, source) ||
    source?.scope !== "CI" ||
    source.worktreeClean !== true ||
    intent.manifestSha256 !== boundary?.manifestSha256 ||
    boundary?.migrationSources !== 202 ||
    intent.expectedTests !== 1 ||
    !same(intent.command, [
      "playwright",
      "test",
      "--config",
      "playwright.backend-http-202.config.ts",
      "--project",
      "backend-api",
      "--fail-on-flaky-tests",
    ])
  )
    fail("CURRENT_HTTP_IDENTITY_REQUIRED");
  if (
    report?.config?.configFile !==
      resolve(ROOT, "playwright.backend-http-202.config.ts") ||
    report.config.rootDir !== resolve(ROOT, "tests/e2e/authenticated") ||
    report.config.projects?.length !== 1 ||
    report.config.projects[0].name !== "backend-api" ||
    report.errors?.length !== 0 ||
    report.stats?.expected !== 1 ||
    report.stats.unexpected !== 0 ||
    report.stats.flaky !== 0 ||
    report.stats.skipped !== 0 ||
    !Number.isFinite(report.stats.duration) ||
    report.stats.duration < 0
  )
    fail("HTTP_EXACT_REPORT_REQUIRED");
  const began = Date.parse(report.stats.startTime);
  if (
    !epoch(began) ||
    began < intent.startedAt ||
    began + report.stats.duration > now
  )
    fail("HTTP_CURRENT_CLOCK_REQUIRED");
  const cases = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) cases.push({ spec, test });
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  if (cases.length !== 1) fail("HTTP_EXACT_TEST_INVENTORY_REQUIRED");
  const { spec, test } = cases[0];
  if (
    basename(spec.file ?? "") !== "usdt-manual-full-payout-197.spec.ts" ||
    spec.title !==
      "197 real Auth/step-up → strict manual USDT receipt → ledger and exact replay" ||
    spec.ok !== true ||
    test.projectName !== "backend-api" ||
    test.expectedStatus !== "passed" ||
    test.status !== "expected" ||
    test.results?.length !== 1 ||
    test.results[0].status !== "passed" ||
    test.results[0].retry !== 0 ||
    test.results[0].errors?.length !== 0
  )
    fail("HTTP_NATIVE_AUTH_API_NOT_VERIFIED");
  const result = test.results[0],
    resultStart = Date.parse(result.startTime);
  if (
    !epoch(resultStart) ||
    !Number.isFinite(result.duration) ||
    result.duration < 0 ||
    resultStart < intent.startedAt ||
    resultStart < began ||
    resultStart + result.duration > now ||
    resultStart + result.duration > began + report.stats.duration
  )
    fail("HTTP_TEST_CURRENT_CLOCK_REQUIRED");
  return {
    candidate: 202,
    http: "VALIDATED_CURRENT_EXECUTED_API",
    tests: 1,
    skipped: 0,
    flaky: 0,
    expectedFailures: 0,
    wholeCi: "NOT_VERIFIED",
    uiIntegration: "PENDING",
    release: "NOT_VERIFIED",
  };
}
export function verifyBackend202Http() {
  const boundary = assertBackend202CanonicalSources(ROOT),
    source = currentCiSource(),
    paths = backend202HttpPaths(ROOT),
    output = paths.reportOutput;
  const owned = (name, directory = output) => {
    const path = resolve(directory, name);
    if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink())
      fail("HTTP_ARTIFACT_LINK_REJECTED");
    const bytes = readFileSync(path);
    if (bytes.length > 8 * 1024 * 1024) fail("HTTP_ARTIFACT_SIZE_REJECTED");
    return bytes;
  };
  const raw = owned("report.json"),
    intentBytes = owned("execution-intent.json", paths.evidenceOutput),
    intent = JSON.parse(intentBytes);
  if (
    intent.guardSha256 !==
    hash(
      readFileSync(resolve(ROOT, "scripts/backend-successor-202-source.mjs")),
    )
  )
    fail("HTTP_GUARD_CHANGED");
  const proof = assertBackend202HttpReport(
    JSON.parse(raw),
    intent,
    source,
    boundary,
    Date.now(),
  );
  writeFileSync(
    paths.proof,
    JSON.stringify(
      {
        ...proof,
        source,
        manifestSha256: boundary.manifestSha256,
        reportSha256: hash(raw),
        intentSha256: hash(intentBytes),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  return proof;
}
function equalSorted(a, b) {
  return (
    a.length === b.length &&
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--plan")
      console.log(
        JSON.stringify(
          planBackend202Gates(assertBackend202CanonicalSources()),
          null,
          2,
        ),
      );
    else if (args.length === 1 && args[0] === "--record-http-start")
      console.log(JSON.stringify(recordBackend202HttpStart()));
    else if (args.length === 1 && args[0] === "--verify-http")
      console.log(JSON.stringify(verifyBackend202Http()));
    else if (
      args.length === 2 &&
      args[0].startsWith("--verify-native=") &&
      args[1].startsWith("--fresh-id=")
    )
      console.log(
        JSON.stringify(
          verifyBackend202NativeDirectory(args[0].slice(16), args[1].slice(11)),
        ),
      );
    else fail("EXPLICIT_PLAN_OR_VERIFY_REQUIRED");
  } catch (error) {
    console.error(
      /^BACKEND202_[A-Z0-9_]+$/.test(error?.message ?? "")
        ? error.message
        : "BACKEND202_CI_UNCONFIRMED",
    );
    process.exitCode = 1;
  }
}
