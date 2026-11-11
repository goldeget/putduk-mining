import { test } from "node:test";
import assert from "node:assert/strict";
import {
  successfulApplication,
  selectBuildArtifact,
} from "./ci-workroom-await-build.mjs";
const identity = { id: 123, attempt: 1, head: "a".repeat(40) };
const run = {
  id: 123,
  run_attempt: 1,
  head_sha: identity.head,
  path: ".github/workflows/ci.yml",
  repository: { full_name: "goldeget/putduk-mining" },
};
const passed = {
  name: "WORKROOM application gates",
  status: "completed",
  conclusion: "success",
};
test("parallel native still waits for exact successful application gates", () => {
  assert.equal(successfulApplication(run, [], identity), false);
  assert.equal(
    successfulApplication(
      run,
      [{ ...passed, status: "in_progress" }],
      identity,
    ),
    false,
  );
  assert.equal(successfulApplication(run, [passed], identity), true);
  for (const invalid of [
    { id: 124 },
    { head_sha: "b".repeat(40) },
    { run_attempt: 2 },
    { path: ".github/workflows/other.yml" },
  ])
    assert.throws(
      () => successfulApplication({ ...run, ...invalid }, [passed], identity),
      /EXACT_BUILD_RUN_REQUIRED/,
    );
  assert.throws(
    () =>
      successfulApplication(
        run,
        [{ ...passed, conclusion: "failure" }],
        identity,
      ),
    /DID_NOT_PASS/,
  );
  assert.throws(
    () => successfulApplication(run, [passed, passed], identity),
    /AMBIGUOUS/,
  );
});
test("wrong, duplicate, expired or digestless build cannot enter browser acceptance", () => {
  const row = {
    id: 9,
    name: `workroom-build-123-1-${identity.head}`,
    expired: false,
    digest: `sha256:${"c".repeat(64)}`,
  };
  assert.equal(selectBuildArtifact([row], identity).id, 9);
  for (const rows of [
    [],
    [row, row],
    [{ ...row, expired: true }],
    [{ ...row, name: row.name + "extra" }],
    [{ ...row, digest: null }],
  ])
    assert.throws(
      () => selectBuildArtifact(rows, identity),
      /EXACT_BUILD_ARTIFACT_REQUIRED/,
    );
});
test("full acceptance admits only its own full application job and workflow", () => {
  const full = { ...identity, profile: "full" };
  const fullRun = { ...run, path: ".github/workflows/ci-full-e2e.yml" };
  const fullJob = { ...passed, name: "WORKROOM full application gates" };
  assert.equal(successfulApplication(fullRun, [fullJob], full), true);
  assert.equal(successfulApplication(fullRun, [passed], full), false);
  assert.throws(
    () => successfulApplication(run, [fullJob], full),
    /EXACT_BUILD_RUN_REQUIRED/,
  );
});
