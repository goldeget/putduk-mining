import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPlaywrightReport,
  assertVitestReport,
} from "./ci-workroom-evidence.mjs";
test("rejects incomplete, skipped and flaky browser runs", () => {
  const report = {
    stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
    suites: [
      {
        specs: [
          {
            tests: [
              { status: "expected", results: [{ status: "passed", retry: 0 }] },
            ],
          },
        ],
      },
    ],
  };
  assert.doesNotThrow(() => assertPlaywrightReport(report));
  for (const key of ["unexpected", "flaky", "skipped"])
    assert.throws(() =>
      assertPlaywrightReport({
        ...report,
        stats: { ...report.stats, [key]: 1 },
      }),
    );
  assert.throws(() => assertPlaywrightReport({ ...report, suites: [] }));
});
test("unit passing count must equal complete nonempty assertion inventory", () => {
  const report = {
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: "security.test.ts",
        status: "passed",
        assertionResults: [{ status: "passed" }],
      },
    ],
  };
  assert.doesNotThrow(() => assertVitestReport(report));
  assert.throws(() => assertVitestReport({ ...report, numPendingTests: 1 }));
  assert.throws(() => assertVitestReport({ ...report, testResults: [] }));
});
