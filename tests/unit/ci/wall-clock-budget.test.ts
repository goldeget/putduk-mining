import { describe, expect, it } from "vitest";

import {
  CI_BUDGET_JOB,
  CI_BUDGET_MS,
  CI_CANCEL_AT_MS,
  CI_REQUIRED_JOBS,
  assertCiRunIdentity,
  createCiApi,
  evaluateCiJobs,
  monitorCi,
} from "../../../scripts/ci-wall-clock.mjs";

const start = Date.parse("2026-10-03T04:00:00Z");
const identity = { runId: "1234", attempt: 1, headSha: "a".repeat(40) };
const run = {
  id: 1234,
  run_attempt: 1,
  head_sha: identity.headSha,
  path: ".github/workflows/ci.yml",
  event: "pull_request",
  created_at: new Date(start).toISOString(),
  run_started_at: new Date(start + 120_000).toISOString(),
  repository: { full_name: "goldeget/putduk-mining" },
  head_repository: { full_name: "goldeget/putduk-mining" },
  status: "in_progress",
};
const completed = () =>
  [...CI_REQUIRED_JOBS, CI_BUDGET_JOB].map((name) => ({
    name,
    status: name === CI_BUDGET_JOB ? "in_progress" : "completed",
    conclusion: name === CI_BUDGET_JOB ? null : "success",
    completed_at: new Date(start + 900_000).toISOString(),
  }));

