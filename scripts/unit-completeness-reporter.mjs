import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
const normalized = (path) => path.replaceAll("\\", "/");
const key = (entry) =>
  `${entry.project?.name ?? ""}\0${normalized(entry.moduleId)}`;
const duplicateKeys = (entries) => {
  const seen = new Set();
  return entries
    .filter((entry) => {
      const id = key(entry);
      if (seen.has(id)) return true;
      seen.add(id);
      return false;
    })
    .map((entry) => entry.moduleId);
};
export function unitRunCompleteness(specifications, modules) {
  const expected = new Map(
    specifications.map((entry) => [key(entry), entry.moduleId]),
  );
  const actual = new Map(modules.map((entry) => [key(entry), entry.moduleId]));
  const missing = [...expected]
    .filter(([id]) => !actual.has(id))
    .map(([, path]) => path);
  const unexpected = [...actual]
    .filter(([id]) => !expected.has(id))
    .map(([, path]) => path);
  const duplicateAdmissions = duplicateKeys(specifications),
    duplicateModules = duplicateKeys(modules);
  return {
    complete:
      expected.size > 0 &&
      !missing.length &&
      !unexpected.length &&
      !duplicateAdmissions.length &&
      !duplicateModules.length,
    expectedFiles: expected.size,
    reportedFiles: actual.size,
    missing,
    unexpected,
    duplicateAdmissions,
    duplicateModules,
  };
}
export function jsonUnitCompleteness(receipt, report) {
  const rows = Array.isArray(report.testResults) ? report.testResults : [];
  const expected = receipt.modules ?? [];
  const expectedNames = expected.map((row) => normalized(row.moduleId));
  const names = rows.map((row) => normalized(row.name));
  const issues = [];
  if (!receipt.complete || !expected.length)
    issues.push("INCOMPLETE_MODULE_RECEIPT");
  if (new Set(expectedNames).size !== expectedNames.length)
    issues.push("AMBIGUOUS_PROJECT_PATH");
  if (new Set(names).size !== names.length)
    issues.push("DUPLICATE_JSON_MODULE");
  for (const name of expectedNames)
    if (!names.includes(name)) issues.push(`MISSING_JSON_MODULE:${name}`);
  for (const name of names)
    if (!expectedNames.includes(name))
      issues.push(`UNEXPECTED_JSON_MODULE:${name}`);
  let total = 0,
    passed = 0,
    failed = 0,
    skipped = 0;
  for (const unit of expected) {
    const row = rows.find(
      (entry) => normalized(entry.name) === normalized(unit.moduleId),
    );
    if (!row) continue;
    const assertions = row.assertionResults;
    if (!Array.isArray(assertions)) {
      issues.push(`MISSING_JSON_ASSERTIONS:${row.name}`);
      continue;
    }
    const counts = { passed: 0, failed: 0, skipped: 0 };
    for (const assertion of assertions) {
      if (assertion.status === "passed") counts.passed++;
      else if (assertion.status === "failed") counts.failed++;
      else if (["pending", "todo", "skipped"].includes(assertion.status))
        counts.skipped++;
      else issues.push(`UNKNOWN_JSON_STATE:${assertion.status}`);
    }
    const actualIdentities = assertions
      .map(
        (assertion) =>
          JSON.stringify([
            ...(assertion.ancestorTitles ?? []),
            assertion.title,
          ]) +
          "\0" +
          (["pending", "todo", "skipped"].includes(assertion.status)
            ? "skipped"
            : assertion.status),
      )
      .sort();
    const expectedIdentities = (unit.assertions ?? [])
      .map((assertion) => assertion.identity + "\0" + assertion.state)
      .sort();
    if (
      expectedIdentities.length !== unit.tests ||
      JSON.stringify(actualIdentities) !== JSON.stringify(expectedIdentities)
    )
      issues.push(`JSON_ASSERTION_IDENTITIES_CHANGED:${row.name}`);
    if (
      assertions.length !== unit.tests ||
      counts.passed !== unit.passed ||
      counts.failed !== unit.failed ||
      counts.skipped !== unit.skipped
    )
      issues.push(`JSON_ASSERTION_COUNTS_CHANGED:${row.name}`);
    total += assertions.length;
    passed += counts.passed;
    failed += counts.failed;
    skipped += counts.skipped;
  }
  if (
    report.numTotalTests !== total ||
    report.numPassedTests !== passed ||
    report.numFailedTests !== failed ||
    (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0) !== skipped
  )
    issues.push("JSON_TOTALS_CHANGED");
  return {
    complete: issues.length === 0,
    issues,
    files: rows.length,
    total,
    passed,
    failed,
    skipped,
  };
}
// Independent admission/results receipt. Validate the final JSON only after
// Vitest exits: onTestRunEnd reporters may write concurrently in Vitest 5.
export default class UnitCompletenessReporter {
  onInit(context) {
    this.context = context;
  }
  onTestRunStart(specifications) {
    this.specifications = specifications;
  }
  onTestRunEnd(modules, errors, reason) {
    const inventory = modules.map((unit) => {
      const counts = { tests: 0, passed: 0, failed: 0, skipped: 0, pending: 0 };
      const assertions = [];
      for (const test of unit.children.allTests()) {
        counts.tests++;
        const state = test.result().state;
        const ancestors = [];
        let parent = test.parent;
        while (parent.type !== "module") {
          ancestors.push(parent.name);
          parent = parent.parent;
        }
        assertions.push({
          identity: JSON.stringify([...ancestors.reverse(), test.name]),
          state,
        });
        if (Object.hasOwn(counts, state)) counts[state]++;
        else counts.pending++;
      }
      return {
        moduleId: unit.moduleId,
        project: unit.project.name,
        state: unit.state(),
        ...counts,
        assertions,
      };
    });
    const incomplete = inventory.filter(
      (unit) =>
        !unit.tests ||
        unit.pending ||
        ["queued", "pending"].includes(unit.state),
    );
    const receipt = {
      ...unitRunCompleteness(this.specifications ?? [], modules),
      modules: inventory,
      incomplete,
      unhandledErrors: errors.length,
      reason,
    };
    receipt.complete =
      receipt.complete &&
      !incomplete.length &&
      errors.length === 0 &&
      reason !== "interrupted";
    const configured = this.context.config.outputFile;
    const output =
      typeof configured === "string" ? configured : configured?.json;
    const target = output
      ? `${output}.completeness.json`
      : resolve(
          this.context.config.root,
          "node_modules/.cache/putduk-unit-completeness.json",
        );
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(receipt, null, 2));
    if (!receipt.complete) {
      process.exitCode = 1;
      throw Error("UNIT_RUN_INCOMPLETE");
    }
  }
}
