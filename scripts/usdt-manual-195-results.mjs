import { createHash } from "node:crypto";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...expected].sort());

export function parseUsdt195RunnerArguments(args) {
  if (!Array.isArray(args) || args.length !== 5 ||
      !["--execute", "--allow-synthetic-db-writes", "--confirmed-full-payout"].every(flag => args.filter(a => a === flag).length === 1))
    throw new Error("USDT195_EXPLICIT_EXECUTION_ARGUMENTS_REQUIRED");
  const ids = args.filter(a => typeof a === "string" && a.startsWith("--fresh-container-id="));
  const outputs = args.filter(a => typeof a === "string" && a.startsWith("--output="));
  if (ids.length !== 1 || outputs.length !== 1 || !/^[0-9a-f]{64}$/.test(ids[0].slice(21)) || !outputs[0].slice(9))
    throw new Error("USDT195_FRESH_CONTAINER_AND_OUTPUT_REQUIRED");
  return Object.freeze({ containerId: ids[0].slice(21), output: outputs[0].slice(9) });
}

/** Inspect the actual psql stream. Process status alone never means TAP passed. */
export function assertUsdt195Tap(stdout, exitCode, expectedCount) {
  if (![80, 388].includes(expectedCount) || exitCode !== 0 || typeof stdout !== "string" || !stdout.trim())
    throw new Error("USDT195_TAP_EXECUTION_REQUIRED");
  const rows = stdout.split(/\r?\n/).map(line => line.trim());
  if (rows.some(line => /^(?:not ok\b|Bail out!)/i.test(line) || /#\s*(?:SKIP|TODO)\b/i.test(line)))
    throw new Error("USDT195_TAP_FAILURE_OR_SKIP");
  const plans = rows.filter(line => /^1\.\./.test(line));
  const assertions = rows.filter(line => /^ok\b/.test(line));
  const records = rows.filter(line => /^1\.\./.test(line) || /^ok\b/.test(line));
  if (records.at(-1) !== "1.." + expectedCount) throw new Error("USDT195_TAP_TERMINAL_PLAN_REQUIRED");
  if (plans.length !== 1 || plans[0] !== "1.." + expectedCount || assertions.length !== expectedCount)
    throw new Error("USDT195_TAP_EXACT_PLAN_REQUIRED");
  for (let i = 0; i < assertions.length; i++) {
    const result = /^ok ([0-9]+)(?:\s+-\s*.*)?$/.exec(assertions[i]);
    if (!result || Number(result[1]) !== i + 1)
      throw new Error("USDT195_TAP_SEQUENCE_REQUIRED");
  }
  // Return only exact TAP rows; non-TAP SQL output and stderr are never published.
  return Object.freeze({ assertions: expectedCount, plan: plans[0], skipped: 0,
    tapSha256: hash(assertions.join("\n") + "\n" + plans[0] + "\n") });
}

export function assertUsdt195Concurrency(stdout, exitCode, scope, contract) {
  if (exitCode !== 0 || typeof stdout !== "string" ||
      !["LOCAL_QA", "CANONICAL_CI"].includes(scope))
    throw new Error("USDT195_CONCURRENCY_EXECUTION_REQUIRED");
  let report;
  try { report = JSON.parse(stdout); }
  catch { throw new Error("USDT195_CONCURRENCY_SINGLE_JSON_REQUIRED"); }
  const list = contract[scope === "LOCAL_QA" ? "local" : "canonical"];
  if (!keys(report, contract.requiredSuccessKeys) || report.status !== "PASS" ||
      report.fixture_origin !== contract.fixture_origin ||
      report.fixture_sha256 !== contract.fixture_sha256 ||
      report.cleanup_performed !== false || report.committed_synthetic_fixtures !== true ||
      !Array.isArray(report.assertions) || report.assertions.length !== list.length)
    throw new Error("USDT195_CONCURRENCY_EXACT_REPORT_REQUIRED");
  const run = /^esc-([0-9a-f]{16})-KRW_BANK-different_ACTUAL_ADVISORY_WAIT_OBSERVED$/
    .exec(report.assertions.find(row => typeof row?.name === "string" && row.name.includes("-KRW_BANK-different_"))?.name ?? "")?.[1];
  if (!run) throw new Error("USDT195_CONCURRENCY_SHARED_RUN_REQUIRED");
  const expected = list.map(name => name.replace("{run}", run));
  for (let i = 0; i < expected.length; i++) {
    if (!keys(report.assertions[i], ["name", "passed"]) ||
        report.assertions[i].name !== expected[i] || report.assertions[i].passed !== true)
      throw new Error("USDT195_CONCURRENCY_EXACT_ASSERTIONS_REQUIRED");
  }
  return Object.freeze({ assertions: expected.length, names: Object.freeze(expected),
    run, fixturePreludeSha256: report.fixture_sha256, skipped: 0 });
}
