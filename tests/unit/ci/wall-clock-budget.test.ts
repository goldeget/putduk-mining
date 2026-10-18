import { describe, expect, it } from "vitest";

import {
  assertSameInventory,
  balanceInventory,
  parseAuthenticatedShardChoice,
  type AuthenticatedTestEvidence,
} from "../../../scripts/ci-authenticated-shards-201.mjs";

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
    expect(CI_REQUIRED_JOBS).toHaveLength(10);
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
      job.name === "Authenticated smoke gates"
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
          path.includes("/jobs?") ? { jobs: [], total_count: 11 } : run,
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

  it("recovers a transient read before the deadline without losing completeness", async () => {
    let reads = 0;
    const waits: number[] = [];
    const result = await monitorCi({
      identity,
      now: () => start + 960_000,
      report: () => {},
      wait: async (ms) => {
        waits.push(ms);
      },
      request: async (path) => {
        if (!path.includes("/jobs?")) {
          if (++reads === 1) throw new DOMException("fixture", "TimeoutError");
          return run;
        }
        return { jobs: completed(), total_count: completed().length };
      },
    });
    expect(result.accepted).toBe(true);
    expect(reads).toBe(2);
    expect(waits).toEqual([1_000]);
  });

  it("retains the verified clock through exhausted reads and cancels at the deadline", async () => {
    let clock = start + CI_CANCEL_AT_MS - 5_000;
    let cancelled = false;
    let failedReads = 0;
    const mutations: string[] = [];
    await expect(
      monitorCi({
        identity,
        now: () => clock,
        report: () => {},
        wait: async (ms) => {
          clock += ms;
        },
        request: async (path, method = "GET") => {
          if (method === "POST") {
            mutations.push(path);
            cancelled = true;
            return null;
          }
          if (path.includes("/jobs?")) {
            failedReads += 1;
            throw new DOMException("fixture", "TimeoutError");
          }
          return { ...run, status: cancelled ? "completed" : "in_progress" };
        },
      }),
    ).rejects.toThrow(/did not complete/);
    expect(failedReads).toBe(4);
    expect(mutations).toEqual(["/actions/runs/1234/cancel"]);
    expect(clock).toBe(start + CI_CANCEL_AT_MS + 20_000);
    expect(clock).toBeLessThan(start + CI_BUDGET_MS);
  });

  it("never cancels without an initial verified identity even after bounded timeouts", async () => {
    let reads = 0;
    let mutations = 0;
    await expect(
      monitorCi({
        identity,
        now: () => start + CI_CANCEL_AT_MS,
        report: () => {},
        wait: async () => {},
        request: async (_path, method = "GET") => {
          if (method !== "GET") mutations += 1;
          reads += 1;
          throw new DOMException("fixture", "TimeoutError");
        },
      }),
    ).rejects.toThrow(/temporarily unavailable/);
    expect(reads).toBe(3);
    expect(mutations).toBe(0);
  });

  it("requires fresh matching identity after a deadline job-read failure", async () => {
    let runReads = 0;
    let mutations = 0;
    await expect(
      monitorCi({
        identity,
        now: () => start + CI_CANCEL_AT_MS,
        report: () => {},
        wait: async () => {},
        request: async (path, method = "GET") => {
          if (method !== "GET") mutations += 1;
          if (path.includes("/jobs?"))
            throw new DOMException("fixture", "TimeoutError");
          return ++runReads === 1 ? run : { ...run, head_sha: "b".repeat(40) };
        },
      }),
    ).rejects.toThrow(/BLOCKED_TARGET_SCOPE/);
    expect(runReads).toBe(2);
    expect(mutations).toBe(0);
  });

  it("requires another fresh identity before force-cancel", async () => {
    let runReads = 0;
    const mutations: string[] = [];
    const jobs = completed().map((job) => ({ ...job, status: "in_progress" }));
    await expect(
      monitorCi({
        identity,
        now: () => start + CI_CANCEL_AT_MS,
        report: () => {},
        wait: async () => {},
        request: async (path, method = "GET") => {
          if (method === "POST") {
            mutations.push(path);
            return null;
          }
          if (path.includes("/jobs?"))
            return { jobs, total_count: jobs.length };
          return ++runReads === 4 ? { ...run, run_attempt: 2 } : run;
        },
      }),
    ).rejects.toThrow(/BLOCKED_TARGET_SCOPE/);
    expect(runReads).toBe(4);
    expect(mutations).toEqual(["/actions/runs/1234/cancel"]);
  });

  it("does not cancel when the fresh deadline identity stays unavailable", async () => {
    let runReads = 0;
    let mutations = 0;
    await expect(
      monitorCi({
        identity,
        now: () => start + CI_CANCEL_AT_MS,
        report: () => {},
        wait: async () => {},
        request: async (path, method = "GET") => {
          if (method !== "GET") mutations += 1;
          if (path.includes("/jobs?") || ++runReads > 1) {
            throw new DOMException("fixture", "TimeoutError");
          }
          return run;
        },
      }),
    ).rejects.toThrow(/temporarily unavailable/);
    expect(runReads).toBe(4);
    expect(mutations).toBe(0);
  });

  it("does not force-cancel a run that finishes during the fresh verification", async () => {
    let runReads = 0;
    const mutations: string[] = [];
    const jobs = completed().map((job) => ({ ...job, status: "in_progress" }));
    await expect(
      monitorCi({
        identity,
        now: () => start + CI_CANCEL_AT_MS,
        report: () => {},
        wait: async () => {},
        request: async (path, method = "GET") => {
          if (method === "POST") {
            mutations.push(path);
            return null;
          }
          if (path.includes("/jobs?"))
            return { jobs, total_count: jobs.length };
          return {
            ...run,
            status: ++runReads === 4 ? "completed" : "in_progress",
          };
        },
      }),
    ).rejects.toThrow(/did not complete/);
    expect(mutations).toEqual(["/actions/runs/1234/cancel"]);
  });

  it("rejects a changed attempt timestamp instead of resetting its deadline", async () => {
    let runReads = 0;
    let mutations = 0;
    await expect(
      monitorCi({
        identity,
        now: () => start + 960_000,
        report: () => {},
        wait: async () => {},
        request: async (path, method = "GET") => {
          if (method !== "GET") mutations += 1;
          if (path.includes("/jobs?")) return { jobs: [], total_count: 0 };
          return ++runReads === 1
            ? run
            : { ...run, created_at: new Date(start + 1).toISOString() };
        },
      }),
    ).rejects.toThrow(/attempt clock changed/);
    expect(mutations).toBe(0);
  });

  it("verifies shutdown when cancel acknowledgement is lost without replaying POST", async () => {
    let cancelled = false;
    const mutations: string[] = [];
    const jobs = completed().map((job) => ({ ...job, status: "in_progress" }));
    await expect(
      monitorCi({
        identity,
        now: () => start + CI_CANCEL_AT_MS,
        report: () => {},
        wait: async () => {},
        request: async (path, method = "GET") => {
          if (method === "POST") {
            mutations.push(path);
            cancelled = true;
            throw new DOMException("fixture", "TimeoutError");
          }
          if (path.includes("/jobs?"))
            return { jobs, total_count: jobs.length };
          return { ...run, status: cancelled ? "completed" : "in_progress" };
        },
      }),
    ).rejects.toThrow(/did not complete/);
    expect(mutations).toEqual(["/actions/runs/1234/cancel"]);
  });

  it("classifies only transient HTTP responses for retry, never permission failures", async () => {
    for (const status of [429, 500, 502, 503, 504, 401, 403, 404]) {
      const request = createCiApi({
        token: "fixture-token",
        fetchImpl: async () => ({
          ok: false,
          status,
          json: async () => null,
        }),
      });
      await expect(request("/actions/runs/1234")).rejects.toMatchObject({
        name: [401, 403, 404].includes(status)
          ? "Error"
          : "CiTransientApiError",
      });
    }
  });
});