describe("whole-workflow CI acceptance", () => {
  it("counts queue and shared-build dependency time, not the longest job", () => {
    const result = evaluateCiJobs(run, completed(), start + 960_000);
    expect(result.accepted).toBe(true);
    expect(result.elapsedMs).toBe(960_000);
    expect(CI_REQUIRED_JOBS).toHaveLength(17);
  });

  it("rejects a green attempt that finishes over 20 minutes", () => {
    const result = evaluateCiJobs(run, completed(), start + CI_BUDGET_MS + 1);
    expect(result.accepted).toBe(false);
    expect(result.problems).toContain("CI exceeded 20 minutes");
  });

  it("rejects missing, duplicated, unexpected and failed quality jobs", () => {
    const jobs = completed();
    expect(evaluateCiJobs(run, jobs.slice(1), start + 960_000).accepted).toBe(
      false,
    );
    expect(
      evaluateCiJobs(run, [...jobs, jobs[0]!], start + 960_000).accepted,
    ).toBe(false);
    const unexpected = evaluateCiJobs(
      run,
      [...jobs, { ...jobs[0]!, name: "extra", status: "in_progress" }],
      start + CI_CANCEL_AT_MS,
    );
    expect(unexpected.pending).toContain("extra");
    expect(unexpected.cancel).toBe(true);
    expect(
      evaluateCiJobs(
        run,
        [...jobs, { ...jobs[0]!, name: "extra" }],
        start + 960_000,
      ).accepted,
    ).toBe(false);
    expect(
      evaluateCiJobs(
        run,
        jobs.map((job) =>
          job.name === "Database security gates"
            ? { ...job, conclusion: "failure" }
            : job,
        ),
        start + 960_000,
      ).accepted,
    ).toBe(false);
  });

  it("permits only the PR-specific diff skip on a push", () => {
    const jobs = completed().map((job) =>
      job.name === "Exact diff integrity"
        ? { ...job, conclusion: "skipped" }
        : job,
    );
    expect(
      evaluateCiJobs({ ...run, event: "push" }, jobs, start + 960_000).accepted,
    ).toBe(true);
    expect(evaluateCiJobs(run, jobs, start + 960_000).accepted).toBe(false);
    const skipped = completed().map((job) =>
      job.name === "Application gates"
        ? { ...job, conclusion: "skipped" }
        : job,
    );
    expect(
      evaluateCiJobs({ ...run, event: "push" }, skipped, start + 960_000)
        .accepted,
    ).toBe(false);
  });

  it("rejects incomplete reruns instead of reusing earlier successful jobs", () => {
    const rerun = {
      ...run,
      run_attempt: 2,
      run_started_at: new Date(start + 3_600_000).toISOString(),
    };
    expect(
      evaluateCiJobs(rerun, completed().slice(0, 2), start + 3_660_000)
        .accepted,
    ).toBe(false);
    const jobs = completed().map((job) => ({
      ...job,
      completed_at: new Date(start + 3_650_000).toISOString(),
    }));
    expect(evaluateCiJobs(rerun, jobs, start + 3_660_000).accepted).toBe(true);
  });

  it("rejects another repository, candidate or run attempt", () => {
    expect(() => assertCiRunIdentity(run, identity)).not.toThrow();
    for (const wrong of [
      { ...run, repository: { full_name: "outside/scope" } },
      { ...run, head_repository: { full_name: "outside/scope" } },
      { ...run, head_sha: "b".repeat(40) },
      { ...run, id: 4321 },
      { ...run, run_attempt: 2 },
      { ...run, path: ".github/workflows/other.yml" },
    ])
      expect(() => assertCiRunIdentity(wrong, identity)).toThrow(
        /BLOCKED_TARGET_SCOPE/,
      );
  });

  it("reserves cancellation time before the absolute deadline", () => {
    const jobs = completed().map((job) =>
      job.name === "Authenticated product gates (8/8)"
        ? { ...job, status: "in_progress", conclusion: null }
        : job,
    );
    expect(evaluateCiJobs(run, jobs, start + CI_CANCEL_AT_MS - 1).cancel).toBe(
      false,
    );
    const result = evaluateCiJobs(run, jobs, start + CI_CANCEL_AT_MS);
    expect(result.cancel).toBe(true);
    expect(result.accepted).toBe(false);
  });

  it("waits for every shard and evidence job before passing", async () => {
    let polls = 0;
    let waited = 0;
    const result = await monitorCi({
      identity,
      now: () => start + 960_000,
      report: () => {},
      wait: async (ms: number) => {
        waited += ms;
      },
      request: async (path: string) => {
        if (!path.includes("/jobs?")) return run;
        polls += 1;
        const jobs = completed();
        if (polls === 1)
          jobs[1] = { ...jobs[1]!, status: "in_progress", conclusion: null };
        return { jobs, total_count: jobs.length };
      },
    });
    expect(result.accepted).toBe(true);
    expect(polls).toBe(2);
    expect(waited).toBe(15_000);
  });

  it("cancels only the exact run and force cancels an unresponsive cancellation", async () => {
    const requests: string[] = [];
    const jobs = completed()
      .slice(1)
      .map((job) =>
        job.name === "Application gates"
          ? { ...job, status: "in_progress" }
          : job,
      );
    await expect(
      monitorCi({
        identity,
        now: () => start + CI_CANCEL_AT_MS,
        report: () => {},
        wait: async () => {},
        request: async (path: string, method = "GET") => {
          requests.push(`${method} ${path}`);
          return path.includes("/jobs?")
            ? { jobs, total_count: jobs.length }
            : run;
        },
      }),
    ).rejects.toThrow(/did not complete/);
    expect(requests.filter((path) => path.startsWith("POST"))).toEqual([
      "POST /actions/runs/1234/cancel",
      "POST /actions/runs/1234/force-cancel",
    ]);
  });

  it("does not mutate after a target mismatch or truncated API listing", async () => {
    let mutations = 0;
    await expect(
      monitorCi({
        identity,
        report: () => {},
        request: async (_path: string, method = "GET") => {
          if (method !== "GET") mutations += 1;
          return { ...run, head_sha: "b".repeat(40) };
        },
      }),
    ).rejects.toThrow(/BLOCKED_TARGET_SCOPE/);
    expect(mutations).toBe(0);
    await expect(
      monitorCi({
        identity,
        report: () => {},
        request: async (path: string) =>
          path.includes("/jobs?") ? { jobs: [], total_count: 18 } : run,
      }),
    ).rejects.toThrow(/incomplete/);
  });

  it("constructs only fixed-repository API URLs and never follows redirects", async () => {
    const calls: Array<{ url: string; redirect: string }> = [];
    const request = createCiApi({
      token: "fixture-token",
      fetchImpl: async (url: string, options: { redirect: string }) => {
        calls.push({ url, redirect: options.redirect });
        return { ok: true, json: async () => run };
      },
    });
    await request("/actions/runs/1234");
    expect(calls).toEqual([
      {
        url: "https://api.github.com/repos/goldeget/putduk-mining/actions/runs/1234",
        redirect: "error",
      },
    ]);
    await expect(
      request("/repos/outside/scope/actions/runs/1234"),
    ).rejects.toThrow(/BLOCKED_TARGET_SCOPE/);
    await expect(request("/actions/runs/1234/../../secrets")).rejects.toThrow(
      /BLOCKED_TARGET_SCOPE/,
    );
    expect(calls).toHaveLength(1);
  });
});
