import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Transform } from "node:stream";
import {
  assertCiTestTarget,
  assertLocalApiUrl,
  assertLocalDbUrl,
  LIVE_EXTERNAL_ENV_KEYS,
  loadJobLocalAllowlist,
} from "./capture-local-supabase-env.mjs";
import { assertBackend201BrowserCanonicalSources } from "./backend-successor-201-browser-source.mjs";

const root = process.cwd();
const evidence = resolve(root, "test-results/workerd-auth");
const specs = [
  "public-admin-boundary.spec.ts",
  "admin-session-totp.spec.ts",
  "first-krw-withdrawal.spec.ts",
  "first-usdt-withdrawal.spec.ts",
  "withdrawal-negative-guards.spec.ts",
];
const children = [];
const varsFiles = [];
const logStreams = [];
const ownedPids = new Map();
let privateDir;
let aborted = false;
let cleanupPromise;
let accepted = false;
let contextAdmitted = false;
const result = { state: "NOT_ACCEPTED", specs, processes: [], cleanup: [] };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const required = (key) => {
  const value = process.env[key];
  assert.ok(value && !/[\r\n]/.test(value), `Missing/single-line ${key}`);
  return value;
};
const secrets = [];
const redact = (value) => {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
  return text
    .replace(
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      "[LOCAL_JWT]",
    )
    .replace(/Putduk-test-[A-Za-z0-9-]+/g, "[LOCAL_TEST_PASSWORD]");
};

function logPipe(source, label) {
  const file = createWriteStream(resolve(evidence, label));
  file.on("error", () => {
    file.writeFailed = true;
    aborted = true;
  });
  let pending = "";
  const filter = new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString("utf8");
      if (pending.length > 1048576)
        return callback(new Error("WORKERD_LOG_LINE_LIMIT"));
      const lines = pending.split("\n");
      pending = lines.pop();
      callback(null, lines.map((line) => redact(line) + "\n").join(""));
    },
    flush(callback) {
      callback(null, redact(pending));
    },
  });
  filter.on("error", () => {
    aborted = true;
  });
  source.pipe(filter).pipe(file);
  logStreams.push(file);
}

function launch(label, cwd, args, env) {
  const child = spawn("pnpm", args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.label = label;
  child.once("error", () => {
    child.launchFailed = true;
  });
  children.push(child);
  if (child.pid) captureTree(child.pid, label);
  logPipe(child.stdout, `${label}.stdout.log`);
  logPipe(child.stderr, `${label}.stderr.log`);
  return child;
}

function processIdentity(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = text
      .slice(text.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
    return {
      pid,
      parent: Number(fields[1]),
      group: Number(fields[2]),
      start: fields[19],
    };
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return null;
    throw error;
  }
}
function captureTree(pid, label, expectedParent, seen = new Set()) {
  if (seen.has(pid)) return;
  assert.ok(seen.size < 500, "Owned descendant limit exceeded");
  seen.add(pid);
  const identity = processIdentity(pid);
  if (
    !identity ||
    (expectedParent !== undefined && identity.parent !== expectedParent)
  )
    return;
  const previous = ownedPids.get(pid);
  if (previous && previous.start !== identity.start) return; // Never follow a reused PID.
  ownedPids.set(pid, { ...identity, label });
  try {
    const ids = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const value of ids) captureTree(Number(value), label, pid, seen);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
  }
}
function captureAll() {
  for (const child of children)
    if (child.pid) captureTree(child.pid, child.label);
  for (const [pid, known] of ownedPids) {
    const now = processIdentity(pid);
    if (now?.start === known.start)
      ownedPids.set(pid, { ...known, group: now.group });
  }
}
function ownsGroup(group) {
  const leader = ownedPids.get(group);
  if (!leader) return false;
  const currentLeader = processIdentity(group);
  if (
    currentLeader &&
    (currentLeader.start !== leader.start || currentLeader.group !== group)
  )
    return false;
  return [...ownedPids.values()].some((known) => {
    const current = processIdentity(known.pid);
    return current?.start === known.start && current.group === group;
  });
}

