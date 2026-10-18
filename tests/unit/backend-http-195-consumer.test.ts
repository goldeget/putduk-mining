import { describe, expect, it } from "vitest";
import {
  assertBackend195ExecutionReport,
  assertBackend195HttpCoverage,
  planBackend195Gates,
} from "../../scripts/ci-backend-195.mjs";

const versions = Array.from({ length: 195 }, (_, index) =>
  String(20260101000000 + index),
);
const boundary = {
  scope: "CANONICAL_CI",
  repository: "goldeget/putduk-mining",
  projectId: "putduk-mining-ci-r2-20261009",
  apiPort: 63421,
  dbPort: 63422,
  migrationSources: 195,
  runtimeSources: 33,
  baselineRuntimeSources: 30,
  evidenceSources: 20,
  migrationVersions: versions,
  manifestSha256: "a".repeat(64),
  executionProfileSha256: null,
  previousManifestSha256: "b".repeat(64),
  baselineManifestSha256: "c".repeat(64),
} as Parameters<typeof planBackend195Gates>[0];
const source = {
  repository: "goldeget/putduk-mining",
  scope: "CI",
  worktreeClean: true,
  sourceSha: "d".repeat(40),
  candidateSha: "d".repeat(40),
  runId: "123456",
  attempt: 1,
  event: "push",
};
function report() {
  return {
    kind: "BACKEND_195_EXECUTION",
    state: "EXECUTED",
    listOnly: false,
    source,
    manifestSha256: boundary.manifestSha256,
    migrationVersions: versions,
    startedAt: 100,
    finishedAt: 200,
    gates: planBackend195Gates(boundary).gates.map(({ id }) => ({
      id,
      status: "passed",
      exitCode: 0,
      executed: true,
      skipped: 0,
      flaky: 0,
      expectedFailures: 0,
      evidenceSha256: "e".repeat(64),
      startedAt: 110,
      finishedAt: 190,
    })),
  };
}
const row = {
  project: "backend-api",
  file: "tests/e2e/authenticated/usdt-manual-full-payout-195.spec.ts",
  key: "case-one",
  expectedStatus: "passed",
  status: "expected",
  results: [{ status: "passed", retry: 0 }],
};

describe("candidate195 CI contract, authored only while execution is held", () => {
  it("labels source planning NOT_TESTED and retains full release gates", () => {
    const plan = planBackend195Gates(boundary);
    expect(plan.state).toBe("NOT_TESTED");
    expect(plan.purpose).toBe("BACKEND_CANDIDATE_ONLY");
    expect(plan.releaseEvidence).toBe("NOT_REPLACED");
    expect(plan.gates.every(({ required }) => required)).toBe(true);
    expect(plan.integrationPending).toContain(
      "Protected USDT admin screen is UI_INTEGRATION_PENDING",
    );
  });
  it("keeps native, concurrency, ACL and actual HTTP gates required", () => {
    expect(planBackend195Gates(boundary).gates.map(({ id }) => id)).toEqual([
      "type",
      "lint",
      "unit195",
      "native195",
      "acl195",
      "externalSendConcurrency195",
      "http195",
    ]);
  });
  for (const [key, value] of [
    ["scope", "LOCAL_QA"],
    ["migrationSources", 193],
    ["runtimeSources", 30],
    ["projectId", "remote-project"],
    ["apiPort", 65421],
    ["dbPort", 5432],
    ["manifestSha256", ""],
  ] as const) {
    it("rejects a different reviewed boundary: " + key, () => {
      expect(() => planBackend195Gates({ ...boundary, [key]: value })).toThrow(
        "BACKEND_195_CI_BOUNDARY_REQUIRED",
      );
    });
  }
  it("rejects duplicate or missing migration identifiers despite claimed195", () => {
    expect(() =>
      planBackend195Gates({
        ...boundary,
        migrationVersions: [...versions.slice(1), versions[1]!],
      }),
    ).toThrow("BACKEND_195_CI_BOUNDARY_REQUIRED");
    expect(() =>
      planBackend195Gates({
        ...boundary,
        migrationVersions: versions.slice(1),
      }),
    ).toThrow("BACKEND_195_CI_BOUNDARY_REQUIRED");
  });
  it("validates supplied synthetic report shape without attesting execution or release", () => {
    expect(assertBackend195ExecutionReport(report(), boundary, source)).toEqual(
      {
        candidate: "195",
        reportContract: "VALIDATED",
        release: "NOT_VERIFIED",
      },
    );
  });
  for (const field of [
    "state",
    "listOnly",
    "manifestSha256",
    "source",
    "migrationVersions",
  ]) {
    it("rejects stale/list-only evidence: " + field, () => {
      const bad = { ...report(), [field]: null };
      expect(() =>
        assertBackend195ExecutionReport(bad, boundary, source),
      ).toThrow("BACKEND_195_CURRENT_EXECUTION_REQUIRED");
    });
  }
  it("rejects missing, duplicate or unrelated required gates", () => {
    const bad = report();
    bad.gates.pop();
    expect(() =>
      assertBackend195ExecutionReport(bad, boundary, source),
    ).toThrow();
    const duplicate = report();
    duplicate.gates[0] = { ...duplicate.gates[1]! };
    expect(() =>
      assertBackend195ExecutionReport(duplicate, boundary, source),
    ).toThrow();
    const unrelated = report();
    unrelated.gates[0]!.id = "some-other-gate";
    expect(() =>
      assertBackend195ExecutionReport(unrelated, boundary, source),
    ).toThrow();
  });
  for (const [field, value] of [
    ["status", "skipped"],
    ["exitCode", 1],
    ["executed", false],
    ["skipped", 1],
    ["flaky", 1],
    ["expectedFailures", 1],
    ["evidenceSha256", ""],
    ["startedAt", 90],
    ["finishedAt", 201],
  ] as const) {
    it("rejects incomplete gate evidence: " + field, () => {
      const bad = report();
      bad.gates[0] = { ...bad.gates[0]!, [field]: value };
      expect(() =>
        assertBackend195ExecutionReport(bad, boundary, source),
      ).toThrow("BACKEND_195_GATE_NOT_VERIFIED");
    });
  }
  it("accepts exact synthetic HTTP inventory without skipped or expected-failed cases", () => {
    expect(assertBackend195HttpCoverage([row], [row])).toEqual({
      tests: 1,
      skipped: 0,
      flaky: 0,
    });
  });
  it("rejects empty, missing, duplicate and unrelated HTTP inventory", () => {
    for (const actual of [[], [row, row], [{ ...row, key: "other" }]]) {
      expect(() => assertBackend195HttpCoverage([row], actual)).toThrow(
        "BACKEND_195_HTTP_INVENTORY_MISMATCH",
      );
    }
    expect(() => assertBackend195HttpCoverage([], [])).toThrow(
      "BACKEND_195_HTTP_INVENTORY_MISMATCH",
    );
  });
  for (const patch of [
    { expectedStatus: "failed" },
    { status: "skipped" },
    { results: [{ status: "skipped", retry: 0 }] },
    { results: [{ status: "passed", retry: 1 }] },
    {
      results: [
        { status: "failed", retry: 0 },
        { status: "passed", retry: 1 },
      ],
    },
  ]) {
    it(
      "rejects skipped, failed or retried HTTP cases " + JSON.stringify(patch),
      () => {
        expect(() =>
          assertBackend195HttpCoverage([row], [{ ...row, ...patch }]),
        ).toThrow("BACKEND_195_HTTP_TEST_NOT_PASSED");
      },
    );
  }
});
