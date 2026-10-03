import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CI_REPOSITORY = "goldeget/putduk-mining";
export const CI_ORIGIN = `https://github.com/${CI_REPOSITORY}.git`;
export const CI_BUDGET_MS = 20 * 60_000;
// Leave 90 seconds for cancellation, artifact cleanup and job finalization.
export const CI_CANCEL_AT_MS = CI_BUDGET_MS - 90_000;
export const CI_BUDGET_JOB = "CI completeness and 20-minute budget";
export const CI_REQUIRED_JOBS = Object.freeze([
  "Exact diff integrity",
  "Application gates",
  "Database security gates",
  "Browser foundation",
  "WebServer lifecycle probe",
  "E2E production build artifact",
  "Worker runtime gates",
  "Korean typography public gates",
  "Korean typography protected gates",
  ...Array.from(
    { length: 8 },
    (_, index) => `Authenticated product gates (${index + 1}/8)`,
  ),
]);

function timestamp(value, name) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid CI ${name}`);
  }
  return parsed;
}

export function assertCiRunIdentity(run, { runId, attempt, headSha }) {
  if (
    run.repository?.full_name !== CI_REPOSITORY ||
    run.head_repository?.full_name !== CI_REPOSITORY ||
    String(run.id) !== String(runId) ||
    run.run_attempt !== attempt ||
    run.head_sha !== headSha ||
    run.path !== ".github/workflows/ci.yml" ||
    !["push", "pull_request"].includes(run.event)
  ) {
    throw new Error("BLOCKED_TARGET_SCOPE: CI run identity mismatch");
  }
}

export function evaluateCiJobs(run, jobs, nowMs) {
  // Initial runs include queue time. Full reruns get their own attempt clock.
  const startMs = timestamp(
    run.run_attempt === 1 ? run.created_at : run.run_started_at,
    "attempt start",
  );
  if (!Number.isFinite(nowMs) || nowMs < startMs) {
    throw new Error("Invalid CI observation time");
  }
  const elapsedMs = nowMs - startMs;
  const expected = new Set([...CI_REQUIRED_JOBS, CI_BUDGET_JOB]);
  const seen = new Set();
  const problems = [];
  const pending = [];
  for (const job of jobs) {
    if (!expected.has(job.name) || seen.has(job.name)) {
      problems.push(`Unexpected or duplicate job: ${job.name}`);
      if (job.status !== "completed") pending.push(job.name);
      continue;
    }
    seen.add(job.name);
    if (job.name === CI_BUDGET_JOB) continue;
    if (job.status !== "completed") {
      pending.push(job.name);
      continue;
    }
    const permittedSkip =
      run.event === "push" &&
      job.name === "Exact diff integrity" &&
      job.conclusion === "skipped";
    if (job.conclusion !== "success" && !permittedSkip) {
      problems.push(`${job.name}: ${job.conclusion ?? "missing conclusion"}`);
    }
    if (!permittedSkip) {
      const endMs = timestamp(job.completed_at, "job completion");
      if (endMs < startMs || endMs > nowMs || endMs - startMs > CI_BUDGET_MS) {
        problems.push(`${job.name}: invalid or over-budget completion`);
      }
    }
  }
  for (const name of expected) {
    if (!seen.has(name)) pending.push(name);
  }
  if (elapsedMs >= CI_BUDGET_MS) problems.push("CI exceeded 20 minutes");
  return {
    elapsedMs,
    pending,
    problems,
    complete: pending.length === 0,
    accepted: problems.length === 0 && pending.length === 0,
    cancel: pending.length > 0 && elapsedMs >= CI_CANCEL_AT_MS,
  };
}

export function createCiApi({ token, fetchImpl = fetch }) {
  if (!token) throw new Error("CI token is required");
  return async function request(path, method = "GET") {
    // Callers cannot select a repository, host, query target or redirect.
    const read =
      /^\/actions\/runs\/[0-9]+(?:\/attempts\/[0-9]+(?:\/jobs\?per_page=100)?)?$/.test(
        path,
      );
    const cancel = /^\/actions\/runs\/[0-9]+\/(?:cancel|force-cancel)$/.test(
      path,
    );
    if (!((method === "GET" && read) || (method === "POST" && cancel))) {
      throw new Error("BLOCKED_TARGET_SCOPE: CI API path rejected");
    }
    const response = await fetchImpl(
      `https://api.github.com/repos/${CI_REPOSITORY}${path}`,
      {
        method,
        redirect: "error",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`CI API HTTP ${response.status}`);
    return method === "GET" ? response.json() : null;
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function monitorCi({
  identity,
  request,
  now = Date.now,
  wait = sleep,
  report = console.log,
}) {
  let lastReport = "";
  for (;;) {
    const run = await request(`/actions/runs/${identity.runId}`);
    assertCiRunIdentity(run, identity);
    const result = await request(
      `/actions/runs/${identity.runId}/attempts/${identity.attempt}/jobs?per_page=100`,
    );
    if (
      !Array.isArray(result.jobs) ||
      result.total_count !== result.jobs.length
    ) {
      throw new Error("CI job listing is incomplete");
    }
    const evaluation = evaluateCiJobs(run, result.jobs, now());
    const line = `${Math.floor(evaluation.elapsedMs / 1_000)}s; pending=${evaluation.pending.length}; failures=${evaluation.problems.length}`;
    if (line !== lastReport) {
      report(`[ci-budget] ${line}`);
      lastReport = line;
    }
    if (evaluation.cancel) {
      // Verify the exact target again before each mutation. No cancel URL from
      // the response is used; the endpoint is constructed from the locked repo.
      assertCiRunIdentity(
        await request(`/actions/runs/${identity.runId}`),
        identity,
      );
      report(
        "[ci-budget] incomplete at 18m30s: cancelling; this is not a pass",
      );
      await request(`/actions/runs/${identity.runId}/cancel`, "POST");
      await wait(20_000);
      const afterCancel = await request(`/actions/runs/${identity.runId}`);
      assertCiRunIdentity(afterCancel, identity);
      const afterJobs = await request(
        `/actions/runs/${identity.runId}/attempts/${identity.attempt}/jobs?per_page=100`,
      );
      if (
        afterCancel.status !== "completed" &&
        (!Array.isArray(afterJobs.jobs) ||
          afterJobs.total_count !== afterJobs.jobs.length ||
          afterJobs.jobs.some(
            (job) => job.name !== CI_BUDGET_JOB && job.status !== "completed",
          ))
      ) {
        report("[ci-budget] cancellation still pending: force cancelling");
        await request(`/actions/runs/${identity.runId}/force-cancel`, "POST");
      }
      throw new Error("CI did not complete within the workflow budget");
    }
    if (evaluation.complete) {
      if (!evaluation.accepted) throw new Error(evaluation.problems.join("; "));
      report(
        `[ci-budget] PASS: all 17 quality jobs complete in ${evaluation.elapsedMs}ms`,
      );
      return evaluation;
    }
    // A failed test still receives its normal evidence upload. We keep watching
    // other jobs until completion or the deadline; a partial run cannot pass.
    await wait(15_000);
  }
}

async function main() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== CI_REPOSITORY ||
    execFileSync("git", ["remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim() !== CI_ORIGIN
  ) {
    throw new Error("BLOCKED_TARGET_SCOPE: CI checkout mismatch");
  }
  const runId = process.env.GITHUB_RUN_ID;
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const headSha = process.env.CI_HEAD_SHA;
  if (
    !/^[0-9]+$/.test(runId ?? "") ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    !/^[0-9a-f]{40}$/.test(headSha ?? "")
  ) {
    throw new Error("Invalid CI run metadata");
  }
  const evaluation = await monitorCi({
    identity: { runId, attempt, headSha },
    request: createCiApi({ token: process.env.GH_TOKEN }),
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `All 17 quality jobs completed. Whole attempt: ${evaluation.elapsedMs}ms / ${CI_BUDGET_MS}ms. Queue, build dependencies and evidence uploads are included.\n`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`[ci-budget] FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}