async function unusedPort(port) {
  const server = createServer();
  await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", ok);
  });
  await new Promise((ok, fail) =>
    server.close((error) => (error ? fail(error) : ok())),
  );
}

async function startWorker(label, cwd, port, env) {
  await unusedPort(port);
  const child = launch(
    label,
    cwd,
    [
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      resolve(privateDir, `${label}-state`),
    ],
    env,
  );
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    captureAll();
    assert.ok(
      !aborted &&
        !child.launchFailed &&
        child.exitCode === null &&
        child.signalCode === null,
      `${label} failed to start`,
    );
    try {
      const response = await fetch(`http://127.0.0.1:${port}/login`, {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch {
      /* Wait only for this owned process. */
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(`${label} workerd startup exceeded120s`);
}

function putVars(cwd, vars) {
  assert.ok(
    !readdirSync(cwd).some(
      (name) => name === ".dev.vars" || name.startsWith(".dev.vars."),
    ),
    "Existing Wrangler variable files are protected",
  );
  const path = join(cwd, ".dev.vars");
  const bytes = Buffer.from(
    Object.entries(vars)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
  );
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  const stat = lstatSync(path);
  varsFiles.push({ path, dev: stat.dev, ino: stat.ino, hash: hash(bytes) });
}

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    const failures = [];
    captureAll();
    for (const child of [...children].reverse()) {
      if (!child.pid) continue;
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        if (!groupExists(child.pid)) break;
        // Recheck after every wait, including immediately before SIGKILL.
        if (!ownsGroup(child.pid)) {
          failures.push(
            `Unproven or reused PGID preserved before ${signal}: ${child.pid}`,
          );
          break;
        }
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if (error.code !== "ESRCH") failures.push(error.message);
        }
        const deadline = Date.now() + 5000;
        while (groupExists(child.pid) && Date.now() < deadline)
          await new Promise((ok) => setTimeout(ok, 100));
      }
      const removed = !groupExists(child.pid);
      result.processes.push({
        label: child.label,
        pid: child.pid,
        exitCode: child.exitCode,
        signal: child.signalCode,
        groupRemoved: removed,
      });
      if (!removed) failures.push(`Owned PGID remains ${child.pid}`);
    }
    // Chromium may detach its own groups. Track descendants while alive, then
    // clean only groups whose leader was itself a recorded owned descendant.
    for (const group of new Set(
      [...ownedPids.values()].map((item) => item.group),
    )) {
      if (!groupExists(group)) continue;
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        if (!groupExists(group)) break;
        // Detached descendants need the same fresh identity check per signal.
        if (!ownsGroup(group)) {
          failures.push(
            `Unproven or reused descendant PGID preserved before ${signal}: ${group}`,
          );
          break;
        }
        try {
          process.kill(-group, signal);
        } catch (error) {
          if (error.code !== "ESRCH") failures.push(error.message);
        }
        const deadline = Date.now() + 5000;
        while (groupExists(group) && Date.now() < deadline)
          await new Promise((ok) => setTimeout(ok, 100));
      }
      if (groupExists(group))
        failures.push(`Owned descendant PGID remains ${group}`);
    }
    const remaining = [...ownedPids.values()].filter(
      (known) => processIdentity(known.pid)?.start === known.start,
    );
    result.ownedProcessIdentities = ownedPids.size;
    result.remainingOwnedPids = remaining.map((item) => item.pid);
    if (remaining.length) failures.push("Owned descendant processes remain");
    for (const file of varsFiles) {
      try {
        const stat = lstatSync(file.path);
        assert.ok(
          !stat.isSymbolicLink() &&
            stat.dev === file.dev &&
            stat.ino === file.ino &&
            hash(readFileSync(file.path)) === file.hash,
          "Variable file replaced; preserve it",
        );
        unlinkSync(file.path);
        result.cleanup.push({
          file: file.path.endsWith("apps/admin/.dev.vars")
            ? "admin/.dev.vars"
            : "member/.dev.vars",
          removed: true,
        });
      } catch (error) {
        failures.push(redact(error.message));
      }
    }
    if (privateDir) {
      assert.equal(dirname(realpathSync(privateDir)), realpathSync(tmpdir()));
      assert.ok(basename(privateDir).startsWith("putduk-workerd-auth-"));
      rmSync(privateDir, { recursive: true, force: true });
    }
    await Promise.all(
      logStreams.map(
        (stream) =>
          new Promise((ok) => {
            if (stream.writableFinished || stream.closed) return ok();
            const timer = setTimeout(() => {
              failures.push("Sanitized log flush timed out");
              stream.destroy();
              ok();
            }, 5000);
            const finish = () => {
              clearTimeout(timer);
              ok();
            };
            stream.once("finish", finish);
            stream.once("close", finish);
          }),
      ),
    );
    if (logStreams.some((stream) => stream.writeFailed))
      failures.push("Sanitized log write failed");
    result.cleanupFailures = failures;
    return failures;
  })();
  return cleanupPromise;
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    aborted = true;
    void cleanup()
      .catch((error) => {
        result.signalCleanupFailure = redact(error.message);
      })
      .finally(() => {
        process.exitCode = 1;
      });
  });
}

