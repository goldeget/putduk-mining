import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeWorkerReport } from "./assert-worker-report.mjs";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";

const options = { cwd: "/putduk-fixture", startedAfter: 1000, now: 2000 };
function report() {
  return {
    startTime: 1500,
    success: true,
    numTotalTests: 1,
    numPassedTests: 1,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: "/putduk-fixture/tests/worker/runtime-evidence.test.ts",
        status: "passed",
        assertionResults: [
          { fullName: "real worker execution", status: "passed", duration: 20 },
        ],
      },
    ],
  };
}

test("accepts current execution and excludes raw titles, errors and payloads", () => {
  const data = report();
  data.testResults[0].message = "SECRET_PAYLOAD";
  data.testResults[0].assertionResults[0].failureMessages = ["SECRET_PAYLOAD"];
  data.testResults[0].assertionResults[0].fullName = "SECRET_PAYLOAD";
  const summary = summarizeWorkerReport(data, options);
  assert.equal(summary.accepted, true);
  assert.equal(summary.tests[0].durationMs, 20);
  assert.match(summary.tests[0].nameSha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(summary).includes("SECRET_PAYLOAD"));
});

for (const startTime of [999, 2001, undefined]) {
  test(`rejects stale or invalid start time ${startTime}`, () => {
    assert.throws(() =>
      summarizeWorkerReport({ ...report(), startTime }, options),
    );
  });
}

test("a zero-test report cannot pass", () => {
  const data = report();
  data.numTotalTests = data.numPassedTests = 0;
  data.testResults[0].assertionResults = [];
  assert.equal(summarizeWorkerReport(data, options).accepted, false);
});

for (const status of ["failed", "skipped", "todo"]) {
  test(`preserves ${status} evidence as failure acceptance`, () => {
    const data = report();
    data.numPassedTests = 0;
    data[
      status === "failed"
        ? "numFailedTests"
        : status === "todo"
          ? "numTodoTests"
          : "numPendingTests"
    ] = 1;
    data.testResults[0].assertionResults[0].status = status;
    assert.equal(summarizeWorkerReport(data, options).accepted, false);
  });
}

test("rejects mismatched counts and duplicate files", () => {
  assert.throws(() =>
    summarizeWorkerReport({ ...report(), numTotalTests: 2 }, options),
  );
  const data = report();
  data.testResults.push(data.testResults[0]);
  assert.throws(() => summarizeWorkerReport(data, options));
});

test("rejects test files outside the worker suite", () => {
  const data = report();
  data.testResults[0].name = "/outside/secret.test.ts";
  assert.throws(() => summarizeWorkerReport(data, options));
});

test("does not convert runner or file failure into test success", () => {
  assert.equal(
    summarizeWorkerReport({ ...report(), success: false }, options).accepted,
    false,
  );
  const data = report();
  data.testResults[0].status = "failed";
  assert.equal(summarizeWorkerReport(data, options).accepted, false);
});

const checkoutSha = "a".repeat(40);
const candidateSha = "b".repeat(40);
const ci = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "goldeget/putduk-mining",
  GITHUB_SHA: checkoutSha,
  CI_HEAD_SHA: candidateSha,
  GITHUB_RUN_ID: "123",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_EVENT_NAME: "pull_request",
};
function gitFixture({
  dirty = false,
  origin = "https://github.com/goldeget/putduk-mining.git",
  parents = [candidateSha],
} = {}) {
  return (...args) => {
    if (args[0] === "remote") return origin;
    if (args[0] === "rev-parse") return checkoutSha;
    if (args[0] === "cat-file")
      return parents.map((sha) => `parent ${sha}`).join("\n");
    if (args[0] === "status") return dirty ? " M fixture.ts" : "";
    throw new Error("Unexpected Git read");
  };
}

test("records a clean exact PR merge checkout and candidate separately", () => {
  const source = collectCiSourceEvidence(ci, gitFixture());
  assert.equal(source.sourceSha, checkoutSha);
  assert.equal(source.candidateSha, candidateSha);
  assert.deepEqual(source.parents, [candidateSha]);
  assert.equal(source.worktreeClean, true);
});

test("records dirty local validation without claiming exact candidate evidence", () => {
  const source = collectCiSourceEvidence({}, gitFixture({ dirty: true }));
  assert.equal(source.scope, "local");
  assert.equal(source.worktreeClean, false);
  assert.equal(source.candidateSha, undefined);
});

test("rejects dirty CI, a different checkout and an unrelated candidate", () => {
  assert.throws(() => collectCiSourceEvidence(ci, gitFixture({ dirty: true })));
  assert.throws(() =>
    collectCiSourceEvidence({ ...ci, GITHUB_SHA: candidateSha }, gitFixture()),
  );
  assert.throws(() => collectCiSourceEvidence(ci, gitFixture({ parents: [] })));
});

test("rejects missing run identity and other repositories before reporting", () => {
  assert.throws(() =>
    collectCiSourceEvidence({ ...ci, GITHUB_RUN_ATTEMPT: "" }, gitFixture()),
  );
  assert.throws(() =>
    collectCiSourceEvidence(
      ci,
      gitFixture({ origin: "https://github.com/out-of-scope/repo.git" }),
    ),
  );
  assert.throws(() =>
    collectCiSourceEvidence(
      { ...ci, GITHUB_REPOSITORY: "out-of-scope/repo" },
      gitFixture(),
    ),
  );
});

test("does not mistake commit-message text for a candidate parent", () => {
  const git = gitFixture({ parents: [] });
  const withMessage = (...args) =>
    args[0] === "cat-file"
      ? `tree ${checkoutSha}\n\nparent ${candidateSha}`
      : git(...args);
  assert.throws(() => collectCiSourceEvidence(ci, withMessage));
});

test("accepts an exact push checkout without claiming a merge checkout", () => {
  const source = collectCiSourceEvidence(
    { ...ci, GITHUB_EVENT_NAME: "push", CI_HEAD_SHA: checkoutSha },
    gitFixture({ parents: [] }),
  );
  assert.equal(source.sourceSha, source.candidateSha);
  assert.deepEqual(source.parents, []);
});
