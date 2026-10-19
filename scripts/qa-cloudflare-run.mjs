import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  lstatSync,
  writeFileSync,
  mkdtempSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ACCOUNT,
  REPOSITORY,
  TARGETS,
  PREVIEW_URL,
  origin,
  qaValues,
  requireQa,
  assertCandidate,
  assertDeployCredentials,
  assertBuildOutput,
  assertCiEvidence,
  readCiAttemptEvidence,
  assertAccess,
  assertCompleteAccessPolicies,
  assertExistingWorker,
  assertWorkerReferences,
} from "./qa-cloudflare-policy.mjs";
import {
  inspectQaZoneRoutes,
  withQaPairPreflight,
} from "./qa-cloudflare-network.mjs";

const root = process.cwd();
const evidenceDir = resolve(root, "test-results/qa-cloudflare");
const env = process.env;
const sha = env.GITHUB_SHA;
const key = env.PUTDUK_QA_SUPABASE_PUBLISHABLE_KEY;
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const read = (name) =>
  JSON.parse(readFileSync(join(evidenceDir, `${name}.json`), "utf8"));
function save(name, data) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, `${name}.json`),
    `${JSON.stringify(data, null, 2)}\n`,
  );
}
async function github(path) {
  requireQa(env.GH_TOKEN, "GitHub read token missing");
  requireQa(path.startsWith("/") && !path.includes(".."), "GitHub path");
  const response = await fetch(
    `https://api.github.com/repos/${REPOSITORY}${path}`,
    {
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  requireQa(response.ok, `GitHub read failed (${response.status})`);
  return response.json();
}
async function freshness() {
  requireQa(
    git("remote", "get-url", "origin").replace(/\.git$/, "") ===
      `https://github.com/${REPOSITORY}`,
    "origin",
  );
  const branch = env.GITHUB_REF_NAME;
  // Validate before the branch name is used in any remote request.
  assertCandidate({
    repository: env.GITHUB_REPOSITORY,
    event: env.GITHUB_EVENT_NAME,
    branch,
    sha,
    remoteSha: sha,
  });
  const ref = await github(`/git/ref/heads/${encodeURIComponent(branch)}`);
  assertCandidate({
    repository: env.GITHUB_REPOSITORY,
    event: env.GITHUB_EVENT_NAME,
    branch,
    sha,
    remoteSha: ref.object?.sha,
  });
  requireQa(
    git("rev-parse", "HEAD") === sha &&
      !git("status", "--porcelain", "--untracked-files=no"),
    "checkout changed",
  );
}
async function ciEvidence(wait) {
  const deadline = Date.now() + (wait ? 25 * 60_000 : 0);
  do {
    await freshness();
    const list = await github(
      `/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=100`,
    );
    requireQa(
      list.total_count === list.workflow_runs?.length,
      "CI pagination incomplete",
    );
    const latest = list.workflow_runs
      .filter((r) => ["push", "pull_request"].includes(r.event))
      .sort((a, b) => b.id - a.id)[0];
    if (latest?.status === "completed") {
      const run = await github(`/actions/runs/${latest.id}`);
      requireQa(run.head_branch === env.GITHUB_REF_NAME, "CI branch");
      if (run.event === "pull_request") {
        const pulls = await github(`/commits/${sha}/pulls?per_page=100`);
        const pull = pulls.find(
          (p) =>
            p.state === "open" &&
            p.head?.sha === sha &&
            p.head?.repo?.full_name === REPOSITORY &&
            p.base?.repo?.full_name === REPOSITORY &&
            p.base?.ref === "develop",
        );
        requireQa(pull, "same-repository PR to develop required");
        const base = await github("/git/ref/heads/develop");
        requireQa(base.object.sha === pull.base.sha, "PR base changed");
        requireQa(
          spawnSync(
            "git",
            ["merge-base", "--is-ancestor", pull.base.sha, sha],
            { cwd: root },
          ).status === 0,
          "PR base is not contained in candidate; merge checkout differs",
        );
      }
      const receipt = assertCiEvidence(
        await readCiAttemptEvidence(github, run),
        sha,
      );
      const current = await github(`/actions/runs/${run.id}`);
      requireQa(
        current.run_attempt === run.run_attempt &&
          current.status === "completed" &&
          current.conclusion === "success",
        "CI changed during admission",
      );
      return receipt;
    }
    requireQa(
      wait && Date.now() < deadline,
      "no completed exact-SHA CI; feature branch requires an open PR",
    );
    await new Promise((done) => setTimeout(done, 15_000));
  } while (true);
}
function run(command, args, directory, extra = {}, quiet = false) {
  const childEnv = { ...env, ...extra };
  for (const name of Object.keys(childEnv))
    if (/^(GH_TOKEN|QA_|PUTDUK_QA_SUPABASE_SECRET_KEY)/.test(name))
      delete childEnv[name];
  const result = spawnSync(command, args, {
    cwd: resolve(root, directory),
    env: childEnv,
    stdio: quiet ? "pipe" : "inherit",
    timeout: 15 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  requireQa(
    result.status === 0,
    `${command} ${args[0]} failed (details omitted for secret safety)`,
  );
}
function manifest(directory) {
  const rows = [];
  function walk(at, relative = "") {
    for (const name of readdirSync(at).sort()) {
      const file = join(at, name);
      const label = `${relative}${name}`;
      const stat = lstatSync(file);
      requireQa(!stat.isSymbolicLink(), "build output symlink");
      if (stat.isDirectory()) {
        walk(file, `${label}/`);
        continue;
      }
      requireQa(
        stat.isFile() && !label.endsWith(".map"),
        "non-file/source map in deploy output",
      );
      const bytes = readFileSync(file);
      if (/\.(?:js|mjs|json|html|txt)$/.test(name)) {
        const text = bytes.toString("utf8");
        requireQa(
          !text.includes("https://osrmyjgmpdspdcwqjwuv.supabase.co") &&
            !/sb_secret_[A-Za-z0-9_-]{10,}/.test(text),
          "live database URL/server secret embedded in build",
        );
      }
      rows.push({
        path: label,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  walk(directory);
  requireQa(rows.length > 0, "empty build");
  return {
    sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    files: rows.length,
  };
}
async function inspectBuild(role) {
  // Resolve the exact helper shipped alongside the pinned cf package in pnpm's isolated layout.
  const { readBuildOutput } = await import(
    new URL(
      "../../@cloudflare/build-output-utils/dist/index.mjs",
      import.meta.resolve("cf"),
    )
  );
  const directory = resolve(root, TARGETS[role].directory);
  const output = await readBuildOutput(directory);
  const target = assertBuildOutput(output, role, key);
  return { ...target, ...manifest(join(directory, ".cloudflare/output/v0")) };
}
async function build() {
  requireQa(process.version === "v24.21.0", "Node pin");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  requireQa(
    pkg.packageManager === "pnpm@12.6.0" &&
      pkg.devDependencies.cf === "1.0.0-beta.18" &&
      pkg.dependencies.vinext === "1.2.0",
    "tool pins",
  );
  const receipt = {
    sha,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    node: process.version,
    pnpm: "12.6.0",
    cf: pkg.devDependencies.cf,
    vinext: pkg.dependencies.vinext,
    workers: {},
  };
  for (const [role, target] of Object.entries(TARGETS)) {
    const values = qaValues(key, role);
    run(
      "pnpm",
      ["exec", "vite", "build", "--mode", "qa"],
      target.directory,
      values,
    );
    receipt.workers[role] = await inspectBuild(role);
    run(
      "pnpm",
      [
        "exec",
        "cf",
        "deploy",
        "--prebuilt",
        "--mode",
        "qa",
        "--dry-run",
        "--no-provision",
      ],
      target.directory,
      values,
    );
    requireQa(
      JSON.stringify(await inspectBuild(role)) ===
        JSON.stringify(receipt.workers[role]),
      "dry run changed build output",
    );
  }
  save("build", receipt);
}
async function cloudflare(path) {
  const allowed = Object.values(TARGETS).some(
    (t) =>
      path === `/workers/workers/${t.workerId}` ||
      path === `/access/apps/${t.accessId}` ||
      path === `/access/apps/${t.accessId}/policies` ||
      ["settings", "subdomain", "schedules", "deployments"].some(
        (part) => path === `/workers/scripts/${t.name}/${part}`,
      ) ||
      new RegExp(`^/workers/scripts/${t.name}/versions/[a-f0-9-]{36}$`).test(
        path,
      ),
  );
  requireQa(allowed, "Cloudflare read path");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`,
    {
      headers: { Authorization: `Bearer ${env.QA_CF_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  requireQa(
    response.ok,
    `Cloudflare read failed (${response.status}); never create missing resources`,
  );
  const data = await response.json();
  requireQa(data.success === true, "Cloudflare read rejected");
  if (
    Object.values(TARGETS).some(
      (target) => path === `/access/apps/${target.accessId}/policies`,
    )
  )
    return assertCompleteAccessPolicies(data);
  requireQa(
    !data.result_info?.total_pages || data.result_info.total_pages === 1,
    "Cloudflare pagination incomplete",
  );
  return data.result;
}
async function inspectRemote(role, phase) {
  const target = TARGETS[role];
  const worker = await cloudflare(`/workers/workers/${target.workerId}`);
  requireQa(
    worker.id === target.workerId &&
      worker.name === target.name &&
      worker.subdomain?.url === origin(role),
    "existing Worker identity",
  );
  assertWorkerReferences(worker, role, phase);
  const routes = await inspectQaZoneRoutes(env.QA_CF_API_TOKEN);
  const app = await cloudflare(`/access/apps/${target.accessId}`);
  const policies = await cloudflare(`/access/apps/${target.accessId}/policies`);
  assertAccess(app, policies, role, target.workerId);
  const state = {};
  for (const part of ["settings", "subdomain", "schedules", "deployments"])
    state[part] = await cloudflare(`/workers/scripts/${target.name}/${part}`);
  return {
    ...assertExistingWorker(state, key, role, phase),
    routes,
    accessDigest: createHash("sha256")
      .update(JSON.stringify({ app, policies }))
      .digest("hex"),
    secretNames: state.settings.bindings
      .filter((b) => b.type === "secret_text")
      .map((b) => b.name)
      .sort(),
  };
}
async function verifyPreviewKeys() {
  requireQa(
    /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(
      env.PUTDUK_QA_SUPABASE_SECRET_KEY ?? "",
    ),
    "dedicated preview server key required",
  );
  for (const [path, apikey] of [
    ["/auth/v1/settings", key],
    ["/rest/v1/", env.PUTDUK_QA_SUPABASE_SECRET_KEY],
  ]) {
    const response = await fetch(`${PREVIEW_URL}${path}`, {
      headers: { apikey },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    requireQa(response.ok, "preview key rejected by exact preview service");
    await response.body?.cancel();
  }
}
async function deploy() {
  requireQa(
    env.RUNNER_OS === "Linux" && env.RUNNER_TEMP?.startsWith("/"),
    "hosted Linux runner required",
  );
  assertDeployCredentials(env);
  requireQa(
    /^\d+$/.test(env.QA_BUILD_ARTIFACT_ID ?? "") &&
      /^[a-f0-9]{64}$/.test(env.QA_BUILD_ARTIFACT_DIGEST ?? ""),
    "immutable build artifact receipt missing",
  );
  const built = read("build");
  requireQa(
    built.sha === sha &&
      built.runId === env.GITHUB_RUN_ID &&
      built.attempt === env.GITHUB_RUN_ATTEMPT,
    "build provenance",
  );
  const { smoke } = await import("./qa-cloudflare-smoke.mjs");
  const receipt = {
    sha,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    state: "PREFLIGHT",
    account: ACCOUNT,
    preview: PREVIEW_URL,
    buildArtifact: {
      id: env.QA_BUILD_ARTIFACT_ID,
      digest: env.QA_BUILD_ARTIFACT_DIGEST,
    },
    workers: {},
  };
  save("deployment", receipt);
  try {
    receipt.ci = await ciEvidence(false);
    await verifyPreviewKeys();
    await withQaPairPreflight(
      async (role) => {
        requireQa(
          JSON.stringify(await inspectBuild(role)) ===
            JSON.stringify(built.workers[role]),
          "artifact changed after dry run",
        );
        receipt.workers[role] = {
          prior: await inspectRemote(role, "before"),
          state: "NOT_DEPLOYED",
        };
        // Both credentials must retrieve a valid existing asset before either mutation.
        receipt.workers[role].accessPreflight = await smoke(role, true);
        return receipt.workers[role];
      },
      async () => {
        save("deployment", receipt);
        const secretDir = mkdtempSync(
          join(env.RUNNER_TEMP, "putduk-qa-secrets-"),
        );
        try {
          const secretFile = join(secretDir, "runtime.json");
          writeFileSync(
            secretFile,
            JSON.stringify({
              SUPABASE_SECRET_KEY: env.PUTDUK_QA_SUPABASE_SECRET_KEY,
            }),
            { mode: 0o600 },
          );
          for (const [role, target] of Object.entries(TARGETS)) {
            receipt.ci = await ciEvidence(false);
            requireQa(
              JSON.stringify(await inspectRemote(role, "before")) ===
                JSON.stringify(receipt.workers[role].prior),
              "remote changed before deploy",
            );
            requireQa(
              JSON.stringify(await inspectBuild(role)) ===
                JSON.stringify(built.workers[role]),
              "prebuilt bytes changed",
            );
            receipt.workers[role].state = "DEPLOYING";
            save("deployment", receipt);
            run(
              "pnpm",
              [
                "exec",
                "cf",
                "deploy",
                "--prebuilt",
                "--mode",
                "qa",
                "--no-provision",
                "--tag",
                sha,
                "--message",
                `QA ${REPOSITORY}@${sha}`,
                "--secrets-file",
                secretFile,
              ],
              target.directory,
              {
                CLOUDFLARE_API_TOKEN: env.QA_CF_API_TOKEN,
                CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
              },
              true,
            );
            const current = await inspectRemote(role, "after");
            receipt.workers[role].current = current;
            save("deployment", receipt);
            requireQa(
              current.accessDigest ===
                receipt.workers[role].prior.accessDigest &&
                JSON.stringify(current.secretNames) ===
                  JSON.stringify(receipt.workers[role].prior.secretNames),
              "Access/secret bindings changed",
            );
            requireQa(
              current.versionId !== receipt.workers[role].prior.versionId,
              "new version not observed",
            );
            const version = await cloudflare(
              `/workers/scripts/${target.name}/versions/${current.versionId}`,
            );
            requireQa(
              version.id === current.versionId &&
                version.annotations?.["workers/tag"] === sha,
              "deployed version SHA tag",
            );
            receipt.workers[role].smoke = await smoke(role, false);
            receipt.workers[role].state = "QA_SMOKE_PASSED";
            save("deployment", receipt);
          }
        } finally {
          // Remove only our two known temporary paths; never recursively clean a runner directory.
          unlinkSync(join(secretDir, "runtime.json"));
          rmdirSync(secretDir);
        }
      },
    );
    receipt.state = "QA_DEPLOYED_NOT_RELEASE_ACCEPTED";
  } catch (error) {
    receipt.state = "FAILED_OR_PARTIAL_REQUIRES_REVIEW";
    // Do not serialize API bodies, error causes, tokens or command output.
    throw error;
  } finally {
    save("deployment", receipt);
  }
}
async function main() {
  const action = process.argv[2];
  if (action === "gate") {
    save("ci", await ciEvidence(true));
    return;
  }
  requireQa(
    env.GITHUB_REPOSITORY === REPOSITORY && /^[a-f0-9]{40}$/.test(sha ?? ""),
    "GitHub context",
  );
  if (action === "build") return build();
  if (action === "deploy") return deploy();
  throw new Error("QA_BLOCKED: unknown action");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error.message?.startsWith("QA_BLOCKED:")
        ? error.message
        : "QA_BLOCKED: execution failed; inspect sanitized receipts",
    );
    process.exitCode = 1;
  });
}