describe("twelve isolated authenticated CI lanes", () => {
  const inventory: AuthenticatedTestEvidence[] = Array.from(
    { length: 48 },
    (_, index) => ({
      key: JSON.stringify(["chromium", `case-${index}`]),
      project: "chromium",
      file: `tests/e2e/authenticated/fixture-${Math.floor(index / 2)}.spec.ts`,
      expectedStatus: "passed",
      status: "expected",
      results: [{ status: "passed", duration: 1, retry: 0 }],
    }),
  );

  it("requires the PR smoke gate and leaves the twelve full lanes off the budget", () => {
    expect(CI_REQUIRED_JOBS).toEqual([
      "Exact diff integrity",
      "Application gates",
      "Database security gates",
      "Browser foundation",
      "WebServer lifecycle probe",
      "E2E production build artifact",
      "Worker runtime gates",
      "Korean typography public gates",
      "Korean typography protected gates",
      "Authenticated smoke gates",
    ]);
    const result = evaluateCiJobs(
      run,
      completed().filter((job) => job.name !== "Authenticated smoke gates"),
      start + 960_000,
    );
    expect(result.accepted).toBe(false);
    expect(result.pending).toContain("Authenticated smoke gates");
    expect(
      CI_REQUIRED_JOBS.some((name) =>
        name.includes("Authenticated product gates"),
      ),
    ).toBe(false);
  });

  it("selects the whole lane index including ten through twelve", () => {
    expect(parseAuthenticatedShardChoice("--verify-only")).toBeNull();
    for (let index = 1; index <= 12; index += 1) {
      expect(parseAuthenticatedShardChoice(`${index}/12`)).toBe(index - 1);
    }
  });

  it("rejects invalid, ambiguous and former wider-lane CLI choices", () => {
    for (const choice of [
      undefined,
      null,
      10,
      "",
      "0/12",
      "13/12",
      "01/12",
      "1/24",
      "12/24",
      "24/24",
      "1/18",
      "18/18",
      "19/18",
      "1/16",
      "16/16",
      "10/8",
      "1/8",
      "10/012",
      "10/12x",
      "10.0/12",
      "-1/12",
      "--verify-only ",
    ]) {
      expect(() => parseAuthenticatedShardChoice(choice)).toThrow(/Usage:/);
    }
  });

  it("keeps every test and project-file group in one of twelve disjoint lanes", () => {
    const shards = balanceInventory(inventory) as Array<{
      index: number;
      tests: AuthenticatedTestEvidence[];
      groups: Array<{ project: string; file: string }>;
    }>;
    expect(shards).toHaveLength(12);
    expect(shards.map((shard) => shard.index)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(shards.every((shard) => shard.tests.length > 0)).toBe(true);
    const union = shards.flatMap((shard) => shard.tests);
    assertSameInventory(inventory, union);
    expect(new Set(union.map((test) => test.key)).size).toBe(48);
    const groups = shards.flatMap((shard) =>
      shard.groups.map((group) => JSON.stringify([group.project, group.file])),
    );
    expect(groups).toHaveLength(24);
    expect(new Set(groups).size).toBe(24);
    for (const shard of shards) {
      for (const group of shard.groups) {
        expect(
          shard.tests.filter(
            (test) =>
              test.project === group.project && test.file === group.file,
          ),
        ).toHaveLength(2);
      }
    }
    expect(() => assertSameInventory(inventory, union.slice(1))).toThrow(
      /coverage mismatch/,
    );
    expect(() => assertSameInventory(inventory, [...union, union[0]!])).toThrow(
      /coverage mismatch/,
    );
  });

  it("rejects duplicate inventory, invalid lane totals and empty coverage", () => {
    expect(() => balanceInventory([...inventory, inventory[0]!])).toThrow(
      /coverage mismatch/,
    );
    for (const total of [0, 13, 24, 25, 1.5, Number.NaN]) {
      expect(() => balanceInventory(inventory, total)).toThrow(
        /Invalid authenticated shard plan/,
      );
    }
    expect(() => balanceInventory([])).toThrow(
      /Invalid authenticated shard plan/,
    );
  });

  it("anchors measured long specs on different lanes", () => {
    const anchors = [
      "principal-withdrawal-product.spec.ts",
      "home-catalog-materials.spec.ts",
      "home-catalog-materials-follow.spec.ts",
      "notifications-product.spec.ts",
      "mockup-reference-ai.spec.ts",
      "mockup-reference-coverage.spec.ts",
    ];
    const extraMockups = [
      "mockup-reference-menu.spec.ts",
      "mockup-reference-mining.spec.ts",
      "mockup-reference-products.spec.ts",
      "mockup-reference-public.spec.ts",
      "mockup-reference-wallet.spec.ts",
    ];
    const files = [
      ...anchors,
      ...extraMockups,
      "catalog-allocated-wallet-light.spec.ts",
      "withdrawal-p1-recovery.spec.ts",
    ];
    const placed: AuthenticatedTestEvidence[] = files.flatMap(
      (file, fileIndex) =>
        ["chromium", "mobile-chrome"].map((project, projectIndex) => ({
          key: JSON.stringify([project, `long-${fileIndex}-${projectIndex}`]),
          project,
          file: `tests/e2e/authenticated/${file}`,
          expectedStatus: "passed",
          status: "expected",
          results: [{ status: "passed", duration: 1, retry: 0 }],
        })),
    );
    const shards = balanceInventory(placed) as Array<{
      index: number;
      groups: Array<{ project: string; file: string }>;
      tests: AuthenticatedTestEvidence[];
    }>;
    assertSameInventory(
      placed,
      shards.flatMap((shard) => shard.tests),
    );
    const base = (file: string) => file.split("/").at(-1) ?? file;
    for (const shard of shards) {
      const anchored = shard.groups.filter((group) =>
        anchors.includes(base(group.file)),
      );
      expect(anchored).toHaveLength(1);
      const protectedAnchor = anchored.some((group) =>
        [
          "principal-withdrawal-product.spec.ts",
          "home-catalog-materials.spec.ts",
          "home-catalog-materials-follow.spec.ts",
          "notifications-product.spec.ts",
        ].includes(base(group.file)),
      );
      if (protectedAnchor) {
        expect(
          shard.groups.some((group) =>
            base(group.file).startsWith("mockup-reference-"),
          ),
        ).toBe(false);
      }
    }
    for (const file of anchors) {
      const lanes = shards.filter((shard) =>
        shard.groups.some((group) => base(group.file) === file),
      );
      expect(lanes).toHaveLength(2);
      expect(new Set(lanes.map((shard) => shard.index)).size).toBe(2);
    }
  });
});
