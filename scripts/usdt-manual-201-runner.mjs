/**
 * Explicit, synthetic-only native/concurrency execution. Not a USDT transfer engine.
 * Importing this module never executes checks. CLI has no implicit/default run.
 */
import { spawnSync } from "node:child_process";
import { readBackend201FreshCatalog } from "./backend-successor-201-catalog.mjs";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { basename, dirname, relative, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertBackend201CanonicalSources,
  assertBackend201LocalSources,
} from "./backend-successor-201-source.mjs";
const assertUsdt195RunnerSources = (root, scope) => {
  const candidate =
    scope === "LOCAL_QA"
      ? assertBackend201LocalSources(root)
      : assertBackend201CanonicalSources(root);
  return { candidate, runnerManifestSha256: candidate.manifestSha256 };
};
import {
  USDT_195_FROZEN_SOURCES,
  buildKrw195Fixture,
  buildPrincipal195Fixture,
  buildConcurrency195Fixture,
} from "./usdt-manual-195-native-fixture-v3.mjs";
import {
  parseUsdt195RunnerArguments,
  assertUsdt195Tap,
  assertUsdt195Concurrency,
} from "./usdt-manual-195-results.mjs";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";
import { bindBackend197Concurrency } from "./backend-successor-197-concurrency.mjs";
import { readBackend197LocalExecutionProfile } from "./backend-successor-197-local-profile.mjs";
const ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const LOCAL_ROOT =
  "C:/Users/PC/Desktop/putduk-mining/.worktrees/backend-engine-patch-20261011";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (reason) => {
  throw new Error("USDT195_" + reason);
};

