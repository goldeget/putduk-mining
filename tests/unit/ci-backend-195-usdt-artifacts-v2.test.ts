import { predecessor195TestMigrationVersions } from "../helpers/backend-predecessor-195.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import {
  assertUsdt195CiArtifacts,
  USDT195_CI_PINS,
} from "../../scripts/ci-backend-195-usdt-artifacts.mjs";
import { planBackend195UsdtCi } from "../../scripts/ci-backend-195-usdt.mjs";
import {
  buildKrw195Fixture,
  buildPrincipal195Fixture,
  buildConcurrency195Fixture,
  USDT_195_FROZEN_SOURCES,
} from "../../scripts/usdt-manual-195-native-fixture-v2.mjs";
const hash = (v: Buffer | string) =>
  createHash("sha256").update(v).digest("hex");
const root = resolve(import.meta.dirname, "../..");
const contract = JSON.parse(
  readFileSync(
    resolve(
      root,
      "tests/e2e/fixtures/usdt-manual-195-concurrency-contract.json",
    ),
    "utf8",
  ),
);
const source = {
  repository: "goldeget/putduk-mining",
  sourceSha: "d".repeat(40),
  parents: [],
  worktreeClean: true,
  scope: "CI",
  candidateSha: "d".repeat(40),
  runId: "123456",
  attempt: 1,
  event: "push",
};
const boundary = {
  scope: "CANONICAL_CI",
  repository: source.repository,
  projectId: "putduk-mining-ci-r2-20261009",
  apiPort: 63421,
  dbPort: 63422,
  migrationSources: 195,
  runtimeSources: 33,
  baselineRuntimeSources: 30,
  evidenceSources: 130,
  migrationVersions: predecessor195TestMigrationVersions(root),
  manifestSha256: USDT195_CI_PINS.candidate,
  executionProfileSha256: null,
  previousManifestSha256: "a".repeat(64),
  baselineManifestSha256: "b".repeat(64),
} as Parameters<typeof planBackend195UsdtCi>[0];
function synthetic() {
  const expectedDerivatives: Record<
    string,
    { originalSha256: string; sha256: string; changes: unknown[] }
  > = {};
  const files: Record<string, Buffer> = {};
  const run = "0123456789abcdef",
    start = Date.UTC(2026, 9, 12),
    runnerRun = "12345678-1234-4234-9234-123456789abc";
  const phases = [
    ["krw", buildKrw195Fixture],
    ["principal", buildPrincipal195Fixture],
    ["concurrency", buildConcurrency195Fixture],
  ].map(([k, fn], i) => {
    const kind = k as keyof typeof USDT_195_FROZEN_SOURCES;
    const build = fn as typeof buildKrw195Fixture;
    const derivative = build(
      readFileSync(resolve(root, USDT_195_FROZEN_SOURCES[kind].path)),
      { fullPayoutConfirmed: true },
    );
    const changes = derivative.changes.map((c) => ({
      name: c.name,
      beforeSha256: c.beforeSha256,
      afterSha256: c.afterSha256,
      matches: c.matches,
    }));
    expectedDerivatives[kind] = {
      originalSha256: USDT_195_FROZEN_SOURCES[kind].sha256,
      sha256: derivative.sha256,
      changes,
    };
    const artifact = kind + (kind === "concurrency" ? ".py" : ".sql");
    files[artifact] = Buffer.from(derivative.sql);
    return {
      id: kind,
      state: "PASSED",
      startedAt: start + 100 + i * 100,
      finishedAt: start + 180 + i * 100,
      exitCode: 0,
      originalSha256: USDT_195_FROZEN_SOURCES[kind].sha256,
      derivativeSha256: derivative.sha256,
      artifact,
      changes,
      stdoutSha256: "a".repeat(64),
      stderrSha256: "b".repeat(64),
      proof:
        kind === "concurrency"
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
              assertions: kind === "krw" ? 80 : 388,
              plan: kind === "krw" ? "1..80" : "1..388",
              skipped: 0,
              tapSha256: "c".repeat(64),
            },
      ...(kind === "concurrency" ? { launcherSha256: "e".repeat(64) } : {}),
    };
  });
  const report = {
    version: 1,
    kind: "USDT195_NATIVE_CONCURRENCY_EXECUTION",
    state: "PASSED",
    release: "NOT_VERIFIED",
    source,
    sourceManifestSha256: USDT195_CI_PINS.candidate,
    runnerManifestSha256: USDT195_CI_PINS.runner,
    scope: "CANONICAL_CI",
    runId: runnerRun,
    startedAt: start,
    phases,
    cleanupPerformed: false,
    actualTransfers: false,
    httpAuth: "NOT_TESTED",
    wholeCi: "NOT_INTEGRATED",
    runnerGuardSha256: USDT195_CI_PINS.guard,
    target: {
      containerId: "f".repeat(64),
      containerName: "supabase_db_" + boundary.projectId,
      volumeName: "supabase_db_" + boundary.projectId,
      createdAt: new Date(start - 1000).toISOString(),
      volumeCreatedAt: new Date(start - 1000).toISOString(),
    },
    hostPythonVersion: [3, 11, 0],
    freshPreflight: {
      exact195: true,
      emptyAuthAndMoney: true,
      observedAt: start + 50,
    },
    testToolPreparation: {
      pgtap: true,
      exitCode: 0,
      stdoutSha256: "c".repeat(64),
      stderrSha256: "e".repeat(64),
    },
    acceptance: "NATIVE_AND_CONCURRENCY_ONLY",
    committedSyntheticFixtures: true,
    finishedAt: start + 500,
  };
  const context = {
    scope: "CANONICAL_CI" as const,
    source,
    boundary,
    expectedContainerId: "f".repeat(64),
    startedAt: start - 1,
    finishedAt: start + 501,
    childExitCode: 0,
    childStdoutSha256: "a".repeat(64),
    childStderrSha256: "b".repeat(64),
    expectedDerivatives,
    launcherSha256: "e".repeat(64),
    concurrencyContract: contract,
  };
  function seal() {
    files["execution.json"] = Buffer.from(JSON.stringify(report));
    return {
      manifest: Buffer.from(
        JSON.stringify({
          version: 1,
          state: "PASSED",
          runId: runnerRun,
          files: [
            "execution.json",
            "krw.sql",
            "principal.sql",
            "concurrency.py",
          ].map((path) => ({ path, sha256: hash(files[path]!) })),
        }),
      ),
      files,
    };
  }
  return { report, context, seal };
}
describe("single-run195 CI bridge contract; synthetic descriptions, no execution attestation", () => {
  it("keeps all original gate IDs but owns native and concurrency exactly once", () => {
    const plan = planBackend195UsdtCi(boundary);
    expect(plan.state).toBe("NOT_TESTED");
    expect(plan.executionGroups).toHaveLength(1);
    expect(plan.executionGroups[0]?.executions).toBe(1);
    expect(plan.gates.map((g) => g.id)).toEqual([
      "type",
      "lint",
      "unit195",
      "native195",
      "acl195",
      "externalSendConcurrency195",
      "http195",
    ]);
    expect(
      plan.gates
        .filter((g) => g.action === "shared-artifact")
        .map((g) => g.executionGroup),
    ).toEqual(["usdt195-native-concurrency", "usdt195-native-concurrency"]);
  });
  it("only validates supplied artifact contract; retains raw-stream and release limitations", () => {
    const f = synthetic(),
      proof = assertUsdt195CiArtifacts(f.seal(), f.context);
    expect(proof.artifactContract).toBe("VALIDATED");
    expect(proof.gates.map((g) => g.id)).toEqual([
      "native195",
      "externalSendConcurrency195",
    ]);
    expect(proof.evidenceBasis).toBe(
      "PINNED_RUNNER_SUMMARY_NOT_RAW_STREAM_REPLAY",
    );
    expect(proof.release).toBe("NOT_VERIFIED");
    expect(proof.wholeCi).toBe("NOT_INTEGRATED");
  });
  for (const field of [
    "state",
    "sourceManifestSha256",
    "runnerManifestSha256",
    "runnerGuardSha256",
    "acceptance",
    "scope",
    "actualTransfers",
    "cleanupPerformed",
    "httpAuth",
    "wholeCi",
    "committedSyntheticFixtures",
    "runId",
  ]) {
    it(
      "rejects stale or incomplete report even with recomputed artifact hash: " +
        field,
      () => {
        const f = synthetic();
        Object.assign(f.report, { [field]: null });
        expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
      },
    );
  }
  it("rejects rehashed extra UNKNOWN metadata", () => {
    const f = synthetic();
    Object.assign(f.report, { databaseOutcome: "UNKNOWN" });
    expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
  });
  it("rejects tampered actual bytes", () => {
    const f = synthetic(),
      bundle = f.seal();
    bundle.files["krw.sql"] = Buffer.from("select 1");
    expect(() => assertUsdt195CiArtifacts(bundle, f.context)).toThrow(
      "ARTIFACT_HASH_MISMATCH",
    );
  });
  it("rejects missing/reordered/duplicated phases", () => {
    for (const mode of ["missing", "reordered", "duplicate"]) {
      const f = synthetic();
      if (mode === "missing") f.report.phases.pop();
      if (mode === "reordered") f.report.phases.reverse();
      if (mode === "duplicate") f.report.phases[1] = f.report.phases[0]!;
      expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
    }
  });
  for (const [field, value] of [
    ["state", "FAILED"],
    ["exitCode", 1],
    ["derivativeSha256", "0".repeat(64)],
    ["originalSha256", "0".repeat(64)],
    ["stdoutSha256", ""],
    ["finishedAt", 0],
  ] as const) {
    it("rejects a partial phase: " + field, () => {
      const f = synthetic();
      Object.assign(f.report.phases[0]!, { [field]: value });
      expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
    });
  }
  it("requires the original exact derivative change list, not hash fields alone", () => {
    const f = synthetic();
    f.report.phases[0]!.changes.pop();
    expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
  });
  it("rejects historical child execution window and different run attempt", () => {
    const f = synthetic();
    f.context.finishedAt = f.context.startedAt;
    expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
    const g = synthetic();
    g.context.source = { ...g.context.source, attempt: 2 };
    expect(() => assertUsdt195CiArtifacts(g.seal(), g.context)).toThrow();
  });
  it("rejects invalid TAP count/plan or missing canonical concurrency assertions", () => {
    const f = synthetic();
    Object.assign(f.report.phases[0]!.proof, { plan: "1..79" });
    expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow(
      "EXACT_NATIVE_PROOF_REQUIRED",
    );
    const g = synthetic();
    Object.assign(g.report.phases[2]!.proof, { assertions: 39 });
    expect(() => assertUsdt195CiArtifacts(g.seal(), g.context)).toThrow(
      "EXACT_CONCURRENCY_PROOF_REQUIRED",
    );
  });
  it("rejects different advisory run or names order", () => {
    const f = synthetic();
    const p = f.report.phases[2]!.proof;
    Object.assign(p, {
      names: [...(p as { names: string[] }).names].reverse(),
    });
    expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
  });
  it("rejects stale target volume or different container", () => {
    const f = synthetic();
    f.report.target.volumeCreatedAt = "2020-01-01T00:00:00.000Z";
    expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
    const g = synthetic();
    g.context.expectedContainerId = "0".repeat(64);
    expect(() => assertUsdt195CiArtifacts(g.seal(), g.context)).toThrow();
  });
  it("rejects a volume reportedly created after observed preflight", () => {
    const f = synthetic();
    f.report.target.volumeCreatedAt = new Date(
      f.report.freshPreflight.observedAt + 1,
    ).toISOString();
    expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
  });
  it("requires clean actual CI provenance", () => {
    const f = synthetic();
    f.context.source = { ...f.context.source, worktreeClean: false };
    expect(() => assertUsdt195CiArtifacts(f.seal(), f.context)).toThrow();
  });
});
