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

test("multi-case browser files require every reviewed case and exact file assignment", () => {
  const passed = {
    status: "expected",
    results: [{ status: "passed", retry: 0 }],
  };
  const report = {
    stats: { expected: 3, unexpected: 0, flaky: 0, skipped: 0 },
    suites: [
      {
        specs: [
          { file: "tests/e2e/a.spec.ts", tests: [structuredClone(passed)] },
          { file: "tests/e2e/a.spec.ts", tests: [structuredClone(passed)] },
          { file: "tests/e2e/b.spec.ts", tests: [structuredClone(passed)] },
        ],
      },
    ],
  };
  const reviewed = ["a.spec.ts", "a.spec.ts", "b.spec.ts"];
  assert.doesNotThrow(() => assertPlaywrightReport(report, reviewed));
  assert.throws(
    () => assertPlaywrightReport(report, ["a.spec.ts", "b.spec.ts"]),
    /FILE_ASSIGNMENT/,
  );
  const omitted = structuredClone(report);
  omitted.suites[0].specs.splice(1, 1);
  omitted.stats.expected = 2;
  assert.throws(
    () => assertPlaywrightReport(omitted, reviewed),
    /FILE_ASSIGNMENT/,
  );
  const reassigned = structuredClone(report);
  reassigned.suites[0].specs[2].file = "tests/e2e/a.spec.ts";
  assert.throws(
    () => assertPlaywrightReport(reassigned, reviewed),
    /FILE_ASSIGNMENT/,
  );
  const retried = structuredClone(report);
  retried.suites[0].specs[1].tests[0].results.push({
    status: "passed",
    retry: 1,
  });
  assert.throws(
    () => assertPlaywrightReport(retried, reviewed),
    /RESULT_NOT_COMPLETE/,
  );
});
