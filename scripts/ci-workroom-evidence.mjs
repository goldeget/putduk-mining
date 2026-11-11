/** Run-bound receipts for successor jobs. A receipt is never a substitute for raw reports. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

export function assertVitestReport(report) {
  const optionalExternal = new Map([
    [
      "ai-local-free-smoke.test.ts",
      "real NVIDIA response has durable admission, actual usage and owned transcript",
    ],
    [
      "ai-local-openrouter-smoke.test.ts",
      "verified OpenRouter free fallback has actual response, independent count and durable owner transcript",
    ],
    [
      "ai-local-owned-tools.test.ts",
      "actual Local owner tools read quota/cancellation and close unknown economic facts",
    ],
    [
      "ai-local-plain-korean-quality.test.ts",
      "one actual NVIDIA sample checks strengthened plain Korean instructions",
    ],
  ]);
  if (
    !report.success ||
    !report.numTotalTests ||
    report.numFailedTests ||
    report.numTodoTests ||
    !report.testResults?.length
  )
    throw Error("WORKROOM_UNIT_NOT_COMPLETE");
  let passed = 0,
    skipped = 0;
  for (const file of report.testResults) {
    if (
      !["passed", "skipped"].includes(file.status) ||
      !file.assertionResults?.length
    )
      throw Error("WORKROOM_UNIT_FILE_NOT_COMPLETE");
    for (const test of file.assertionResults) {
      if (test.status === "passed") passed++;
      else if (
        ["skipped", "pending"].includes(test.status) &&
        optionalExternal.get(
          file.name.replaceAll("\\", "/").split("/").at(-1),
        ) === test.fullName
      )
        skipped++;
      else throw Error("WORKROOM_UNIT_ASSERTION_NOT_COMPLETE");
    }
  }
  if (
    passed !== report.numPassedTests ||
    passed + skipped !== report.numTotalTests ||
    skipped !== (report.numPendingTests ?? 0)
  )
    throw Error("WORKROOM_UNIT_ASSERTION_COUNTS");
}

// One reviewed filename per expected case; a multi-case file repeats in this inventory.
export function assertPlaywrightReport(report, expectedFiles = []) {
  if (
    report.errors?.length ||
    !report.stats?.expected ||
    report.stats.unexpected ||
    report.stats.flaky ||
    report.stats.skipped
  )
    throw Error("WORKROOM_BROWSER_NOT_COMPLETE");
  let count = 0;
  const files = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? []) {
        count++;
        files.push(spec.file ?? suite.file);
        if (
          test.status !== "expected" ||
          test.results?.length !== 1 ||
          test.results[0].status !== "passed" ||
          test.results[0].retry !== 0
        )
          throw Error("WORKROOM_BROWSER_RESULT_NOT_COMPLETE");
      }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  if (count !== report.stats.expected)
    throw Error("WORKROOM_BROWSER_INVENTORY_MISMATCH");
  if (
    expectedFiles.length &&
    JSON.stringify(
      files.map((file) => file?.replaceAll("\\", "/").split("/").at(-1)).sort(),
    ) !== JSON.stringify([...expectedFiles].sort())
  )
    throw Error("WORKROOM_BROWSER_FILE_ASSIGNMENT");
}

export function makeReceipt({
  gate,
  startedAt,
  files,
  env = process.env,
  now = Date.now(),
}) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const expected = env.CI_HEAD_SHA ?? head;
  if (head !== expected || !/^[a-f0-9]{40}$/.test(head))
    throw Error("WORKROOM_EVIDENCE_HEAD");
  if (
    !Number.isSafeInteger(startedAt) ||
    startedAt > now ||
    startedAt <= 0 ||
    !files.length
  )
    throw Error("WORKROOM_EVIDENCE_START");
  if (
    env.GITHUB_ACTIONS === "true" &&
    (env.GITHUB_REPOSITORY !== "goldeget/putduk-mining" ||
      !/^\d+$/.test(env.GITHUB_RUN_ID ?? "") ||
      !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? ""))
  )
    throw Error("WORKROOM_EVIDENCE_RUN");
  const artifacts = files.map((path) => {
    const bytes = readFileSync(path);
    if (!bytes.length || statSync(path).mtimeMs < startedAt)
      throw Error("WORKROOM_EVIDENCE_STALE:" + path);
    return {
      path,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  const manifestSha256 = createHash("sha256")
    .update(readFileSync("docs/quality/WORKROOM-SOURCE-MANIFEST.json"))
    .digest("hex");
  return {
    version: 1,
    gate,
    head,
    manifestSha256,
    runId: env.GITHUB_RUN_ID ?? "LOCAL",
    attempt: env.GITHUB_RUN_ATTEMPT ?? "LOCAL",
    startedAt,
    completedAt: now,
    artifacts,
  };
}

export function verifyReceipt(receipt, env = process.env) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (
    receipt.version !== 1 ||
    receipt.head !== head ||
    receipt.head !== (env.CI_HEAD_SHA ?? head) ||
    receipt.runId !== (env.GITHUB_RUN_ID ?? "LOCAL") ||
    receipt.attempt !== (env.GITHUB_RUN_ATTEMPT ?? "LOCAL") ||
    receipt.manifestSha256 !==
      createHash("sha256")
        .update(readFileSync("docs/quality/WORKROOM-SOURCE-MANIFEST.json"))
        .digest("hex") ||
    !receipt.artifacts?.length
  )
    throw Error("WORKROOM_ARTIFACT_IDENTITY");
  for (const entry of receipt.artifacts) {
    const bytes = readFileSync(entry.path);
    if (
      entry.bytes !== bytes.length ||
      entry.sha256 !== createHash("sha256").update(bytes).digest("hex")
    )
      throw Error("WORKROOM_ARTIFACT_CONTENT");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [gate, started, output, ...files] = process.argv.slice(2);
  const receipt = makeReceipt({ gate, startedAt: Number(started), files });
  for (const path of files) {
    if (path.endsWith("vitest.json"))
      assertVitestReport(JSON.parse(readFileSync(path, "utf8")));
    if (path.endsWith("playwright.json"))
      assertPlaywrightReport(JSON.parse(readFileSync(path, "utf8")));
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
}
