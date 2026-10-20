/** Manual artifact construction only. Imports never build, fetch or deploy. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { resolve, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import {
  productionTarget,
  productionValues,
} from "./production-cloudflare-policy.mjs";
import {
  assertCiEvidence,
  readCiAttemptEvidence,
  ACCOUNT,
  BRANCHES,
} from "./qa-cloudflare-policy.mjs";
import { assertBackend202CanonicalSources } from "./backend-successor-202-source.mjs";
const REPOSITORY = "goldeget/putduk-mining",
  WORKFLOW = ".github/workflows/qa-cloudflare-deploy.yml";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ROLES = Object.freeze(["member", "admin", "landing"]);
const need = (v, r) => {
  if (!v) throw Error("PRODUCTION_ARTIFACT_BLOCKED: " + r);
};
const hash = (v) => createHash("sha256").update(v).digest("hex");
const integer = (v) =>
  /^\d+$/.test(String(v ?? "")) &&
  Number.isSafeInteger(Number(v)) &&
  Number(v) > 0;
function target(role) {
  need(ROLES.includes(role), "role");
  return productionTarget(
    "production-" + role,
    role === "admin" ? "admin" : "member",
  );
}
export function assertProductionDispatch(env, checkout) {
  const sha = env.PRODUCTION_CANDIDATE_SHA,
    branch = env.GITHUB_REF_NAME;
  need(
    env.GITHUB_ACTIONS === "true" &&
      env.CI === "true" &&
      env.GITHUB_REPOSITORY === REPOSITORY &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.PRODUCTION_PURPOSE === "production-artifacts",
    "manual same-repository purpose",
  );
  need(
    /^[a-f0-9]{40}$/.test(sha ?? "") &&
      BRANCHES.includes(branch) &&
      env.GITHUB_REF === `refs/heads/${branch}` &&
      env.GITHUB_SHA === sha &&
      env.GITHUB_WORKFLOW_SHA === sha &&
      env.GITHUB_WORKFLOW_REF ===
        `${REPOSITORY}/${WORKFLOW}@refs/heads/${branch}`,
    "immutable dispatch workflow/ref/SHA",
  );
  need(
    [
      `https://github.com/${REPOSITORY}`,
      `https://github.com/${REPOSITORY}.git`,
    ].includes(checkout.origin) &&
      checkout.head === sha &&
      checkout.remoteSha === sha &&
      checkout.clean,
    "clean exact checkout and current ref",
  );
  need(
    integer(env.GITHUB_RUN_ID) && integer(env.GITHUB_RUN_ATTEMPT),
    "build run identity",
  );
  productionValues(env.PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY, "member");
  const runIds = {},
    attempts = {};
  for (const kind of ["ci", "full", "qa"]) {
    const prefix = "PRODUCTION_" + kind.toUpperCase();
    need(
      integer(env[prefix + "_RUN_ID"]) && integer(env[prefix + "_ATTEMPT"]),
      "accepted run/attempt " + kind,
    );
    runIds[kind] = Number(env[prefix + "_RUN_ID"]);
    attempts[kind] = Number(env[prefix + "_ATTEMPT"]);
  }
  need(
    new Set(Object.values(runIds)).size === 3 &&
      !Object.values(runIds).includes(Number(env.GITHUB_RUN_ID)),
    "distinct prior accepted runs",
  );
  return {
    sha,
    branch,
    runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    runIds,
    attempts,
  };
}
export function productionBuildEnvironment(env, role, home) {
  need(typeof home === "string" && isAbsolute(home), "isolated build HOME");
  const child = {};
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
  ]) {
    if (typeof env[name] === "string") child[name] = env[name];
  }
  return {
    ...child,
    HOME: home,
    USERPROFILE: home,
    CI: "true",
    TZ: "UTC",
    CF_SEND_TELEMETRY: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    ...productionValues(env.PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY, role),
    PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY:
      env.PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
  };
}
export function productionControlEnvironment(env) {
  const allowed = [
    "PATH",
    "Path",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "CI",
    "GITHUB_ACTIONS",
    "GITHUB_REPOSITORY",
    "GITHUB_SHA",
    "GITHUB_REF",
    "GITHUB_REF_NAME",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_JOB",
    "RUNNER_TEMP",
  ];
  return Object.fromEntries(
    allowed
      .filter((name) => typeof env[name] === "string")
      .map((name) => [name, env[name]]),
  );
}
export function assertAcceptedRunEvidence(kind, evidence, identity) {
  need(["ci", "full", "qa"].includes(kind), "evidence kind");
  const { run, jobs, artifacts } = evidence,
    id = identity.runIds[kind],
    attempt = identity.attempts[kind];
  const path =
    kind === "ci"
      ? ".github/workflows/ci.yml"
      : kind === "full"
        ? ".github/workflows/ci-full-e2e.yml"
        : WORKFLOW;
  need(
    run?.id === id &&
      run.run_attempt === attempt &&
      run.repository?.full_name === REPOSITORY &&
      run.head_repository?.full_name === REPOSITORY &&
      run.head_sha === identity.sha &&
      run.head_branch === identity.branch &&
      run.path === path &&
      run.status === "completed" &&
      run.conclusion === "success",
    "accepted exact run identity " + kind,
  );
  need(
    (kind === "ci"
      ? ["push", "pull_request"]
      : ["push", "workflow_dispatch"]
    ).includes(run.event),
    "accepted event " + kind,
  );
  need(
    Array.isArray(jobs) && Array.isArray(artifacts),
    "complete evidence arrays",
  );
  need(
    jobs.every((j) => j.run_id === id && j.run_attempt === attempt),
    "job run/attempt provenance",
  );
  need(
    artifacts.every((a) => a.workflow_run?.id === id),
    "artifact run provenance",
  );
  if (kind === "ci") {
    need(artifacts.length === 6, "exact ordinary artifact roster");
    return assertCiEvidence(evidence, identity.sha);
  }
  const names =
    kind === "full"
      ? [
          "E2E production build artifact",
          ...Array.from(
            { length: 12 },
            (_, i) => `Authenticated product gates (${i + 1}/12)`,
          ),
        ]
      : ["qa"];
  need(
    jobs.length === names.length &&
      new Set(jobs.map((j) => j.name)).size === names.length &&
      names.every((n) => jobs.some((j) => j.name === n)),
    "complete job roster " + kind,
  );
  const start = Date.parse(attempt === 1 ? run.created_at : run.run_started_at),
    end = Date.parse(run.updated_at);
  need(
    Number.isFinite(start) && Number.isFinite(end) && end >= start,
    "attempt clock",
  );
  for (const j of jobs) {
    need(
      j.run_id === id &&
        j.run_attempt === attempt &&
        j.status === "completed" &&
        j.conclusion === "success" &&
        Date.parse(j.completed_at) >= start &&
        Date.parse(j.completed_at) <= end,
      "successful exact attempt job",
    );
    const required =
      kind === "qa"
        ? [
            "Wait for complete existing CI on the exact source candidate",
            "Build once per app and dry-run the identical output without credentials",
            "Deploy existing isolated QA Workers and verify boundaries",
          ]
        : j.name.startsWith("Authenticated product")
          ? ["Run authenticated browser tests"]
          : [];
    for (const name of required)
      need(
        j.steps?.filter(
          (s) =>
            s.name === name &&
            s.status === "completed" &&
            s.conclusion === "success",
        ).length === 1,
        "actual required job step " + name,
      );
  }
  const wanted =
    kind === "full"
      ? [
          "e2e-next-production",
          ...Array.from(
            { length: 12 },
            (_, i) => `authenticated-playwright-shard-${i + 1}`,
          ),
        ]
      : [
          `qa-worker-build-${identity.sha}-${id}-${attempt}`,
          `qa-deployment-receipts-${id}-${attempt}`,
        ];
  need(
    artifacts.length === wanted.length &&
      new Set(artifacts.map((a) => a.name)).size === wanted.length &&
      wanted.every((n) => artifacts.some((a) => a.name === n)),
    "exact artifact roster " + kind,
  );
  for (const a of artifacts)
    need(
      integer(a.id) &&
        a.expired === false &&
        a.size_in_bytes > 0 &&
        /^sha256:[a-f0-9]{64}$/.test(a.digest ?? "") &&
        a.workflow_run?.id === id &&
        a.workflow_run?.head_sha === identity.sha &&
        Date.parse(a.created_at) >= start &&
        Date.parse(a.created_at) <= end,
      "artifact attempt/source provenance",
    );
  return {
    id,
    attempt,
    sha: identity.sha,
    artifacts: [...artifacts]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((a) => ({
        id: a.id,
        name: a.name,
        digest: a.digest,
      })),
  };
}
export function assertProductionBuildOutput(output, role, key) {
  const t = target(role),
    expected = productionValues(key, role),
    { rootConfig, workers, containers } = output ?? {};
  need(
    rootConfig?.accountId === ACCOUNT &&
      rootConfig.buildContext?.mode === `production-${role}` &&
      rootConfig.buildContext.isPreview === false &&
      !rootConfig.unsafe,
    "production account/mode",
  );
  need(
    workers &&
      Object.keys(workers).join() === "default" &&
      Array.isArray(containers) &&
      containers.length === 0,
    "one Worker, no containers",
  );
  const w = workers.default.config;
  need(
    w?.name === t.name &&
      !w.unsafe &&
      !w.cache?.enabled &&
      !(w.triggers ?? []).length &&
      !w.tailConsumers?.length &&
      !w.streamingTailConsumers?.length,
    "exact target/no extra resources",
  );
  need(
    Object.entries(w.exports ?? {}).every(
      ([n, v]) => n === "default" && v.type === "worker" && !v.cache?.enabled,
    ),
    "no extra exports",
  );
  const bindings = w.env ?? {},
    secrets =
      role === "landing" ? [] : ["SUPABASE_SECRET_KEY", "WITHDRAWAL_DATA_KEY"];
  need(
    Object.keys(bindings).length ===
      Object.keys(expected).length + secrets.length,
    "exact public bindings/opaque refs",
  );
  for (const [name, value] of Object.entries(expected))
    need(
      bindings[name]?.type === "text" &&
        bindings[name].value === value &&
        Object.keys(bindings[name]).length === 2,
      "public binding " + name,
    );
  for (const name of secrets)
    need(
      JSON.stringify(bindings[name]) === '{"type":"secret"}',
      "value-free secret reference",
    );
  return { role, mode: `production-${role}`, origin: t.origin, worker: t.name };
}
export function assertProductionFile(name, bytes) {
  need(
    typeof name === "string" &&
      name
        .split("/")
        .every(
          (p) =>
            p &&
            p !== ".." &&
            p !== "." &&
            (!p.startsWith(".") ||
              p === ".assetsignore" ||
              p === ".well-known"),
        ) &&
      !name.includes("\\") &&
      !name.includes(":") &&
      !/\.map$/i.test(name),
    "unsafe/credential/source-map artifact path",
  );
  need(
    !/(?:sb_secret_|github_pat_|gh[pousr]_)[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(
      bytes.toString("utf8"),
    ),
    "credential literal in artifact",
  );
}
export function installBuildGuards() {
  let dotenvReads = 0,
    networkRequests = 0;
  const forbidden = (p) => {
    try {
      const s =
        p instanceof URL
          ? fileURLToPath(p)
          : Buffer.isBuffer(p)
            ? p.toString()
            : String(p);
      return /^\.(?:env|dev\.vars)(?:\.|$)/.test(
        s.replaceAll("\\", "/").split("/").at(-1),
      );
    } catch {
      return false;
    }
  };
  const denyFile = (p) => {
    if (forbidden(p)) {
      dotenvReads++;
      throw Error("PRODUCTION_DOTENV_READ_BLOCKED");
    }
  };
  for (const name of [
    "readFileSync",
    "openSync",
    "readFile",
    "open",
    "createReadStream",
  ]) {
    const original = fs[name];
    fs[name] = function (p, ...args) {
      denyFile(p);
      return original.call(this, p, ...args);
    };
  }
  for (const name of ["readFile", "open"]) {
    const original = fs.promises[name];
    fs.promises[name] = async function (p, ...args) {
      denyFile(p);
      return original.call(this, p, ...args);
    };
  }
  const deny = () => {
    networkRequests++;
    throw Error("PRODUCTION_BUILD_NETWORK_BLOCKED");
  };
  globalThis.fetch = async () => deny();
  for (const builtin of [http, https])
    for (const name of ["request", "get"]) builtin[name] = deny;
  const local = (args) => {
    if (Array.isArray(args[0])) args = args[0];
    const a = args[0];
    if (Array.isArray(a) || a === null) return false;
    if (typeof a === "string")
      return a.startsWith("/") || a.startsWith("\\\\.\\pipe\\");
    const options =
      typeof a === "object"
        ? a
        : typeof args[1] === "object"
          ? args[1]
          : typeof args[2] === "object"
            ? args[2]
            : {};
    const host =
      options.host ??
      options.hostname ??
      (typeof args[1] === "string" ? args[1] : undefined);
    return (
      (typeof a === "object" &&
        typeof a.path === "string" &&
        a.path.startsWith("/")) ||
      [undefined, "localhost", "127.0.0.1", "::1"].includes(host)
    );
  };
  for (const [builtin, name] of [
    [net, "connect"],
    [net, "createConnection"],
    [tls, "connect"],
    [net.Socket.prototype, "connect"],
  ]) {
    const original = builtin[name];
    builtin[name] = function (...args) {
      if (!local(args)) return deny();
      return original.apply(this, args);
    };
  }
  syncBuiltinESMExports();
  return () => {
    need(
      dotenvReads === 0 && networkRequests === 0,
      "build attempted dotenv or network read",
    );
    return { dotenvReads, networkRequests };
  };
}
const git = (...args) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10000,
  }).trim();
function outputDirectory(env) {
  need(
    integer(env.GITHUB_RUN_ID) &&
      integer(env.GITHUB_RUN_ATTEMPT) &&
      env.RUNNER_TEMP,
    "owned output identity",
  );
  const base = fs.realpathSync(env.RUNNER_TEMP);
  return join(
    base,
    `putduk-production-artifacts-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
  );
}
function requestGitHub(env) {
  need(env.GH_TOKEN, "automatic read token");
  return async (path) => {
    const allowed =
      /^\/actions\/runs\/\d+(?:\/attempts\/\d+\/jobs\?per_page=100|\/artifacts\?per_page=100)?$/.test(
        path,
      ) ||
      /^\/git\/ref\/heads\/(?:develop|codex%2Fqa-handoff-diagnostics-20261019)$/.test(
        path,
      ) ||
      new RegExp(
        `^/commits/${env.PRODUCTION_CANDIDATE_SHA}/pulls\\?per_page=100$`,
      ).test(path);
    need(allowed, "read-only exact repository API path");
    const r = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      method: "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(15000),
    });
    need(r.ok, "GitHub metadata HTTP " + r.status);
    return r.json();
  };
}
async function admission(env) {
  // Validate identity before using any input to address remote metadata.
  const local = {
    origin: git("remote", "get-url", "origin"),
    head: git("rev-parse", "HEAD"),
    clean: !git("status", "--porcelain", "--untracked-files=all"),
    remoteSha: env.PRODUCTION_CANDIDATE_SHA,
  };
  let identity = assertProductionDispatch(env, local);
  const request = requestGitHub(env);
  const ref = await request(
    `/git/ref/heads/${encodeURIComponent(identity.branch)}`,
  );
  identity = assertProductionDispatch(env, {
    ...local,
    remoteSha: ref.object?.sha,
  });
  // actions/checkout may omit .git; the existing source admission requires it.
  // Normalize only the already-validated same-repository HTTPS checkout.
  if (local.origin === `https://github.com/${REPOSITORY}`)
    git("remote", "set-url", "origin", `https://github.com/${REPOSITORY}.git`);
  const boundary = assertBackend202CanonicalSources(ROOT),
    accepted = {};
  for (const kind of ["ci", "full", "qa"]) {
    const run = await request(`/actions/runs/${identity.runIds[kind]}`);
    const evidence = await readCiAttemptEvidence(request, run);
    accepted[kind] = assertAcceptedRunEvidence(kind, evidence, identity);
    if (kind === "ci" && run.event === "pull_request") {
      const pulls = await request(
        `/commits/${identity.sha}/pulls?per_page=100`,
      );
      need(
        Array.isArray(pulls) && pulls.length < 100,
        "complete candidate PR collection",
      );
      const pull = pulls.find(
        (p) =>
          p.state === "open" &&
          p.head?.sha === identity.sha &&
          p.head?.repo?.full_name === REPOSITORY &&
          p.base?.repo?.full_name === REPOSITORY &&
          p.base?.ref === "develop",
      );
      need(pull, "same-repository open PR to develop");
      const base = await request("/git/ref/heads/develop");
      need(
        base.object?.sha === pull.base.sha &&
          spawnSync(
            "git",
            ["merge-base", "--is-ancestor", pull.base.sha, identity.sha],
            { cwd: ROOT },
          ).status === 0,
        "CI merge checkout/source differs",
      );
    }
  }
  await recheck(request, identity);
  return {
    identity,
    accepted,
    source: {
      manifestSha256: boundary.manifestSha256,
      migrationSources: boundary.migrationSources,
      evidenceSources: boundary.evidenceSources,
    },
  };
}
async function recheck(request, identity) {
  for (const kind of ["ci", "full", "qa"]) {
    const r = await request(`/actions/runs/${identity.runIds[kind]}`);
    need(
      r.head_sha === identity.sha &&
        r.run_attempt === identity.attempts[kind] &&
        r.status === "completed" &&
        r.conclusion === "success",
      "accepted run changed",
    );
  }
  const ref = await request(
    `/git/ref/heads/${encodeURIComponent(identity.branch)}`,
  );
  need(ref.object?.sha === identity.sha, "candidate branch advanced");
}
function inventory(directory) {
  const files = [];
  function walk(at, prefix = "") {
    for (const name of fs.readdirSync(at).sort()) {
      const path = join(at, name),
        label = prefix + name,
        s = fs.lstatSync(path);
      assertProductionFile(label, Buffer.alloc(0));
      need(!s.isSymbolicLink(), "artifact symlink");
      if (s.isDirectory()) walk(path, label + "/");
      else {
        need(s.isFile(), "artifact regular file");
        const bytes = fs.readFileSync(path);
        assertProductionFile(label, bytes);
        files.push({ path: label, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  walk(directory);
  need(files.length > 0, "empty output");
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
function save(path, value) {
  fs.writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
}
async function child(role, env) {
  need(
    env.PRODUCTION_BUILD_CHILD === "1" &&
      env.PRODUCTION_CHILD_ROLE === role &&
      /^[a-f0-9]{40}$/.test(env.PRODUCTION_CHILD_SHA ?? ""),
    "internal child identity",
  );
  const assertNoAttempts = installBuildGuards(),
    req = createRequire(join(process.cwd(), "package.json"));
  const { createBuilder } = await import(
    pathToFileURL(req.resolve("vite")).href
  );
  const builder = await createBuilder({
    root: process.cwd(),
    mode: `production-${role}`,
    envDir: false,
    clearScreen: false,
  });
  await builder.buildApp();
  save(env.PRODUCTION_CHILD_RECEIPT, {
    role,
    sha: env.PRODUCTION_CHILD_SHA,
    mode: `production-${role}`,
    node: process.version,
    ...assertNoAttempts(),
  });
}
async function main(action, env = { ...process.env }) {
  need(
    process.version === "v24.21.0" && process.platform === "linux",
    "pinned Linux Node24.21 runner",
  );
  if (action === "child") {
    const role = process.argv[3];
    target(role);
    return child(role, env);
  }
  need(["admit", "build"].includes(action), "explicit admit/build only");
  // Keep the automatic read token only in this parent's private argument object;
  // even Git, pnpm-version and tar children inherit no Actions/provider tokens.
  const control = productionControlEnvironment(env);
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, control);
  const pkg = JSON.parse(fs.readFileSync(join(ROOT, "package.json"), "utf8"));
  need(
    pkg.packageManager === "pnpm@12.6.0" &&
      pkg.dependencies.vinext === "1.2.0" &&
      pkg.devDependencies.vite === "8.3.1" &&
      pkg.devDependencies.cf === "1.0.0-beta.18",
    "tool pins",
  );
  const receipt = await admission(env),
    out = outputDirectory(env);
  if (action === "admit") {
    need(!fs.existsSync(out), "new immutable output directory");
    fs.mkdirSync(out);
    save(join(out, "admission.json"), receipt);
    return;
  }
  const previous = JSON.parse(
    fs.readFileSync(join(out, "admission.json"), "utf8"),
  );
  need(
    JSON.stringify(previous) === JSON.stringify(receipt),
    "admission changed before build",
  );
  need(
    execFileSync("pnpm", ["--version"], {
      encoding: "utf8",
      timeout: 10000,
    }).trim() === "12.6.0",
    "pnpm executable pin",
  );
  const { readBuildOutput } = await import(
    new URL(
      "../../@cloudflare/build-output-utils/dist/index.mjs",
      import.meta.resolve("cf"),
    )
  );
  for (const role of ROLES) {
    const home = join(out, `empty-home-${role}`);
    need(!fs.existsSync(home), "fresh role child home");
    fs.mkdirSync(home);
    await recheck(requestGitHub(env), receipt.identity);
    assertBackend202CanonicalSources(ROOT);
    const app = role === "admin" ? join(ROOT, "apps/admin") : ROOT,
      childReceipt = join(out, `child-${role}.json`);
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "child", role],
      {
        cwd: app,
        env: {
          ...productionBuildEnvironment(env, role, home),
          PRODUCTION_BUILD_CHILD: "1",
          PRODUCTION_CHILD_ROLE: role,
          PRODUCTION_CHILD_SHA: receipt.identity.sha,
          PRODUCTION_CHILD_RECEIPT: childReceipt,
        },
        stdio: "inherit",
        timeout: 20 * 60000,
      },
    );
    need(result.status === 0, "production build failed " + role);
    const childEvidence = JSON.parse(fs.readFileSync(childReceipt, "utf8"));
    need(
      childEvidence.role === role &&
        childEvidence.sha === receipt.identity.sha &&
        childEvidence.mode === `production-${role}` &&
        childEvidence.node === "v24.21.0" &&
        childEvidence.dotenvReads === 0 &&
        childEvidence.networkRequests === 0,
      "child evidence",
    );
    const output = await readBuildOutput(app),
      targetProof = assertProductionBuildOutput(
        output,
        role,
        env.PUTDUK_PRODUCTION_SUPABASE_PUBLISHABLE_KEY,
      ),
      built = join(app, ".cloudflare/output/v0"),
      before = inventory(built),
      artifactRole = role === "landing" ? "apex" : role,
      folder = join(out, artifactRole);
    fs.mkdirSync(folder);
    const copy = join(folder, "output/.cloudflare/output/v0");
    fs.mkdirSync(join(folder, "output/.cloudflare/output"), {
      recursive: true,
    });
    fs.cpSync(built, copy, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const copied = inventory(copy);
    need(
      JSON.stringify(copied) === JSON.stringify(before),
      "role output copy changed",
    );
    const files = copied.map((f) => ({
      ...f,
      path: ".cloudflare/output/v0/" + f.path,
    }));
    const archive = `${artifactRole}-${receipt.identity.sha}.tar`,
      archivePath = join(folder, archive);
    need(!fs.existsSync(archivePath), "new immutable archive");
    execFileSync(
      "tar",
      [
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "-cf",
        archivePath,
        "-C",
        folder,
        "output",
      ],
      { timeout: 120000, stdio: "pipe" },
    );
    const archiveHash = createHash("sha256");
    for await (const chunk of fs.createReadStream(archivePath))
      archiveHash.update(chunk);
    save(
      join(folder, `${artifactRole}-${receipt.identity.sha}.manifest.json`),
      {
        schema: "putduk.production-artifact.v1",
        layout: "project-root-v0",
        repository: REPOSITORY,
        candidateSha: receipt.identity.sha,
        runId: receipt.identity.runId,
        attempt: receipt.identity.attempt,
        source: receipt.source,
        runtime: {
          node: process.version,
          pnpm: "12.6.0",
          vite: pkg.devDependencies.vite,
          vinext: pkg.dependencies.vinext,
          cf: pkg.devDependencies.cf,
        },
        ...targetProof,
        role: artifactRole,
        buildRole: role,
        archive: {
          path: archive,
          bytes: fs.statSync(archivePath).size,
          sha256: archiveHash.digest("hex"),
        },
        files,
        treeSha256: hash(JSON.stringify(files)),
        dotenvReads: 0,
        networkRequests: 0,
        acceptedCi: receipt.accepted,
      },
    );
    assertBackend202CanonicalSources(ROOT);
  }
  await recheck(requestGitHub(env), receipt.identity);
  console.log(
    JSON.stringify({
      state: "PRODUCTION_ARTIFACTS_BUILT_NOT_DEPLOYED",
      sha: receipt.identity.sha,
      roles: ["member", "admin", "apex"],
      runId: receipt.identity.runId,
      attempt: receipt.identity.attempt,
    }),
  );
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main(process.argv[2]).catch((error) => {
    console.error(
      error.message.startsWith("PRODUCTION_")
        ? error.message
        : "PRODUCTION_ARTIFACT_BLOCKED: operation failed (details omitted)",
    );
    process.exitCode = 1;
  });
