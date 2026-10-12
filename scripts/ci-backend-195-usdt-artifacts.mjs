/**
 * Artifact contract only. Reading a supplied bundle is not an independent execution
 * attestation. The CLI binds it to one current pinned runner child; no full-CI PASS.
 */
import { createHash } from "node:crypto";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exact = (v, fields) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  same(Object.keys(v).sort(), [...fields].sort());
const digest = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const time = (v) => Number.isSafeInteger(v) && v > 0;
const fail = (reason) => {
  throw new Error("USDT195_CI_" + reason);
};
export const USDT195_CI_PINS = Object.freeze({
  candidate: "0d078c0787b5619edfebd800f3f6a5f00848540d97373fac369c87872313b3df",
  runner: "f24506246a0ce47f8b5eef53f0cdb79ddcecd6323c69538666afd4c085e1d482",
  guard: "137086003991fc6f4059063886b187f3c4419e5eab57094322f97f3467712d19",
});
const PHASES = ["krw", "principal", "concurrency"];
const ARTIFACTS = [
  "execution.json",
  "krw.sql",
  "principal.sql",
  "concurrency.py",
];
const phaseFields = [
  "id",
  "state",
  "startedAt",
  "originalSha256",
  "derivativeSha256",
  "artifact",
  "changes",
  "exitCode",
  "finishedAt",
  "stdoutSha256",
  "stderrSha256",
  "proof",
];
const reportFields = [
  "version",
  "kind",
  "state",
  "release",
  "source",
  "sourceManifestSha256",
  "runnerManifestSha256",
  "scope",
  "runId",
  "startedAt",
  "phases",
  "cleanupPerformed",
  "actualTransfers",
  "httpAuth",
  "wholeCi",
  "runnerGuardSha256",
  "target",
  "hostPythonVersion",
  "freshPreflight",
  "testToolPreparation",
  "acceptance",
  "committedSyntheticFixtures",
  "finishedAt",
];
function sourceIdentity(source, scope) {
  const fields = [
    "repository",
    "sourceSha",
    "parents",
    "worktreeClean",
    "scope",
  ];
  if (scope === "CANONICAL_CI")
    fields.push("candidateSha", "runId", "attempt", "event");
  if (
    !exact(source, fields) ||
    source.repository !== "goldeget/putduk-mining" ||
    !/^[0-9a-f]{40}$/.test(source.sourceSha) ||
    !Array.isArray(source.parents) ||
    source.parents.some((v) => !/^[0-9a-f]{40}$/.test(v)) ||
    new Set(source.parents).size !== source.parents.length ||
    typeof source.worktreeClean !== "boolean"
  )
    fail("SOURCE_IDENTITY_REQUIRED");
  if (
    scope === "CANONICAL_CI" &&
    (source.scope !== "CI" ||
      source.worktreeClean !== true ||
      !/^[0-9a-f]{40}$/.test(source.candidateSha) ||
      (source.candidateSha !== source.sourceSha &&
        !source.parents.includes(source.candidateSha)) ||
      !/^[0-9]+$/.test(source.runId) ||
      !Number.isSafeInteger(source.attempt) ||
      source.attempt < 1 ||
      !["push", "pull_request"].includes(source.event))
  )
    fail("ACTUAL_CI_SOURCE_REQUIRED");
  if (scope === "LOCAL_QA" && source.scope !== "local")
    fail("LOCAL_SOURCE_REQUIRED");
}
function parsed(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > 8 * 1024 * 1024
  )
    fail("ARTIFACT_BYTES_REQUIRED");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("ARTIFACT_JSON_REQUIRED");
  }
}
export function assertUsdt195CiArtifacts(bundle, context) {
  if (
    arguments.length !== 2 ||
    !["CANONICAL_CI", "LOCAL_QA"].includes(context?.scope) ||
    !exact(bundle, ["manifest", "files"]) ||
    !exact(bundle.files, ARTIFACTS) ||
    !digest(context.expectedContainerId) ||
    !time(context.startedAt) ||
    !time(context.finishedAt) ||
    context.finishedAt < context.startedAt ||
    context.childExitCode !== 0 ||
    !digest(context.childStdoutSha256) ||
    !digest(context.childStderrSha256)
  )
    fail("CURRENT_CHILD_CONTEXT_REQUIRED");
  sourceIdentity(context.source, context.scope);
  const boundary = context.boundary;
  const canonical = context.scope === "CANONICAL_CI";
  if (
    boundary?.scope !== context.scope ||
    boundary.repository !== "goldeget/putduk-mining" ||
    boundary.projectId !==
      (canonical
        ? "putduk-mining-ci-r2-20261009"
        : "putduk-mining-backend-patch-20261011") ||
    boundary.apiPort !== (canonical ? 63421 : 65421) ||
    boundary.dbPort !== (canonical ? 63422 : 65422) ||
    boundary.migrationSources !== 195 ||
    boundary.runtimeSources !== 33 ||
    boundary.manifestSha256 !== USDT195_CI_PINS.candidate ||
    !Array.isArray(boundary.migrationVersions) ||
    boundary.migrationVersions.length !== 195 ||
    new Set(boundary.migrationVersions).size !== 195 ||
    boundary.migrationVersions.some((v) => !/^[0-9]{14}$/.test(v))
  )
    fail("EXACT195_BOUNDARY_REQUIRED");
  const manifest = parsed(bundle.manifest),
    report = parsed(bundle.files["execution.json"]);
  if (
    !exact(manifest, ["version", "state", "runId", "files"]) ||
    manifest.version !== 1 ||
    manifest.state !== "PASSED" ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== 4 ||
    !same(
      manifest.files.map((v) => v.path),
      ARTIFACTS,
    )
  )
    fail("EXACT_ARTIFACT_MANIFEST_REQUIRED");
  for (const entry of manifest.files) {
    if (
      !exact(entry, ["path", "sha256"]) ||
      !digest(entry.sha256) ||
      !Buffer.isBuffer(bundle.files[entry.path]) ||
      hash(bundle.files[entry.path]) !== entry.sha256
    )
      fail("ARTIFACT_HASH_MISMATCH");
  }
  if (
    !exact(report, reportFields) ||
    report.version !== 1 ||
    report.kind !== "USDT195_NATIVE_CONCURRENCY_EXECUTION" ||
    report.state !== "PASSED" ||
    report.release !== "NOT_VERIFIED" ||
    report.acceptance !== "NATIVE_AND_CONCURRENCY_ONLY" ||
    report.scope !== context.scope ||
    !same(report.source, context.source) ||
    report.sourceManifestSha256 !== USDT195_CI_PINS.candidate ||
    report.runnerManifestSha256 !== USDT195_CI_PINS.runner ||
    report.runnerGuardSha256 !== USDT195_CI_PINS.guard ||
    report.cleanupPerformed !== false ||
    report.actualTransfers !== false ||
    report.httpAuth !== "NOT_TESTED" ||
    report.wholeCi !== "NOT_INTEGRATED" ||
    report.committedSyntheticFixtures !== true ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      report.runId,
    ) ||
    manifest.runId !== report.runId ||
    !time(report.startedAt) ||
    !time(report.finishedAt) ||
    report.startedAt < context.startedAt ||
    report.finishedAt > context.finishedAt ||
    report.finishedAt < report.startedAt
  )
    fail("CURRENT_RUNNER_REPORT_REQUIRED");
  const target = report.target,
    preflight = report.freshPreflight,
    prep = report.testToolPreparation;
  if (
    !exact(target, [
      "containerId",
      "containerName",
      "volumeName",
      "createdAt",
      "volumeCreatedAt",
    ]) ||
    target.containerId !== context.expectedContainerId ||
    target.containerName !== "supabase_db_" + boundary.projectId ||
    target.volumeName !== target.containerName ||
    !Number.isFinite(Date.parse(target.createdAt)) ||
    !Number.isFinite(Date.parse(target.volumeCreatedAt)) ||
    Date.parse(target.createdAt) > preflight?.observedAt ||
    Date.parse(target.volumeCreatedAt) > preflight?.observedAt ||
    report.startedAt - Date.parse(target.createdAt) > 3600000 ||
    report.startedAt - Date.parse(target.volumeCreatedAt) > 3600000 ||
    Date.parse(target.volumeCreatedAt) < Date.parse(target.createdAt) - 60000 ||
    !exact(preflight, ["exact195", "emptyAuthAndMoney", "observedAt"]) ||
    preflight.exact195 !== true ||
    preflight.emptyAuthAndMoney !== true ||
    !time(preflight.observedAt) ||
    preflight.observedAt < report.startedAt ||
    preflight.observedAt > report.finishedAt ||
    !exact(prep, ["pgtap", "exitCode", "stdoutSha256", "stderrSha256"]) ||
    prep.pgtap !== true ||
    prep.exitCode !== 0 ||
    !digest(prep.stdoutSha256) ||
    !digest(prep.stderrSha256) ||
    !Array.isArray(report.hostPythonVersion) ||
    report.hostPythonVersion.length !== 3 ||
    report.hostPythonVersion.some((v) => !Number.isSafeInteger(v) || v < 0) ||
    report.hostPythonVersion[0] !== 3 ||
    report.hostPythonVersion[1] < 11
  )
    fail("FRESH_TEST_TARGET_REQUIRED");
  if (
    !Array.isArray(report.phases) ||
    !same(
      report.phases.map((p) => p.id),
      PHASES,
    ) ||
    !exact(context.expectedDerivatives, PHASES)
  )
    fail("EXACT_PHASES_REQUIRED");
  let previous = preflight.observedAt;
  for (let i = 0; i < PHASES.length; i++) {
    const kind = PHASES[i],
      phase = report.phases[i],
      expected = context.expectedDerivatives[kind];
    const fields =
      kind === "concurrency" ? [...phaseFields, "launcherSha256"] : phaseFields;
    if (
      !exact(phase, fields) ||
      phase.state !== "PASSED" ||
      phase.exitCode !== 0 ||
      !time(phase.startedAt) ||
      !time(phase.finishedAt) ||
      phase.startedAt < previous ||
      phase.finishedAt < phase.startedAt ||
      phase.finishedAt > report.finishedAt ||
      !digest(phase.stdoutSha256) ||
      !digest(phase.stderrSha256) ||
      phase.artifact !== ARTIFACTS[i + 1] ||
      phase.originalSha256 !== expected?.originalSha256 ||
      phase.derivativeSha256 !== expected?.sha256 ||
      hash(bundle.files[phase.artifact]) !== expected?.sha256 ||
      !same(phase.changes, expected?.changes) ||
      phase.changes.length !== { krw: 8, principal: 3, concurrency: 2 }[kind] ||
      phase.changes.some(
        (c) =>
          !exact(c, ["name", "beforeSha256", "afterSha256", "matches"]) ||
          !c.name ||
          !digest(c.beforeSha256) ||
          !digest(c.afterSha256) ||
          c.matches !== 1,
      )
    )
      fail("PINNED_PHASE_PROOF_REQUIRED");
    previous = phase.finishedAt;
    if (kind === "concurrency") {
      const proof = phase.proof,
        contract = context.concurrencyContract;
      if (
        phase.launcherSha256 !== context.launcherSha256 ||
        !digest(context.launcherSha256) ||
        !exact(proof, [
          "assertions",
          "names",
          "run",
          "fixturePreludeSha256",
          "skipped",
        ]) ||
        !/^[0-9a-f]{16}$/.test(proof.run) ||
        !Array.isArray(proof.names) ||
        proof.assertions !== (canonical ? 41 : 39) ||
        proof.skipped !== 0 ||
        proof.fixturePreludeSha256 !== contract?.fixture_sha256 ||
        !same(
          proof.names,
          contract?.[canonical ? "canonical" : "local"]?.map((n) =>
            n.replace("{run}", proof.run),
          ),
        )
      )
        fail("EXACT_CONCURRENCY_PROOF_REQUIRED");
    } else {
      const count = kind === "krw" ? 80 : 388,
        proof = phase.proof;
      if (
        !exact(proof, ["assertions", "plan", "skipped", "tapSha256"]) ||
        proof.assertions !== count ||
        proof.plan !== "1.." + count ||
        proof.skipped !== 0 ||
        !digest(proof.tapSha256)
      )
        fail("EXACT_NATIVE_PROOF_REQUIRED");
    }
  }
  const artifactDigest = hash(bundle.manifest);
  const gates = canonical
    ? [
        {
          id: "native195",
          status: "passed",
          exitCode: 0,
          executed: true,
          skipped: 0,
          flaky: 0,
          expectedFailures: 0,
          startedAt: report.phases[0].startedAt,
          finishedAt: report.phases[1].finishedAt,
          evidenceSha256: artifactDigest,
        },
        {
          id: "externalSendConcurrency195",
          status: "passed",
          exitCode: 0,
          executed: true,
          skipped: 0,
          flaky: 0,
          expectedFailures: 0,
          startedAt: report.phases[2].startedAt,
          finishedAt: report.phases[2].finishedAt,
          evidenceSha256: artifactDigest,
        },
      ]
    : [];
  return Object.freeze({
    candidate: "195",
    scope: context.scope,
    artifactContract: "VALIDATED",
    source: context.source,
    runnerRunId: report.runId,
    containerId: target.containerId,
    artifactManifestSha256: artifactDigest,
    executionSha256: hash(bundle.files["execution.json"]),
    evidenceBasis: "PINNED_RUNNER_SUMMARY_NOT_RAW_STREAM_REPLAY",
    gates: Object.freeze(gates.map((g) => Object.freeze(g))),
    release: "NOT_VERIFIED",
    wholeCi: "NOT_INTEGRATED",
  });
}