function execute(file, args, env, input, timeout = 30000) {
  const result = spawnSync(file, args, {
    cwd: ROOT,
    env,
    input,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status === null) {
    const error = new Error("USDT195_CHILD_TIMEOUT_OR_ABNORMAL_EXIT");
    error.execution = {
      exitCode: result.status,
      signal: result.signal ?? null,
      timedOut: result.error?.code === "ETIMEDOUT",
      stdoutSha256: hash(result.stdout ?? ""),
      stderrSha256: hash(result.stderr ?? ""),
      finishedAt: Date.now(),
    };
    throw error;
  }
  return result;
}
function jsonOutput(result) {
  if (result.status !== 0) fail("PREFLIGHT_COMMAND_FAILED");
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    fail("PREFLIGHT_JSON_REQUIRED");
  }
}
function environment(scope) {
  if (process.env.NODE_OPTIONS || process.env.NODE_PATH)
    fail("NODE_OVERRIDE_REJECTED");
  if (process.env.APP_ENV !== "test") fail("APP_ENV_TEST_REQUIRED");
  if (
    ["DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"].some(
      (k) => process.env[k],
    )
  )
    fail("REMOTE_DOCKER_ENV_REJECTED");
  const env = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
    "CI",
    "GITHUB_ACTIONS",
    "GITHUB_REPOSITORY",
    "GITHUB_JOB",
    "GITHUB_WORKSPACE",
    "GITHUB_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "CI_HEAD_SHA",
  ])
    if (process.env[key] !== undefined) env[key] = process.env[key];
  env.APP_ENV = "test";
  env.DOCKER_CONTEXT = scope === "LOCAL_QA" ? "desktop-linux" : "default";
  if (scope === "LOCAL_QA") {
    if (
      ROOT !== realpathSync(LOCAL_ROOT) ||
      env.CI ||
      env.GITHUB_ACTIONS ||
      env.GITHUB_JOB
    )
      fail("LOCAL_SCOPE_REQUIRED");
  } else if (
    process.platform !== "linux" ||
    env.CI !== "true" ||
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== "goldeget/putduk-mining" ||
    env.GITHUB_JOB !== "database" ||
    !env.GITHUB_WORKSPACE ||
    realpathSync(env.GITHUB_WORKSPACE) !== ROOT
  )
    fail("ACTUAL_DATABASE_CI_REQUIRED");
  return env; // No production URL, provider key, DB connection string or Python override inherited.
}
function outputDirectory(path, env, scope) {
  const output = resolve(path);
  const allowedParent =
    scope === "LOCAL_QA" ? "D:/PUTDUK-MINING-QA" : env.RUNNER_TEMP;
  if (
    typeof allowedParent !== "string" ||
    resolve(dirname(output)) !== resolve(allowedParent)
  )
    fail("NEW_EXTERNAL_OUTPUT_REQUIRED");
  const parent = realpathSync(dirname(output)),
    expectedParent = realpathSync(allowedParent);
  if (
    parent !== expectedParent ||
    !/^putduk-mining-usdt201-[0-9a-f-]{36}$/.test(basename(output)) ||
    existsSync(output)
  )
    fail("NEW_EXTERNAL_OUTPUT_REQUIRED");
  const location = relative(ROOT, output);
  if (
    !isAbsolute(location) &&
    location !== ".." &&
    !location.startsWith("../") &&
    !location.startsWith("..\\")
  )
    fail("SOURCE_OUTPUT_REJECTED");
  if (scope === "LOCAL_QA") {
    const label = execute(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-Volume -DriveLetter D).FileSystemLabel",
      ],
      env,
    );
    if (label.status !== 0 || label.stdout.trim() !== "ESD-USB")
      fail("AUTHORIZED_QA_VOLUME_REQUIRED");
  }
  mkdirSync(output); // No overwrite or recursive creation.
  return output;
}
function recent(created) {
  const age = Date.now() - Date.parse(created);
  return Number.isFinite(age) && age >= 0 && age <= 60 * 60 * 1000;
}
function dockerTarget(env, boundary, expectedId) {
  const docker = (...args) =>
    execute("docker", ["--context", env.DOCKER_CONTEXT, ...args], env);
  const contexts = jsonOutput(docker("context", "inspect", env.DOCKER_CONTEXT));
  const host = contexts[0]?.Endpoints?.docker?.Host;
  const allowed =
    boundary.scope === "LOCAL_QA"
      ? [
          "npipe:////./pipe/dockerDesktopLinuxEngine",
          "npipe:////./pipe/docker_engine",
        ]
      : ["unix:///var/run/docker.sock"];
  if (contexts.length !== 1 || !allowed.includes(host))
    fail("LOCAL_DOCKER_ENDPOINT_REQUIRED");
  const targetName = "supabase_db_" + boundary.projectId;
  const inspect = jsonOutput(docker("inspect", targetName));
  if (inspect.length !== 1) fail("EXACT_NAMED_CONTAINER_REQUIRED");
  const info = inspect[0];
  const port = info.NetworkSettings?.Ports?.["5432/tcp"];
  const volumeName = "supabase_db_" + boundary.projectId;
  const dataMount = info.Mounts?.filter(
    (m) => m.Destination === "/var/lib/postgresql/data",
  );
  if (
    info.Id !== expectedId ||
    info.Name !== "/" + targetName ||
    info.State?.Running !== true ||
    info.State?.Paused !== false ||
    info.State?.Health?.Status !== "healthy" ||
    info.Config?.Labels?.["com.supabase.cli.project"] !== boundary.projectId ||
    !recent(info.Created) ||
    !Array.isArray(port) ||
    !port.length ||
    port.some((p) => p.HostPort !== String(boundary.dbPort)) ||
    !Array.isArray(dataMount) ||
    dataMount.length !== 1 ||
    dataMount[0].Type !== "volume" ||
    dataMount[0].Name !== volumeName
  )
    fail("FRESH_PROJECT_CONTAINER_REQUIRED");
  // The frozen Python uses psql defaults inside this same container: forbid remote PG defaults.
  for (const item of info.Config?.Env ?? []) {
    const split = item.indexOf("="),
      key = item.slice(0, split),
      value = item.slice(split + 1);
    if (
      (key === "PGHOST" &&
        !["localhost", "127.0.0.1", "/var/run/postgresql"].includes(value)) ||
      (key === "PGPORT" && value !== "5432") ||
      (key === "PGDATABASE" && value !== "postgres") ||
      (key === "PGUSER" && value !== "postgres") ||
      key === "PGSERVICE" ||
      key === "PGSERVICEFILE"
    )
      fail("CONTAINER_REMOTE_PG_DEFAULT_REJECTED");
  }
  const volumes = jsonOutput(docker("volume", "inspect", volumeName));
  if (
    volumes.length !== 1 ||
    volumes[0].Name !== volumeName ||
    !recent(volumes[0].CreatedAt) ||
    Date.parse(volumes[0].CreatedAt) < Date.parse(info.Created) - 60000
  )
    fail("FRESH_VOLUME_REQUIRED");
  return {
    containerId: info.Id,
    containerName: targetName,
    volumeName,
    createdAt: info.Created,
    volumeCreatedAt: volumes[0].CreatedAt,
  };
}
function psql(env, target, source, timeout) {
  return execute(
    "docker",
    [
      "--context",
      env.DOCKER_CONTEXT,
      "exec",
      "-i",
      target.containerId,
      "psql",
      "-X",
      "-q",
      "-A",
      "-t",
      "-w",
      "-h",
      "/var/run/postgresql",
      "-p",
      "5432",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    env,
    "SET statement_timeout='60s'; SET lock_timeout='12s'; SET search_path=public,extensions;\n" +
      source,
    timeout,
  );
}
function assertFreshDatabase(env, target, boundary) {
  return readBackend201FreshCatalog(
    (sql) => psql(env, target, sql, 45000),
    boundary.migrationVersions,
    target.containerId,
  );
}
function safeReason(error) {
  const message = error?.message ?? "";
  return /^(?:USDT195_|BACKEND201_)[A-Z0-9_]+$/.test(message)
    ? message
    : "USDT195_EXECUTION_FAILED";
}

function main() {
  const inputArgs = process.argv.slice(2);
  if (
    inputArgs.length === 2 &&
    inputArgs[0] === "--prepare-test-tool" &&
    /^--fresh-container-id=[0-9a-f]{64}$/.test(inputArgs[1])
  ) {
    const scope = process.platform === "win32" ? "LOCAL_QA" : "CANONICAL_CI";
    const reviewed = assertUsdt195RunnerSources(ROOT, scope),
      env = environment(scope),
      profile =
        scope === "LOCAL_QA" ? readBackend197LocalExecutionProfile() : null;
    const id = inputArgs[1].slice(21);
    if (profile && id !== profile.containerId)
      fail("EXACT_LOCAL_PROFILE_ID_REQUIRED");
    const boundary = profile
      ? {
          ...reviewed.candidate,
          projectId: profile.projectId,
          apiPort: profile.apiPort,
          dbPort: profile.dbPort,
        }
      : reviewed.candidate;
    const target = dockerTarget(env, boundary, id);
    if (
      profile &&
      (target.createdAt !== profile.containerCreatedAt ||
        target.volumeCreatedAt !== profile.volumeCreatedAt)
    )
      fail("EXACT_PROFILE_CREATION_REQUIRED");
    assertFreshDatabase(env, target, reviewed.candidate);
    const result = psql(
      env,
      target,
      "CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;",
      45000,
    );
    if (result.status !== 0) fail("LOCAL_PGTAP_PREPARATION_FAILED");
    console.log(
      JSON.stringify({
        state: "TEST_TOOL_PREPARED_NOT_FINANCIAL_EXECUTION",
        containerId: id,
        migrations: 201,
        emptyAuthAndMoney: true,
        exitCode: 0,
        stdoutSha256: hash(result.stdout),
        stderrSha256: hash(result.stderr),
      }),
    );
    return;
  }
  const args = parseUsdt195RunnerArguments(inputArgs); // Flags first; no implicit run.
  const scope = process.platform === "win32" ? "LOCAL_QA" : "CANONICAL_CI";
  const reviewed = assertUsdt195RunnerSources(ROOT, scope);
  const env = environment(scope);
  const profile =
    scope === "LOCAL_QA" ? readBackend197LocalExecutionProfile() : null;
  if (profile && profile.containerId !== args.containerId)
    fail("EXACT_LOCAL_PROFILE_ID_REQUIRED");
  const executionBoundary = profile
    ? {
        ...reviewed.candidate,
        projectId: profile.projectId,
        apiPort: profile.apiPort,
        dbPort: profile.dbPort,
      }
    : reviewed.candidate;
  // Artifact parent is GitHub runner-owned only; never a caller-provided production path.
  if (scope === "CANONICAL_CI") env.RUNNER_TEMP = process.env.RUNNER_TEMP;
  const source = collectCiSourceEvidence(process.env, (...gitArgs) => {
    const result = execute("git", ["--no-optional-locks", ...gitArgs], env);
    if (result.status !== 0) fail("GIT_IDENTITY_FAILED");
    return result.stdout.trim();
  });
  const output = outputDirectory(args.output, env, scope);
  const report = {
    version: 1,
    kind: "USDT201_NATIVE_CONCURRENCY_EXECUTION",
    state: "EXECUTING",
    release: "NOT_VERIFIED",
    source,
    sourceManifestSha256: reviewed.candidate.manifestSha256,
    runnerManifestSha256: reviewed.runnerManifestSha256,
    scope,
    runId: randomUUID(),
    startedAt: Date.now(),
    phases: [],
    cleanupPerformed: false,
    actualTransfers: false,
    httpAuth: "NOT_TESTED",
    wholeCi: "NOT_INTEGRATED",
  };
  const ownGuardSha = hash(
    readFileSync(resolve(ROOT, "scripts/backend-successor-201-source.mjs")),
  );
  report.runnerGuardSha256 = ownGuardSha;
  const save = () =>
    writeFileSync(
      resolve(output, "execution.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  save();
  try {
    const target = dockerTarget(env, executionBoundary, args.containerId);
    const lease = resolve(
      dirname(output),
      ".usdt201-container-" + args.containerId + ".lock",
    );
    writeFileSync(
      lease,
      JSON.stringify({
        runId: report.runId,
        output,
        containerId: args.containerId,
      }),
      { flag: "wx" },
    );
    // Deliberately retained. A container with committed or timed-out fixtures is never retried.
    if (
      profile &&
      (target.createdAt !== profile.containerCreatedAt ||
        target.volumeCreatedAt !== profile.volumeCreatedAt)
    )
      fail("EXACT_PROFILE_CREATION_REQUIRED");
    report.executionProfile = profile;
    report.target = target;
    const python = jsonOutput(
      execute(
        scope === "LOCAL_QA" ? "python" : "python3",
        [
          "-I",
          "-B",
          "-c",
          'import sys,json,tomllib; print(json.dumps({"version":list(sys.version_info[:3])}))',
        ],
        env,
      ),
    );
    if (
      !Array.isArray(python.version) ||
      python.version.length !== 3 ||
      python.version.some((v) => !Number.isInteger(v)) ||
      python.version[0] !== 3 ||
      python.version[1] < 11
    )
      fail("HOST_PYTHON311_REQUIRED");
    report.hostPythonVersion = python.version;
    const freshCatalog = assertFreshDatabase(env, target, reviewed.candidate);
    report.freshPreflight = {
      exact201: true,
      catalog: freshCatalog,
      emptyAuthAndMoney: true,
      observedAt: Date.now(),
    };
    save();
    const tapTool = psql(
      env,
      target,
      "CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;",
      45000,
    );
    if (tapTool.status !== 0) fail("LOCAL_PGTAP_PREPARATION_FAILED");
    report.testToolPreparation = {
      pgtap: true,
      exitCode: tapTool.status,
      stdoutSha256: hash(tapTool.stdout),
      stderrSha256: hash(tapTool.stderr),
    };
    save();
    const phases = [
      ["krw", buildKrw195Fixture, 80],
      ["principal", buildPrincipal195Fixture, 388],
      ["concurrency", buildConcurrency195Fixture, null],
    ];
    const contract = JSON.parse(
      readFileSync(
        resolve(
          ROOT,
          "tests/e2e/fixtures/usdt-manual-195-concurrency-contract.json",
        ),
        "utf8",
      ),
    );
    for (const [kind, build, expected] of phases) {
      assertUsdt195RunnerSources(ROOT, scope);
      dockerTarget(env, executionBoundary, args.containerId);
      const original = readFileSync(
        resolve(ROOT, USDT_195_FROZEN_SOURCES[kind].path),
      );
      let derivative = build(original, { fullPayoutConfirmed: true });
      if (kind === "concurrency")
        derivative = bindBackend197Concurrency(
          derivative,
          scope,
          profile,
          args.containerId,
        );
      if (
        derivative.changes.length !==
          { krw: 8, principal: 3, concurrency: 2 }[kind] ||
        derivative.changes.some((c) => c.matches !== 1)
      )
        fail("EXACT_DERIVATIVE_CHANGES_REQUIRED");
      const artifact = kind + (kind === "concurrency" ? ".py" : ".sql");
      writeFileSync(resolve(output, artifact), derivative.sql, { flag: "wx" });
      const phase = {
        id: kind,
        state: "EXECUTING",
        startedAt: Date.now(),
        originalSha256: USDT_195_FROZEN_SOURCES[kind].sha256,
        derivativeSha256: derivative.sha256,
        artifact,
        scopedChanges: derivative.scopedChanges ?? [],
        changes: derivative.changes.map((c) => ({
          name: c.name,
          beforeSha256: c.beforeSha256,
          afterSha256: c.afterSha256,
          matches: c.matches,
        })),
      };
      report.phases.push(phase);
      save();
      let result, proof;
      if (kind === "concurrency") {
        const launcher = resolve(
          ROOT,
          "scripts/usdt-manual-197-concurrency-bootstrap.py",
        );
        phase.launcherSha256 = hash(readFileSync(launcher));
        result = execute(
          scope === "LOCAL_QA" ? "python" : "python3",
          ["-I", "-B", launcher, derivative.sha256, args.containerId],
          env,
          derivative.sql,
          300000,
        );
        Object.assign(phase, {
          exitCode: result.status,
          finishedAt: Date.now(),
          stdoutSha256: hash(result.stdout),
          stderrSha256: hash(result.stderr),
        });
        save();
        const rawArtifact =
          kind + (kind === "concurrency" ? ".result.json" : ".tap");
        const safeRaw =
          kind === "concurrency"
            ? result.stdout
            : result.stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) =>
                  /^(?:ok [0-9]+|not ok [0-9]+|1\.\.|#|Bail out!)/.test(line),
                )
                .join("\n") + "\n";
        writeFileSync(resolve(output, rawArtifact), safeRaw, { flag: "wx" });
        phase.rawArtifact = rawArtifact;
        phase.rawArtifactSha256 = hash(safeRaw);
        proof = assertUsdt195Concurrency(
          result.stdout,
          result.status,
          scope,
          contract,
        );
      } else {
        result = psql(env, target, derivative.sql, 600000);
        Object.assign(phase, {
          exitCode: result.status,
          finishedAt: Date.now(),
          stdoutSha256: hash(result.stdout),
          stderrSha256: hash(result.stderr),
        });
        save();
        const rawArtifact =
          kind + (kind === "concurrency" ? ".result.json" : ".tap");
        const safeRaw =
          kind === "concurrency"
            ? result.stdout
            : result.stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) =>
                  /^(?:ok [0-9]+|not ok [0-9]+|1\.\.|#|Bail out!)/.test(line),
                )
                .join("\n") + "\n";
        writeFileSync(resolve(output, rawArtifact), safeRaw, { flag: "wx" });
        phase.rawArtifact = rawArtifact;
        phase.rawArtifactSha256 = hash(safeRaw);
        proof = assertUsdt195Tap(result.stdout, result.status, expected);
      }
      Object.assign(phase, {
        state: "PASSED",
        finishedAt: Date.now(),
        exitCode: result.status,
        stdoutSha256: hash(result.stdout),
        stderrSha256: hash(result.stderr),
        proof,
      });
      save();
    }
    const final = assertUsdt195RunnerSources(ROOT, scope);
    dockerTarget(env, executionBoundary, args.containerId);
    if (
      final.runnerManifestSha256 !== reviewed.runnerManifestSha256 ||
      hash(
        readFileSync(resolve(ROOT, "scripts/backend-successor-201-source.mjs")),
      ) !== ownGuardSha
    )
      fail("SOURCE_CHANGED_DURING_EXECUTION");
    report.state = "PASSED";
    report.acceptance = "NATIVE_AND_CONCURRENCY_ONLY";
    report.committedSyntheticFixtures = true;
  } catch (error) {
    report.state = "FAILED";
    report.reason = safeReason(error);
    const unfinished = report.phases.find((p) => p.state === "EXECUTING");
    if (unfinished) {
      Object.assign(unfinished, error.execution ?? {});
      unfinished.state = "FAILED";
      unfinished.databaseOutcome = "UNKNOWN";
    }
    if (error.execution) report.failureCommand = error.execution;
    report.partialCommitsPossible = true;
    report.databaseOutcome = "UNKNOWN";
    report.automaticRetry = false;
    process.exitCode = 1;
  } finally {
    report.finishedAt = Date.now();
    save();
    const files = [
      "execution.json",
      ...report.phases.flatMap((p) =>
        [p.artifact, p.rawArtifact].filter(Boolean),
      ),
    ];
    writeFileSync(
      resolve(output, "artifact-manifest.json"),
      JSON.stringify(
        {
          version: 1,
          state: report.state,
          runId: report.runId,
          files: files
            .filter((f) => existsSync(resolve(output, f)))
            .map((f) => ({
              path: f,
              sha256: hash(readFileSync(resolve(output, f))),
            })),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(
      JSON.stringify({ state: report.state, release: "NOT_VERIFIED", output }),
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(safeReason(error));
    process.exitCode = 1;
  }
}
