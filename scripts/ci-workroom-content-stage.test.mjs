import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertWorkroomContentIdentity,
  buildWorkroomContentStage,
} from "./ci-workroom-content-stage.mjs";

const repo = "goldeget/putduk-mining",
  head = "a".repeat(40),
  merge = "b".repeat(40);
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: repo,
  GITHUB_JOB: "application",
  CI_HEAD_SHA: head,
  GITHUB_SHA: merge,
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_EVENT_NAME: "pull_request",
};
const run = {
  id: 123,
  run_attempt: 2,
  head_sha: head,
  workflow_id: 367925044,
  name: "CI",
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  repository: { full_name: repo },
  head_repository: { full_name: repo },
};
const workflow = { id: 367925044, path: run.path, name: "CI" };
const payload = {
  repository: { full_name: repo },
  pull_request: {
    head: { sha: head, repo: { full_name: repo } },
    base: { repo: { full_name: repo } },
    merge_commit_sha: merge,
  },
};
test("actual PR head/merge identity works without rewriting GITHUB_SHA", () => {
  const identity = assertWorkroomContentIdentity(
    env,
    head,
    run,
    workflow,
    payload,
  );
  assert.equal(identity.githubSha, merge);
  assert.equal(env.GITHUB_SHA, merge);
  for (const altered of [
    { ...run, run_attempt: 1 },
    { ...run, head_sha: merge },
    { ...run, workflow_id: 18 },
    { ...run, path: ".github/workflows/unknown.yml" },
    { ...run, head_repository: { full_name: "other/repo" } },
  ])
    assert.throws(() =>
      assertWorkroomContentIdentity(env, head, altered, workflow, payload),
    );
  assert.throws(() =>
    assertWorkroomContentIdentity(
      { ...env, GITHUB_SHA: "c".repeat(40) },
      head,
      run,
      workflow,
      payload,
    ),
  );
});
test("manual dispatch belongs only to exact full workflow ID/path/name and direct head", () => {
  const directEnv = {
    ...env,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: head,
  };
  const full = {
    ...run,
    event: "workflow_dispatch",
    path: ".github/workflows/ci-full-e2e.yml",
    workflow_id: 388834791,
    name: "Full WORKROOM acceptance",
  };
  const fullWorkflow = {
    id: 388834791,
    path: full.path,
    name: "Full authenticated E2E",
  };
  assert.doesNotThrow(() =>
    assertWorkroomContentIdentity(directEnv, head, full, fullWorkflow, payload),
  );
  assert.throws(() =>
    assertWorkroomContentIdentity(
      directEnv,
      head,
      { ...full, path: run.path, workflow_id: 367925044 },
      workflow,
      payload,
    ),
  );
  assert.throws(() =>
    assertWorkroomContentIdentity(
      { ...directEnv, GITHUB_SHA: merge },
      head,
      full,
      fullWorkflow,
      payload,
    ),
  );
});
test("adapter reverses exactly to the frozen original and retains all blob/tree proofs", () => {
  const source = readFileSync(
    new URL("./stage-content-source-ci.mjs", import.meta.url),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const identity = assertWorkroomContentIdentity(
    env,
    head,
    run,
    workflow,
    payload,
  );
  const options = {
    rootPath: "/approved/checkout",
    typescriptUrl: "file:///approved/typescript.js",
    identity,
  };
  const staged = buildWorkroomContentStage(source, options);
  for (const proof of [
    "verifyContentSourceBlob",
    "verifyContentSourceTree",
    "COMMIT_PATH_BLOB_MISMATCH",
    "EXACT_PREFIX_TREE_PIN_REQUIRED",
    "REAL_RUNNER_TEMP_REQUIRED",
    "URL_REWRITE_REJECTED",
  ])
    assert.equal(staged.includes(proof), true);
  assert.equal(staged.includes(`env.GITHUB_SHA === "${merge}"`), true);
  assert.equal(staged.includes("WORKROOM_VERIFIED_RUN_BINDING"), true);
  assert.throws(
    () => buildWorkroomContentStage(source + source, options),
    /EXACT_ADAPTER_SPAN/,
  );
});
