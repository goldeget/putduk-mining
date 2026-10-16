import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BACKEND197_UNIT_FILES,
  planBackend197Gates,
  assertBackend197NativeProof,
  assertBackend197HttpReport,
} from "../../scripts/ci-backend-197.mjs";
import type { Backend197SourceBoundary } from "../../scripts/backend-successor-197-source.mjs";
const boundary: Backend197SourceBoundary = {
  scope: "CANONICAL_CI",
  repository: "goldeget/putduk-mining",
  projectId: "putduk-mining-ci-r2-20261009",
  apiPort: 63421,
  dbPort: 63422,
  migrationSources: 197,
  runtimeSources: 33,
  evidenceSources: 1,
  manifestSha256: "a".repeat(64),
  previousManifestSha256: "b".repeat(64),
  migrationVersions: Array.from({ length: 197 }, (_, i) =>
    String(20260000000000 + i),
  ),
};
describe("successor197 consumer selection is not an execution result", () => {
  it("keeps explicit v3 fixtures, corrected worker v2 and AI recovery regression", () => {
    expect(BACKEND197_UNIT_FILES).toContain(
      "tests/unit/usdt-manual-195-native-fixture-v3.test.ts",
    );
    expect(BACKEND197_UNIT_FILES).toContain(
      "tests/unit/withdrawal-lifecycle-worker-v2.test.ts",
    );
    expect(BACKEND197_UNIT_FILES).toContain(
      "tests/unit/ai-persistence-recovery-regression.test.ts",
    );
    expect(new Set(BACKEND197_UNIT_FILES).size).toBe(
      BACKEND197_UNIT_FILES.length,
    );
  });
  it("keeps whole CI and UI unverified even with a valid plan", () =>
    expect(planBackend197Gates(boundary)).toMatchObject({
      state: "NOT_TESTED",
      wholeCi: "NOT_VERIFIED",
      release: "NOT_VERIFIED",
      uiIntegration: "PENDING",
      wholeWorkflow: "EXISTING17_JOBS_AND20_MINUTE_CONTROLLER_REQUIRED",
    }));
  it.each([
    { migrationSources: 195 },
    { runtimeSources: 34 },
    { scope: "LOCAL_QA" },
    { projectId: "other" },
    { apiPort: 59521 },
    { manifestSha256: "caller" },
  ])("rejects a foreign/stale boundary %j", (change) =>
    expect(() =>
      planBackend197Gates({
        ...boundary,
        ...change,
      } as Backend197SourceBoundary),
    ).toThrow("EXACT_BOUNDARY_REQUIRED"),
  );
  it("retains fail-on-flaky API flag and all four required gates", () => {
    const plan = planBackend197Gates(boundary) as {
      gates: {
        id: string;
        required: boolean;
        command?: string[];
        skipped: number;
        flaky: number;
        expectedFailures: number;
      }[];
    };
    expect(plan.gates.map((g) => g.id)).toEqual([
      "unit197",
      "nativeConcurrency197",
      "permission197",
      "http197",
    ]);
    expect(
      plan.gates.every(
        (g) =>
          g.required &&
          g.skipped === 0 &&
          g.flaky === 0 &&
          g.expectedFailures === 0,
      ),
    ).toBe(true);
    expect(plan.gates.at(-1)?.command).toContain("--fail-on-flaky-tests");
  });
  it("runner uses v3 instead of disguising the frozen195 runner", () => {
    const runner = readFileSync(
      new URL("../../scripts/usdt-manual-197-runner.mjs", import.meta.url),
      "utf8",
    );
    expect(runner).toContain("usdt-manual-195-native-fixture-v3.mjs");
    expect(runner).toContain("backend-successor-197-source.mjs");
    expect(runner).not.toContain('from "./usdt-manual-195-runner-source.mjs"');
    expect(runner).toContain("emptyAuthAndMoney: true");
    expect(runner).toContain("automaticRetry = false");
    expect(runner).toMatch(/\{\s*flag\s*:\s*"wx"\s*\}/);
    expect(runner).toMatch(/phase\.rawArtifactSha256\s*=\s*hash\(safeRaw\)/);
  });
});
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
const contract = JSON.parse(
  readFileSync(
    new URL(
      "../e2e/fixtures/usdt-manual-195-concurrency-contract.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function artifactFixture() {
  const origin = 1780000000000,
    run = "a".repeat(16),
    source = {
      repository: "goldeget/putduk-mining",
      scope: "CI",
      sourceSha: "a".repeat(40),
      worktreeClean: true,
      runId: "42",
      attempt: 1,
    };
  const tap = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => "ok " + (i + 1) + " - synthetic",
    ).join("\n") +
    "\n1.." +
    count +
    "\n";
  const files = {
    "krw.tap": tap(80),
    "principal.tap": tap(388),
    "concurrency.result.json": JSON.stringify({
      status: "PASS",
      assertions: contract.canonical.map((name: string) => ({
        name: name.replace("{run}", run),
        passed: true,
      })),
      fixture_origin: contract.fixture_origin,
      fixture_sha256: contract.fixture_sha256,
      cleanup_performed: false,
      committed_synthetic_fixtures: true,
    }),
  };
  const phases = [
    ["krw", 80],
    ["principal", 388],
    ["concurrency", 41],
  ].map(([kind, count], index) => {
    const id = String(kind),
      name = (id +
        (id === "concurrency" ? ".result.json" : ".tap")) as keyof typeof files;
    const proof =
      id === "concurrency"
        ? {
            assertions: 41,
            names: contract.canonical.map((n: string) =>
              n.replace("{run}", run),
            ),
            run,
            fixturePreludeSha256: contract.fixture_sha256,
            skipped: 0,
          }
        : {
            assertions: count,
            plan: "1.." + count,
            skipped: 0,
            tapSha256: hash(files[name]),
          };
    return {
      id,
      state: "PASSED",
      exitCode: 0,
      startedAt: origin + index * 1000 + 20,
      finishedAt: origin + index * 1000 + 800,
      rawArtifact: name,
      rawArtifactSha256: hash(files[name]),
      stdoutSha256: "c".repeat(64),
      stderrSha256: "d".repeat(64),
      originalSha256: "e".repeat(64),
      derivativeSha256: "f".repeat(64),
      artifact: id + (id === "concurrency" ? ".py" : ".sql"),
      changes: [],
      scopedChanges: [],
      proof,
      ...(id === "concurrency" ? { launcherSha256: "2".repeat(64) } : {}),
    };
  });
  const report = {
    kind: "USDT197_NATIVE_CONCURRENCY_EXECUTION",
    state: "PASSED",
    acceptance: "NATIVE_AND_CONCURRENCY_ONLY",
    actualTransfers: false,
    cleanupPerformed: false,
    scope: "CANONICAL_CI",
    source,
    sourceManifestSha256: boundary.manifestSha256,
    runnerManifestSha256: boundary.manifestSha256,
    runnerGuardSha256: "1".repeat(64),
    startedAt: origin,
    finishedAt: origin + 3000,
    runId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    release: "NOT_VERIFIED",
    committedSyntheticFixtures: true,
    executionProfile: null,
    target: {
      containerId: "a".repeat(64),
      containerName: "supabase_db_" + boundary.projectId,
      volumeName: "supabase_db_" + boundary.projectId,
      createdAt: new Date(origin - 10000).toISOString(),
      volumeCreatedAt: new Date(origin - 11000).toISOString(),
    },
    freshPreflight: {
      exact197: true,
      emptyAuthAndMoney: true,
      observedAt: origin + 1,
    },
    testToolPreparation: { pgtap: true, exitCode: 0 },
    phases,
  };
  const context = {
    scope: "CANONICAL_CI" as const,
    boundary,
    containerId: "a".repeat(64),
    source,
    startedAt: origin - 1,
    finishedAt: origin + 3001,
    guardSha256: "1".repeat(64),
    launcherSha256: "2".repeat(64),
    derivatives: Object.fromEntries(
      phases.map((p) => [
        p.id,
        {
          originalSha256: p.originalSha256,
          sha256: p.derivativeSha256,
          changes: p.changes,
          scopedChanges: [],
        },
      ]),
    ),
  };
  return { report, files, context };
}
describe("197 current native artifact proof rejects copied or partial results", () => {
  it("accepts a synthetic validator fixture without claiming DB/HTTP/wholeCI", () => {
    const f = artifactFixture();
    expect(assertBackend197NativeProof(f.report, f.files, f.context)).toEqual({
      candidate: 197,
      native: "VALIDATED",
      release: "NOT_VERIFIED",
      wholeCi: "NOT_VERIFIED",
    });
  });
  it.each([undefined, NaN, "1780000000000", 0, -1, Infinity])(
    "rejects non-epoch report clock %s",
    (value) => {
      const f = artifactFixture();
      Object.assign(f.report, { startedAt: value });
      expect(() =>
        assertBackend197NativeProof(f.report, f.files, f.context),
      ).toThrow("CURRENT_NATIVE_EXECUTION_REQUIRED");
    },
  );
  it.each([undefined, NaN, "1780000000000", 0, -1, Infinity])(
    "rejects non-epoch context clock %s",
    (value) => {
      const f = artifactFixture();
      Object.assign(f.context, { finishedAt: value });
      expect(() =>
        assertBackend197NativeProof(f.report, f.files, f.context),
      ).toThrow("EXECUTION_CONTEXT_REQUIRED");
    },
  );
  it("rejects failed native phase despite complete TAP", () => {
    const f = artifactFixture();
    f.report.phases[0]!.exitCode = 1;
    expect(() =>
      assertBackend197NativeProof(f.report, f.files, f.context),
    ).toThrow("PHASE_NOT_VERIFIED");
  });
  it("rejects reordered native phases", () => {
    const f = artifactFixture();
    f.report.phases.reverse();
    expect(() =>
      assertBackend197NativeProof(f.report, f.files, f.context),
    ).toThrow("PHASE_NOT_VERIFIED");
  });
  it("rejects stale source identity", () => {
    const f = artifactFixture();
    f.report.source = { ...f.report.source, sourceSha: "b".repeat(40) };
    expect(() =>
      assertBackend197NativeProof(f.report, f.files, f.context),
    ).toThrow("CURRENT_NATIVE_EXECUTION_REQUIRED");
  });
  it("rejects forged empty preflight", () => {
    const f = artifactFixture();
    f.report.freshPreflight.emptyAuthAndMoney = false;
    expect(() =>
      assertBackend197NativeProof(f.report, f.files, f.context),
    ).toThrow("FRESH_PREFLIGHT_REQUIRED");
  });
  it("rejects missing raw artifact", () => {
    const f = artifactFixture();
    Reflect.deleteProperty(f.files, "krw.tap");
    expect(() =>
      assertBackend197NativeProof(f.report, f.files, f.context),
    ).toThrow("EXACT_RAW_ROSTER_REQUIRED");
  });
  it("rejects altered raw bytes without silently accepting old proof", () => {
    const f = artifactFixture();
    f.files["krw.tap"] += "not ok 81 - altered\n";
    expect(() =>
      assertBackend197NativeProof(f.report, f.files, f.context),
    ).toThrow("PHASE_NOT_VERIFIED");
  });
  it("rejects a foreign volume or container", () => {
    const f = artifactFixture();
    f.report.target.volumeName = "other";
    expect(() =>
      assertBackend197NativeProof(f.report, f.files, f.context),
    ).toThrow("FRESH_OWNED_TARGET_REQUIRED");
  });
  it("rejects source-only equivalence in place of actual terminal proof", () => {
    const f = artifactFixture();
    f.report.phases[0]!.proof.assertions = 79;
    expect(() =>
      assertBackend197NativeProof(f.report, f.files, f.context),
    ).toThrow("PROOF_MISMATCH");
  });
});
function httpFixture() {
  const began = 1780000000000,
    source = {
      repository: "goldeget/putduk-mining",
      scope: "CI",
      sourceSha: "a".repeat(40),
      worktreeClean: true,
      runId: "42",
      attempt: 1,
    };
  const intent = {
    kind: "BACKEND197_HTTP_CURRENT_INTENT",
    source,
    manifestSha256: boundary.manifestSha256,
    startedAt: began,
    expectedTests: 1,
    command: [
      "playwright",
      "test",
      "--config",
      "playwright.backend-http-197.config.ts",
      "--project",
      "backend-api",
      "--fail-on-flaky-tests",
    ],
  };
  const report = {
    config: {
      configFile: resolve(
        process.cwd(),
        "playwright.backend-http-197.config.ts",
      ),
      rootDir: resolve(process.cwd(), "tests/e2e/authenticated"),
      projects: [{ name: "backend-api" }],
    },
    errors: [],
    stats: {
      expected: 1,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
      duration: 1000,
      startTime: new Date(began + 1).toISOString(),
    },
    suites: [
      {
        specs: [
          {
            file: "tests/e2e/authenticated/usdt-manual-full-payout-197.spec.ts",
            title:
              "197 real Auth/step-up → strict manual USDT receipt → ledger and exact replay",
            ok: true,
            tests: [
              {
                projectName: "backend-api",
                expectedStatus: "passed",
                status: "expected",
                results: [
                  {
                    status: "passed",
                    retry: 0,
                    errors: [],
                    startTime: new Date(began + 2).toISOString(),
                    duration: 900,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  return { report, intent, source, now: began + 2000 };
}
describe("successor197 API report requires current actual execution", () => {
  it("accepts a validator fixture without claiming API was run in this unit", () => {
    const f = httpFixture();
    expect(
      assertBackend197HttpReport(f.report, f.intent, f.source, boundary, f.now),
    ).toMatchObject({
      tests: 1,
      wholeCi: "NOT_VERIFIED",
      uiIntegration: "PENDING",
    });
  });
  it.each(["skipped", "flaky", "unexpected"] as const)(
    "rejects %s report status",
    (key) => {
      const f = httpFixture();
      f.report.stats[key] = 1;
      expect(() =>
        assertBackend197HttpReport(
          f.report,
          f.intent,
          f.source,
          boundary,
          f.now,
        ),
      ).toThrow("HTTP_EXACT_REPORT_REQUIRED");
    },
  );
  it("rejects --list style results with no execution", () => {
    const f = httpFixture();
    f.report.suites[0]!.specs[0]!.tests[0]!.results = [];
    expect(() =>
      assertBackend197HttpReport(f.report, f.intent, f.source, boundary, f.now),
    ).toThrow("HTTP_NATIVE_AUTH_API_NOT_VERIFIED");
  });
  it("rejects an expected failure instead of treating it as passed", () => {
    const f = httpFixture();
    f.report.suites[0]!.specs[0]!.tests[0]!.expectedStatus = "failed";
    expect(() =>
      assertBackend197HttpReport(f.report, f.intent, f.source, boundary, f.now),
    ).toThrow("HTTP_NATIVE_AUTH_API_NOT_VERIFIED");
  });
  it("rejects a retry even if final result passed", () => {
    const f = httpFixture();
    f.report.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1;
    expect(() =>
      assertBackend197HttpReport(f.report, f.intent, f.source, boundary, f.now),
    ).toThrow("HTTP_NATIVE_AUTH_API_NOT_VERIFIED");
  });
  it("rejects wrong source/run metadata", () => {
    const f = httpFixture();
    f.intent.source = { ...f.intent.source, runId: "older" };
    expect(() =>
      assertBackend197HttpReport(f.report, f.intent, f.source, boundary, f.now),
    ).toThrow("CURRENT_HTTP_IDENTITY_REQUIRED");
  });
  it("rejects prior-attempt/stale clock", () => {
    const f = httpFixture();
    expect(() =>
      assertBackend197HttpReport(
        f.report,
        f.intent,
        f.source,
        boundary,
        f.now + 21 * 60000,
      ),
    ).toThrow("CURRENT_HTTP_IDENTITY_REQUIRED");
  });
});
