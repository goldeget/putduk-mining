import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";

const COUNT_FIELDS = [
  "numTotalTests",
  "numPassedTests",
  "numFailedTests",
  "numPendingTests",
  "numTodoTests",
];

export function summarizeWorkerReport(
  report,
  { startedAfter, now = Date.now(), cwd = process.cwd() },
) {
  if (
    !Number.isSafeInteger(startedAfter) ||
    startedAfter <= 0 ||
    !Number.isFinite(report?.startTime) ||
    report.startTime < startedAfter ||
    report.startTime > now ||
    !Array.isArray(report.testResults) ||
    !report.testResults.length ||
    COUNT_FIELDS.some(
      (field) => !Number.isSafeInteger(report[field]) || report[field] < 0,
    )
  )
    throw new Error("Missing, stale or invalid worker execution report");

  const tests = [];
  const files = [];
  const problems = [];
  for (const result of report.testResults) {
    const file = path
      .relative(cwd, result.name ?? "")
      .split(path.sep)
      .join("/");
    if (
      !/^tests\/worker\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.test\.ts$/.test(
        file,
      ) ||
      !Array.isArray(result.assertionResults)
    ) {
      throw new Error("Invalid worker test file identity");
    }
    files.push(file);
    if (result.status !== "passed") problems.push("Worker file did not pass");
    for (const [index, assertion] of result.assertionResults.entries()) {
      if (
        typeof assertion.fullName !== "string" ||
        !assertion.fullName ||
        ![
          "passed",
          "failed",
          "pending",
          "todo",
          "skipped",
          "disabled",
        ].includes(assertion.status)
      ) {
        throw new Error("Invalid worker test execution identity");
      }
      tests.push({
        file,
        index,
        nameSha256: createHash("sha256")
          .update(assertion.fullName)
          .digest("hex"),
        status: assertion.status,
        durationMs: Number.isFinite(assertion.duration)
          ? assertion.duration
          : null,
      });
    }
  }
  const counts = Object.fromEntries(
    COUNT_FIELDS.map((field) => [field, report[field]]),
  );
  const passed = tests.filter((test) => test.status === "passed").length;
  const failed = tests.filter((test) => test.status === "failed").length;
  const pending = tests.filter((test) =>
    ["pending", "skipped", "disabled"].includes(test.status),
  ).length;
  const todo = tests.filter((test) => test.status === "todo").length;
  if (
    new Set(files).size !== files.length ||
    counts.numTotalTests !== tests.length ||
    counts.numPassedTests !== passed ||
    counts.numFailedTests !== failed ||
    counts.numPendingTests !== pending ||
    counts.numTodoTests !== todo
  )
    throw new Error(
      "Worker report counts or file identities do not match execution",
    );
  if (!tests.length || passed !== tests.length || report.success !== true) {
    problems.push(
      "Worker execution must contain passing tests with no failures, skips or todos",
    );
  }
  return {
    startTime: report.startTime,
    observedAt: now,
    counts,
    files,
    tests,
    accepted: !problems.length,
    problems,
  };
}

function main() {
  if (process.argv.length !== 5 || process.argv[3] !== "--started-after") {
    throw new Error(
      "Usage: node scripts/assert-worker-report.mjs <vitest.json> --started-after <epoch-ms>",
    );
  }
  const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const summary = summarizeWorkerReport(report, {
    startedAfter: Number(process.argv[4]),
  });
  const source = collectCiSourceEvidence();
  const output = "test-results/worker/report.json";
  mkdirSync(path.dirname(output), { recursive: true });
  // Never preserve raw titles, failure messages, console output, env or payloads.
  writeFileSync(output, JSON.stringify({ source, ...summary }, null, 2) + "\n");
  console.log(
    `Worker execution: passed=${summary.counts.numPassedTests} failed=${summary.counts.numFailedTests} skipped=${summary.counts.numPendingTests} todo=${summary.counts.numTodoTests}; accepted=${summary.accepted}`,
  );
  if (!summary.accepted) throw new Error(summary.problems.join("; "));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch {
    console.error(
      "Worker execution evidence is missing, stale, invalid or unsuccessful; inspect the local test output",
    );
    process.exitCode = 1;
  }
}