try {
  assert.equal(process.platform, "linux");
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.GITHUB_REPOSITORY, "goldeget/putduk-mining");
  assert.equal(process.env.APP_ENV, "test");
  assert.equal(process.env.PUTDUK_BACKEND_SOURCE_REVISION, "201");
  const candidate = required("CI_HEAD_SHA");
  assert.match(candidate, /^[0-9a-f]{40}$/);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    candidate,
  );
  assert.equal(
    execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim(),
    "https://github.com/goldeget/putduk-mining.git",
  );
  contextAdmitted = true;
  assertCiTestTarget();
  const allow = loadJobLocalAllowlist();
  assert.equal(allow.projectId, "putduk-mining-ci-r2-20261009");
  assertLocalApiUrl(required("NEXT_PUBLIC_SUPABASE_URL"), allow);
  assertLocalDbUrl(required("LOCAL_SUPABASE_DB_URL"), allow);
  assert.equal(required("LOCAL_SUPABASE_PROJECT_ID"), allow.projectId);
  assert.equal(
    Buffer.from(required("WITHDRAWAL_DATA_KEY"), "base64").length,
    32,
  );
  try {
    assertBackend201BrowserCanonicalSources();
  } catch (error) {
    // Keep admission strict; record filenames only when a build changed source.
    // Never emit file contents, environment values or a permissive fallback.
    try {
      result.sourceStatus = execFileSync(
        "git",
        ["status", "--porcelain", "--untracked-files=all"],
        { cwd: root, encoding: "utf8", timeout: 10000 },
      )
        .trim()
        .split("\n")
        .filter(Boolean)
        .slice(0, 100);
    } catch (statusError) {
      result.sourceStatusError = String(statusError.code ?? "STATUS_FAILED");
    }
    throw error;
  }
  for (const cwd of [root, resolve(root, "apps/admin")])
    assert.ok(
      existsSync(resolve(cwd, ".open-next/worker.js")),
      "Build artifact missing; no Next fallback",
    );
  const vars = {
    APP_ENV: "test",
    APP_TIMEZONE: "UTC",
    NEXT_PUBLIC_APP_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
    ADMIN_APP_URL: "http://127.0.0.1:3100",
    PUTDUK_WORKERD_LOCAL_AUTH_SCOPE: "ci-auth-v1",
    PUTDUK_WORKERD_LOCAL_ALLOWLIST: JSON.stringify(allow),
    NEXT_PUBLIC_SUPABASE_URL: required("NEXT_PUBLIC_SUPABASE_URL"),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ),
    SUPABASE_SECRET_KEY: required("SUPABASE_SECRET_KEY"),
    WITHDRAWAL_DATA_KEY: required("WITHDRAWAL_DATA_KEY"),
  };
  secrets.push(
    vars.SUPABASE_SECRET_KEY,
    vars.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    vars.WITHDRAWAL_DATA_KEY,
    required("LOCAL_SUPABASE_DB_URL"),
  );
  mkdirSync(evidence, { recursive: true });
  privateDir = mkdtempSync(join(tmpdir(), "putduk-workerd-auth-"));
  const env = {
    ...process.env,
    ...vars,
    WRANGLER_SEND_METRICS: "false",
    CI_WORKERD_AUTH: "1",
    E2E_WEB_PORT: "3000",
    E2E_ADMIN_PORT: "3100",
    WORKERD_AUTH_OUTPUT_DIR: resolve(privateDir, "playwright-results"),
    PLAYWRIGHT_JSON_OUTPUT_NAME: resolve(privateDir, "playwright-report.json"),
  };
  for (const key of [
    ...LIVE_EXTERNAL_ENV_KEYS,
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_EMAIL",
  ])
    delete env[key];
  putVars(root, vars);
  putVars(resolve(root, "apps/admin"), vars);
  await startWorker("member", root, 3000, env);
  await startWorker("admin", resolve(root, "apps/admin"), 3100, env);
  const child = launch(
    "playwright",
    root,
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.workerd-authenticated.config.ts",
    ],
    env,
  );
  const deadline = Date.now() + 900000;
  while (
    child.exitCode === null &&
    child.signalCode === null &&
    !child.launchFailed &&
    !aborted &&
    Date.now() < deadline
  ) {
    captureAll();
    await new Promise((ok) => setTimeout(ok, 250));
  }
  assert.ok(
    !aborted && !child.launchFailed,
    "Playwright launch/interruption failure",
  );
  assert.equal(
    child.exitCode,
    0,
    "Real workerd authenticated tests failed or timed out",
  );
  const report = JSON.parse(
    readFileSync(env.PLAYWRIGHT_JSON_OUTPUT_NAME, "utf8"),
  );
  assert.equal(report.stats.unexpected, 0);
  assert.equal(report.stats.flaky, 0);
  assert.equal(report.stats.skipped, 0);
  const files = new Set();
  let count = 0;
  const walk = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        files.add(basename(spec.file));
        for (const test of spec.tests ?? []) {
          assert.equal(test.projectName, "chromium");
          assert.equal(test.results.length, 1);
          assert.equal(test.results[0].status, "passed");
          count++;
        }
      }
      walk(suite.suites);
    }
  };
  walk(report.suites);
  assert.deepEqual([...files].sort(), [...specs].sort());
  assert.ok(count >= specs.length);
  assert.equal(report.stats.expected, count);
  Object.assign(result, {
    candidate,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    testsPassed: count,
    skipped: 0,
    flaky: 0,
    browser: "chromium",
    runtime: "wrangler --local/workerd",
    sourceGuard: "canonical201",
    artifactsRebuiltByRunner: false,
  });
  accepted = true;
} catch (error) {
  result.failure = redact(error.message);
  process.exitCode = 1;
} finally {
  let failures;
  try {
    failures = await cleanup();
  } catch (error) {
    failures = [redact(`Cleanup exception: ${error.message}`)];
    result.cleanupFailures = failures;
  }
  if (failures.length || aborted) {
    accepted = false;
    process.exitCode = 1;
  }
  result.state = accepted
    ? "FIVE_CRITICAL_SPECS_PASS_OWN_RESOURCES_REMOVED"
    : "NOT_ACCEPTED";
  if (contextAdmitted) {
    mkdirSync(evidence, { recursive: true });
    writeFileSync(
      resolve(evidence, "receipt.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
  }
  console.log(result.state);
}
