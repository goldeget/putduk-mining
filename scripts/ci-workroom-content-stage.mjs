/** Reviewed successor context adapter; the historical content stager stays frozen. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  realpathSync,
} from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readGitBlobs } from "./ci-workroom-git-blobs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = "goldeget/putduk-mining";
const origin = `https://github.com/${repository}.git`;
const baseline = "9ccc287c5c05b998a9ad345392e9ff07a03a5836";
const originalPath = "scripts/stage-content-source-ci.mjs";
const workflows = new Map([
  [
    ".github/workflows/ci.yml",
    {
      id: 367925044,
      name: "CI",
      metadataNames: ["CI"],
      events: ["push", "pull_request"],
    },
  ],
  [
    ".github/workflows/ci-full-e2e.yml",
    {
      id: 388834791,
      name: "Full WORKROOM acceptance",
      metadataNames: ["Full authenticated E2E", "Full WORKROOM acceptance"],
      events: ["push", "workflow_dispatch"],
    },
  ],
]);
const need = (value, reason) => {
  if (!value) throw Error("WORKROOM_CONTENT_" + reason);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function contentMergeDiagnostic(
  env,
  checkoutSha,
  payload,
  mergeCommit = null,
) {
  const sha = (value) =>
    typeof value === "string" && /^[a-f0-9]{40}$/.test(value) ? value : null;
  return {
    state: "WORKROOM_CONTENT_MERGE_IDENTITY",
    checkoutSha: sha(checkoutSha),
    githubSha: sha(env.GITHUB_SHA),
    payloadHeadSha: sha(payload?.pull_request?.head?.sha),
    payloadBaseSha: sha(payload?.pull_request?.base?.sha),
    payloadMergeSha: sha(payload?.pull_request?.merge_commit_sha),
    verifiedCommitSha: sha(mergeCommit?.sha),
    verifiedParents: (mergeCommit?.parents ?? []).map((parent) =>
      sha(parent.sha),
    ),
  };
}

export function assertWorkroomContentIdentity(
  env,
  checkoutSha,
  run,
  workflow,
  payload,
  mergeCommit = null,
) {
  const allowed = workflows.get(run?.path);
  need(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_REPOSITORY === repository &&
      env.GITHUB_JOB === "application" &&
      env.CI_HEAD_SHA === checkoutSha &&
      /^[a-f0-9]{40}$/.test(checkoutSha) &&
      /^[0-9]+$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "RUN_ENVIRONMENT",
  );
  need(
    allowed &&
      allowed.events.includes(env.GITHUB_EVENT_NAME) &&
      run.event === env.GITHUB_EVENT_NAME &&
      run.repository?.full_name === repository &&
      run.head_repository?.full_name === repository &&
      String(run.id) === env.GITHUB_RUN_ID &&
      run.run_attempt === Number(env.GITHUB_RUN_ATTEMPT) &&
      run.head_sha === checkoutSha &&
      run.name === allowed.name &&
      run.workflow_id === allowed.id &&
      run.workflow_id === workflow?.id &&
      Number.isSafeInteger(workflow.id) &&
      workflow.id > 0 &&
      workflow.path === run.path &&
      allowed.metadataNames.includes(workflow.name),
    "ACTUAL_RUN_IDENTITY",
  );
  need(payload?.repository?.full_name === repository, "EVENT_REPOSITORY");
  if (run.event === "pull_request") {
    const pr = payload.pull_request;
    need(
      pr?.head?.sha === checkoutSha &&
        pr.head.repo?.full_name === repository &&
        pr.base?.repo?.full_name === repository,
      "PR_HEAD_REPOSITORY_IDENTITY",
    );
    need(
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") &&
        /^[a-f0-9]{40}$/.test(pr.base.sha ?? "") &&
        mergeCommit?.sha === env.GITHUB_SHA &&
        mergeCommit.parents?.length === 2 &&
        mergeCommit.parents[0].sha === pr.base.sha &&
        mergeCommit.parents[1].sha === checkoutSha,
      "PR_MERGE_PARENT_IDENTITY",
    );
  } else need(env.GITHUB_SHA === checkoutSha, "DIRECT_EVENT_HEAD");
  return {
    repository,
    checkoutSha,
    githubSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: env.GITHUB_RUN_ATTEMPT,
    event: run.event,
    workflowId: workflow.id,
    workflowPath: workflow.path,
    workflowName: run.name,
    metadataWorkflowName: workflow.name,
    mergeProof:
      run.event === "pull_request"
        ? {
            sha: mergeCommit.sha,
            parents: mergeCommit.parents.map((parent) => parent.sha),
          }
        : null,
  };
}

export function buildWorkroomContentStage(
  source,
  { rootPath, typescriptUrl, identity },
) {
  const edits = [
    [
      'const ROOT = fileURLToPath(new URL("../", import.meta.url));',
      `const ROOT = ${JSON.stringify(rootPath)};`,
    ],
    [
      'import ts from "typescript";',
      `import ts from ${JSON.stringify(typescriptUrl)};`,
    ],
    [
      '["push", "pull_request"].includes(env.GITHUB_EVENT_NAME)',
      `env.GITHUB_EVENT_NAME === ${JSON.stringify(identity.event)}`,
    ],
    [
      "env.GITHUB_SHA === checkoutSha",
      `(env.CI_HEAD_SHA === checkoutSha && env.GITHUB_SHA === ${JSON.stringify(identity.githubSha)})`,
    ],
    [
      "export function assertContentSourceCiContext(env, origin, checkoutSha) {",
      `export function assertContentSourceCiContext(env, origin, checkoutSha) {\n  need(env.GITHUB_RUN_ID === ${JSON.stringify(identity.runId)} && env.GITHUB_RUN_ATTEMPT === ${JSON.stringify(identity.attempt)} && checkoutSha === ${JSON.stringify(identity.checkoutSha)}, "WORKROOM_VERIFIED_RUN_BINDING");`,
    ],
  ];
  let staged = source;
  for (const [before, after] of edits) {
    need(staged.split(before).length === 2, "EXACT_ADAPTER_SPAN");
    staged = staged.replace(before, () => after);
  }
  let inverse = staged;
  for (const [before, after] of [...edits].reverse()) {
    need(inverse.split(after).length === 2, "EXACT_INVERSE_SPAN");
    inverse = inverse.replace(after, () => before);
  }
  need(inverse === source, "INVERSE_SOURCE_CHANGED");
  return staged;
}

async function main() {
  const env = process.env;
  need(
    process.argv.length === 2 && env.GH_TOKEN && env.GITHUB_EVENT_PATH,
    "ACTUAL_TOKEN_AND_EVENT_REQUIRED",
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  need(git("remote", "get-url", "origin") === origin, "EXACT_ORIGIN");
  const checkoutSha = git("rev-parse", "HEAD");
  need(/^[0-9]+$/.test(env.GITHUB_RUN_ID ?? ""), "RUN_ID");
  const request = async (path) => {
    need(
      /^(?:\/actions\/(?:runs\/[0-9]+|workflows\/ci(?:-full-e2e)?\.yml)|\/git\/commits\/[a-f0-9]{40})$/.test(
        path,
      ),
      "API_SCOPE",
    );
    const response = await fetch(
      `https://api.github.com/repos/${repository}${path}`,
      {
        redirect: "error",
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    need(response.ok, "RUN_API_" + response.status);
    return response.json();
  };
  const run = await request(`/actions/runs/${env.GITHUB_RUN_ID}`);
  need(workflows.has(run.path), "WORKFLOW_SCOPE");
  const workflow = await request(
    `/actions/workflows/${run.path.split("/").at(-1)}`,
  );
  const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  console.error(
    JSON.stringify(contentMergeDiagnostic(env, checkoutSha, payload)),
  );
  let mergeCommit = null;
  if (run.event === "pull_request") {
    need(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ""), "PR_MERGE_SHA_REQUIRED");
    mergeCommit = await request(`/git/commits/${env.GITHUB_SHA}`);
    console.error(
      JSON.stringify(
        contentMergeDiagnostic(env, checkoutSha, payload, mergeCommit),
      ),
    );
  }
  const identity = assertWorkroomContentIdentity(
    env,
    checkoutSha,
    run,
    workflow,
    payload,
    mergeCommit,
  );
  const source = readFileSync(resolve(root, originalPath), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const preserved = readGitBlobs(root, baseline, [originalPath])
    .get(originalPath)
    .toString("utf8")
    .replaceAll("\r\n", "\n");
  need(source === preserved, "FROZEN_ORIGINAL_CHANGED");
  const temp = realpathSync(env.RUNNER_TEMP);
  need(temp === resolve(env.RUNNER_TEMP), "REAL_RUNNER_TEMP");
  const directory = mkdtempSync(resolve(temp, "workroom-content-context-"));
  const output = resolve(directory, "stage.mjs");
  const staged = buildWorkroomContentStage(source, {
    rootPath: realpathSync(root),
    typescriptUrl: pathToFileURL(
      createRequire(import.meta.url).resolve("typescript"),
    ).href,
    identity,
  });
  writeFileSync(output, staged, { mode: 0o600, flag: "wx" });
  const provenance = {
    kind: "WORKROOM_CONTENT_CONTEXT_ADAPTER",
    identity,
    baseline,
    originalPath,
    sourceSha256: hash(source),
    stagedSha256: hash(staged),
    inverseExact: true,
    retainedProofs:
      "all original source pins, commit/tree/blob hashes, bounded source reads, symlink/path checks and fixture output guards",
  };
  const provenancePath = resolve(directory, "provenance.json");
  writeFileSync(provenancePath, JSON.stringify(provenance, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  const stdout = execFileSync(process.execPath, [output], {
    cwd: root,
    // Checkout credentials are deliberately not persisted. A missing historical
    // object may be fetched only from this exact approved repository URL.
    env: {
      ...env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `http.${origin}.extraheader`,
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${env.GH_TOKEN}`).toString("base64")}`,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const result = JSON.parse(stdout.trim());
  console.log(JSON.stringify({ ...result, adapterProvenance: provenancePath }));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      /^WORKROOM_CONTENT_[A-Z0-9_]+$/.test(error?.message ?? "")
        ? error.message
        : "WORKROOM_CONTENT_STAGE_FAILED",
    );
    process.exitCode = 1;
  });
