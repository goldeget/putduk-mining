/**
 * Candidate195 backend CI contract. --plan collects identity only; it never runs
 * a gate, edits the DB, starts a server or substitutes for the full release CI.
 */
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { assertBackendHttp195CanonicalCandidateSources } from "./backend-http-195-source.mjs";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";

const GATES = [
  ["type", ["pnpm", "typecheck"]],
  ["lint", ["pnpm", "lint"]],
  [
    "unit195",
    [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "tests/unit/backend-http-195-source.test.ts",
      "tests/unit/backend-http-195-consumer.test.ts",
      "tests/unit/usdt-manual-195-fixture.test.ts",
      "tests/unit/usdt-manual-payout-contract.test.ts",
      "tests/unit/withdrawal-lifecycle-worker.test.ts",
      "tests/unit/ai-chat-audit-persistence-failure.test.ts",
      "tests/unit/ai-member-help-route.test.ts",
      "tests/unit/ai-persistence-recovery-regression.test.ts",
    ],
  ],
  ["native195", ["USDT195_REVIEWED_NATIVE_ADAPTER", "principal", "krw"]],
  [
    "acl195",
    [
      "supabase",
      "test",
      "db",
      "supabase/tests/database/usdt_manual_full_payout_contract.sql",
      "supabase/tests/database/withdrawal_lifecycle_outbox_ack.sql",
      "supabase/tests/database/ai_conversation_storage.sql",
      "supabase/tests/database/ai_conversation_summaries.sql",
      "supabase/tests/database/ai_tool_evidence.sql",
      "supabase/tests/database/rls.sql",
      "supabase/tests/database/ws04_security_money_workers.sql",
    ],
  ],
  ["externalSendConcurrency195", ["USDT195_REVIEWED_CONCURRENCY_ADAPTER"]],
  [
    "http195",
    [
      "pnpm",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.backend-http-195.config.ts",
      "--project",
      "backend-api",
      "--fail-on-flaky-tests",
    ],
  ],
];
const validHash = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function planBackend195Gates(boundary) {
  if (
    boundary?.scope !== "CANONICAL_CI" ||
    boundary.repository !== "goldeget/putduk-mining" ||
    boundary.projectId !== "putduk-mining-ci-r2-20261009" ||
    boundary.apiPort !== 63421 ||
    boundary.dbPort !== 63422 ||
    boundary.migrationSources !== 195 ||
    boundary.runtimeSources !== 33 ||
    !validHash(boundary.manifestSha256) ||
    !Array.isArray(boundary.migrationVersions) ||
    boundary.migrationVersions.length !== 195 ||
    new Set(boundary.migrationVersions).size !== 195 ||
    boundary.migrationVersions.some((version) => !/^[0-9]{14}$/.test(version))
  )
    throw new Error("BACKEND_195_CI_BOUNDARY_REQUIRED");
  return Object.freeze({
    version: 1,
    candidate: "195",
    purpose: "BACKEND_CANDIDATE_ONLY",
    state: "NOT_TESTED",
    sourceBoundary: boundary,
    gates: Object.freeze(
      GATES.map(([id, command]) =>
        Object.freeze({
          id,
          command: Object.freeze([...command]),
          required: true,
        }),
      ),
    ),
    releaseEvidence: "NOT_REPLACED",
    integrationPending: Object.freeze([
      "Whole workflow and wall-clock job registration are not changed",
      "Frozen191/193 current-checkout consumers are not195 acceptance",
      "Historical NULL receipts require genuine before194 upgrade evidence",
      "Protected USDT admin screen is UI_INTEGRATION_PENDING",
      "Worker3 positive original chain and complete UI E2E remain required",
    ]),
  });
}

/** Reject missing, duplicate, skipped, expected-failure and stale gate evidence. */
export function assertBackend195ExecutionReport(report, boundary, source) {
  const plan = planBackend195Gates(boundary);
  if (
    source?.scope !== "CI" ||
    source.repository !== boundary.repository ||
    source.worktreeClean !== true ||
    !/^[0-9a-f]{40}$/.test(source.sourceSha) ||
    !/^[0-9a-f]{40}$/.test(source.candidateSha) ||
    !/^[0-9]+$/.test(source.runId) ||
    !Number.isInteger(source.attempt) ||
    source.attempt < 1 ||
    !["push", "pull_request"].includes(source.event) ||
    report?.kind !== "BACKEND_195_EXECUTION" ||
    report.state !== "EXECUTED" ||
    report.listOnly !== false ||
    !equal(report.source, source) ||
    report.manifestSha256 !== boundary.manifestSha256 ||
    !equal(report.migrationVersions, boundary.migrationVersions) ||
    !Number.isFinite(report.startedAt) ||
    !Number.isFinite(report.finishedAt) ||
    report.finishedAt < report.startedAt ||
    !Array.isArray(report.gates) ||
    report.gates.length !== plan.gates.length ||
    new Set(report.gates.map((gate) => gate.id)).size !== plan.gates.length
  )
    throw new Error("BACKEND_195_CURRENT_EXECUTION_REQUIRED");
  for (const expected of plan.gates) {
    const gate = report.gates.find((row) => row.id === expected.id);
    if (
      !gate ||
      gate.status !== "passed" ||
      gate.exitCode !== 0 ||
      gate.executed !== true ||
      gate.skipped !== 0 ||
      gate.flaky !== 0 ||
      gate.expectedFailures !== 0 ||
      !validHash(gate.evidenceSha256) ||
      !Number.isFinite(gate.startedAt) ||
      !Number.isFinite(gate.finishedAt) ||
      gate.startedAt < report.startedAt ||
      gate.finishedAt > report.finishedAt ||
      gate.finishedAt < gate.startedAt
    )
      throw new Error("BACKEND_195_GATE_NOT_VERIFIED:" + expected.id);
  }
  return Object.freeze({
    candidate: "195",
    reportContract: "VALIDATED",
    release: "NOT_VERIFIED",
  });
}

/** Both inventories must come from the same pinned config and execution identity. */
export function assertBackend195HttpCoverage(expected, actual) {
  const key = (row) => JSON.stringify([row.project, row.file, row.key]);
  if (
    !Array.isArray(expected) ||
    !expected.length ||
    !Array.isArray(actual) ||
    new Set(expected.map(key)).size !== expected.length ||
    new Set(actual.map(key)).size !== actual.length ||
    !equal(expected.map(key).sort(), actual.map(key).sort())
  )
    throw new Error("BACKEND_195_HTTP_INVENTORY_MISMATCH");
  for (const row of actual) {
    if (
      typeof row.key !== "string" ||
      !row.key ||
      row.project !== "backend-api" ||
      row.file !==
        "tests/e2e/authenticated/usdt-manual-full-payout-195.spec.ts" ||
      row.expectedStatus !== "passed" ||
      row.status !== "expected" ||
      !Array.isArray(row.results) ||
      row.results.length !== 1 ||
      row.results[0].status !== "passed" ||
      row.results[0].retry !== 0
    )
      throw new Error("BACKEND_195_HTTP_TEST_NOT_PASSED");
  }
  return Object.freeze({ tests: actual.length, skipped: 0, flaky: 0 });
}

function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--plan")
    throw new Error(
      "Usage: node scripts/ci-backend-195.mjs --plan (identity only; no gates executed)",
    );
  const boundary = assertBackendHttp195CanonicalCandidateSources();
  const source = collectCiSourceEvidence(process.env, (...args) =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    }).trim(),
  );
  console.log(
    JSON.stringify({ ...planBackend195Gates(boundary), source }, null, 2),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
