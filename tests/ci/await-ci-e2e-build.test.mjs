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

const lifecycle = {
  name: "WebServer lifecycle probe",
  run_attempt: 2,
  status: "completed",
  conclusion: "success",
};

test("only the exact current successful build and lifecycle release the artifact gate", () => {
  assert.equal(inspectBuild(run, [job, lifecycle], expected), true);
  assert.equal(
    inspectBuild(run, [{ ...job, status: "in_progress" }, lifecycle], expected),
    false,
  );
  assert.equal(
    inspectBuild(run, [{ ...job, run_attempt: 1 }, lifecycle], expected),
    false,
  );
});
test("missing, stale or unfinished lifecycle never releases a successful build", () => {
  assert.equal(inspectBuild(run, [job], expected), false);
  assert.equal(
    inspectBuild(run, [job, { ...lifecycle, run_attempt: 1 }], expected),
    false,
  );
  assert.equal(
    inspectBuild(
      run,
      [job, { ...lifecycle, status: "in_progress", conclusion: null }],
      expected,
    ),
    false,
  );
  assert.equal(inspectBuild(run, [lifecycle], expected), false);
});

test("bad lifecycle conclusions and duplicate current probes fail closed", () => {
  for (const conclusion of [
    "failure",
    "cancelled",
    "skipped",
    "neutral",
    "timed_out",
  ]) {
    assert.throws(
      () => inspectBuild(run, [job, { ...lifecycle, conclusion }], expected),
      /lifecycle.*did not succeed/i,
    );
    assert.throws(
      () =>
        inspectBuild(
          run,
          [
            { ...job, status: "in_progress" },
            { ...lifecycle, conclusion },
          ],
          expected,
        ),
      /lifecycle.*did not succeed/i,
    );
  }
  assert.throws(
    () => inspectBuild(run, [job, lifecycle, lifecycle], expected),
    /Ambiguous.*lifecycle/i,
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
