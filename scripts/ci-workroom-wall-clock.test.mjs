import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CI_REQUIRED_JOBS,
  CI_BUDGET_JOB,
  CI_CANCEL_AT_MS,
  evaluateCiJobs,
  assertCiRunIdentity,
} from "./ci-workroom-wall-clock.mjs";
const start = Date.UTC(2026, 10, 4);
const run = {
  id: 123,
  run_attempt: 1,
  head_sha: "a".repeat(40),
  repository: { full_name: "goldeget/putduk-mining" },
  head_repository: { full_name: "goldeget/putduk-mining" },
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  created_at: new Date(start).toISOString(),
};
const jobs = () =>
  [...CI_REQUIRED_JOBS, CI_BUDGET_JOB].map((name) => ({
    name,
    status: "completed",
    conclusion: "success",
    completed_at: new Date(start + 1000).toISOString(),
  }));
test("WORKROOM controller requires every named gate and exact current attempt identity", () => {
  assert.doesNotThrow(() =>
    assertCiRunIdentity(run, {
      runId: "123",
      attempt: 1,
      headSha: run.head_sha,
    }),
  );
  assert.throws(() =>
    assertCiRunIdentity(
      { ...run, run_attempt: 2 },
      { runId: "123", attempt: 1, headSha: run.head_sha },
    ),
  );
  assert.equal(evaluateCiJobs(run, jobs(), start + 2000).accepted, true);
  assert.equal(
    evaluateCiJobs(run, jobs().slice(1), start + 2000).accepted,
    false,
  );
  assert.equal(
    evaluateCiJobs(run, [...jobs(), jobs()[0]], start + 2000).accepted,
    false,
  );
  assert.equal(
    evaluateCiJobs(
      run,
      jobs().map((job) =>
        job.name === CI_REQUIRED_JOBS[1]
          ? { ...job, conclusion: "skipped" }
          : job,
      ),
      start + 2000,
    ).accepted,
    false,
  );
});
test("queue time and still-running quality gates trigger bounded cancellation", () => {
  const pending = jobs().map((job) =>
    job.name === CI_REQUIRED_JOBS[1]
      ? { ...job, status: "in_progress", conclusion: null }
      : job,
  );
  assert.equal(
    evaluateCiJobs(run, pending, start + CI_CANCEL_AT_MS).cancel,
    true,
  );
  assert.equal(
    evaluateCiJobs(run, pending, start + CI_CANCEL_AT_MS - 1).cancel,
    false,
  );
});
