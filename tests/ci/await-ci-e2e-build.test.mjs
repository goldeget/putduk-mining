import assert from "node:assert/strict";
import test from "node:test";
import { inspectBuild } from "../../scripts/await-ci-e2e-build.mjs";

const expected = { runId: 42, attempt: 2, headSha: "a".repeat(40) };
const run = {
  id: 42,
  run_attempt: 2,
  head_sha: expected.headSha,
  repository: { full_name: "goldeget/putduk-mining" },
};
const job = {
  name: "E2E production build artifact",
  run_attempt: 2,
  status: "completed",
  conclusion: "success",
};

test("only the exact current successful build releases the artifact gate", () => {
  assert.equal(inspectBuild(run, [job], expected), true);
  assert.equal(
    inspectBuild(run, [{ ...job, status: "in_progress" }], expected),
    false,
  );
  assert.equal(
    inspectBuild(run, [{ ...job, run_attempt: 1 }], expected),
    false,
  );
});
test("stale candidates, runs, attempts and repositories are rejected", () => {
  for (const delta of [
    { id: 41 },
    { head_sha: "b".repeat(40) },
    { run_attempt: 1 },
    { repository: { full_name: "other/repo" } },
  ]) {
    assert.throws(
      () => inspectBuild({ ...run, ...delta }, [job], expected),
      /identity mismatch/,
    );
  }
});
test("failed, cancelled and skipped builds never release the gate", () => {
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    assert.throws(
      () => inspectBuild(run, [{ ...job, conclusion }], expected),
      /did not succeed/,
    );
  }
  assert.throws(() => inspectBuild(run, [job, job], expected), /Ambiguous/);
});
