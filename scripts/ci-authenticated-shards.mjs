import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Scheduling hints only, NOT timeouts, product policy, or acceptance thresholds.
// Admin hints are rounded project/file elapsed times from CI 37441515296,
// job 112197234692. Reuse for mobile is an estimate. Unknown/new files are
// always discovered and included; they get a per-test estimate, never omitted.
const TIMING_HINTS = {
  "admin-assistant-read-draft.spec.ts": 12,
  "admin-economy-policy.spec.ts": 32,
  "admin-exceptions-product.spec.ts": 119,
  "admin-exceptions-recon-ack.spec.ts": 60,
  "admin-krw-browser-money.spec.ts": 124,
  "admin-kyc-product.spec.ts": 105,
  "admin-members-product.spec.ts": 14,
  "admin-restrictions-safe-mode.spec.ts": 10,
  "admin-session-totp.spec.ts": 6,
  "admin-today.spec.ts": 2,
  "admin-usdt-browser-money.spec.ts": 116,
  "admin-withdrawal-step-up.spec.ts": 121,
  // Conservative hint from the existing authenticated config's recovery note.
  "withdrawal-p1-recovery.spec.ts": 480,
};
const CONFIG = "playwright.authenticated.config.ts";
const TOTAL = 8;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function inventoryFromReport(report, cwd = process.cwd()) {
  if (!report || !Array.isArray(report.suites) || report.errors?.length) {
    throw new Error("Invalid Playwright inventory or collection errors");
  }
  const root = report.config?.rootDir;
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error("Missing absolute Playwright rootDir");
  }
  const inventory = [];
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const project = test.projectName;
          const file = path.relative(cwd, path.resolve(root, spec.file)).split(path.sep).join("/");
          if (!/^[a-zA-Z0-9_-]+$/.test(project ?? "") ||
              !/^tests\/e2e\/authenticated\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.spec\.ts$/.test(file) ||
              typeof spec.id !== "string" || !spec.id) {
            throw new Error("Unsafe or unsupported authenticated test identity");
          }
          inventory.push({
            key: JSON.stringify([project, spec.id]),
            project,
            file,
            expectedStatus: test.expectedStatus,
            status: test.status,
            results: (test.results ?? []).map((result) => ({
              status: result.status,
              duration: result.duration,
              retry: result.retry,
            })),
          });
        }
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  if (!inventory.length || new Set(inventory.map((test) => test.key)).size !== inventory.length) {
    throw new Error("Empty or duplicate authenticated test inventory");
  }
  return inventory.sort((a, b) => compare(a.key, b.key));
}

export function assertSameInventory(expected, actual) {
  const identity = (test) => JSON.stringify([test.key, test.project, test.file]);
  const left = expected.map(identity).sort(compare);
  const right = actual.map(identity).sort(compare);
  if (new Set(left).size !== left.length || new Set(right).size !== right.length ||
      left.length !== right.length || left.some((key, index) => key !== right[index])) {
    throw new Error("Authenticated test coverage mismatch: missing, duplicate, or unexpected tests");
  }
}

export function balanceInventory(inventory, total = TOTAL) {
  if (!Number.isInteger(total) || total < 1 || total > TOTAL || !inventory.length) {
    throw new Error("Invalid authenticated shard plan");
  }
  assertSameInventory(inventory, inventory);
  const groups = new Map();
  for (const test of inventory) {
    const key = JSON.stringify([test.project, test.file]);
    const group = groups.get(key) ?? { key, project: test.project, file: test.file, tests: [] };
    group.tests.push(test);
    groups.set(key, group);
  }
  const weighted = [...groups.values()].map((group) => ({
    ...group,
    estimateSeconds: TIMING_HINTS[path.basename(group.file)] ?? group.tests.length * 20,
  }));
  weighted.sort((a, b) => b.estimateSeconds - a.estimateSeconds || compare(a.key, b.key));
  const shards = Array.from({ length: total }, (_, index) => ({
    index: index + 1,
    estimateSeconds: 0,
    groups: [],
    tests: [],
  }));
  for (const group of weighted) {
    const target = [...shards].sort((a, b) => a.estimateSeconds - b.estimateSeconds || a.index - b.index)[0];
    target.estimateSeconds += group.estimateSeconds;
    target.groups.push({ project: group.project, file: group.file });
    target.tests.push(...group.tests);
  }
  if (shards.some((shard) => !shard.tests.length)) {
    throw new Error("Authenticated shard is empty");
  }
  assertSameInventory(inventory, shards.flatMap((shard) => shard.tests));
  return shards;
}

export function testListFor(shard) {
  return shard.groups.map(({ project, file }) => `[${project}] > ${file}`).join("\n") + "\n";
}

async function main() {
  const choice = process.argv[2];
  if (process.argv.length !== 3 || (choice !== "--verify-only" && !/^[1-8]\/8$/.test(choice ?? ""))) {
    throw new Error("Usage: node scripts/ci-authenticated-shards.mjs --verify-only | 1/8 ... 8/8");
  }
  const origin = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  if (!/^https:\/\/github\.com\/goldeget\/putduk-mining(?:\.git)?$/.test(origin) ||
      (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== "goldeget/putduk-mining")) {
    throw new Error("BLOCKED_TARGET_SCOPE");
  }
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const temporary = mkdtempSync(path.join(tmpdir(), "putduk-ci-shards-"));
  const evidence = path.resolve("ci-shard-evidence");
  mkdirSync(evidence, { recursive: true });
  let active;
  let interrupted = false;
  const stop = (signal) => {
    interrupted = true;
    active?.kill(signal);
    process.exitCode = 1;
  };
  const onTerm = () => stop("SIGTERM");
  const onInt = () => stop("SIGINT");
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  const execute = (args, output, listing) => new Promise((resolve, reject) => {
    if (interrupted) return reject(new Error("Authenticated shard interrupted"));
    active = spawn("pnpm", ["exec", "playwright", "test", "--config", CONFIG, ...args], {
      stdio: "inherit",
      env: { ...process.env, E2E_WITH_ADMIN_SERVER: "1", PLAYWRIGHT_JSON_OUTPUT_FILE: output },
      ...(listing ? { timeout: 45_000 } : {}),
    });
    active.once("error", () => reject(new Error("Could not start locked Playwright")));
    active.once("close", (code, signal) => {
      active = undefined;
      if (code !== 0 || signal || interrupted) reject(new Error("Authenticated Playwright failed or was interrupted"));
      else resolve();
    });
  });
  const collect = async (name, args = []) => {
    const output = path.join(temporary, `${name}.json`);
    await execute([...args, "--list", "--reporter=json"], output, true);
    return inventoryFromReport(JSON.parse(readFileSync(output, "utf8")));
  };
  try {
    const inventory = await collect("all");
    const shards = balanceInventory(inventory);
    const plan = {
      sourceSha: sha,
      config: CONFIG,
      totalTests: inventory.length,
      schedulingOnly: true,
      shards,
    };
    writeFileSync(path.join(evidence, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
    const selected = choice === "--verify-only" ? shards : [shards[Number(choice[0]) - 1]];
    const checked = [];
    for (const shard of selected) {
      const list = path.join(temporary, `shard-${shard.index}.txt`);
      writeFileSync(list, testListFor(shard));
      const actual = await collect(`selected-${shard.index}`, ["--test-list", list]);
      assertSameInventory(shard.tests, actual);
      checked.push(...actual);
      if (choice !== "--verify-only") {
        const output = path.join(temporary, "executed.json");
        await execute(["--test-list", list, "--fail-on-flaky-tests", "--reporter=line,json"], output, false);
        const report = JSON.parse(readFileSync(output, "utf8"));
        const executed = inventoryFromReport(report);
        assertSameInventory(shard.tests, executed);
        if (executed.some((test) => !test.results.length) || report.stats?.unexpected || report.stats?.flaky) {
          throw new Error("Incomplete or unsuccessful authenticated execution evidence");
        }
        // No raw report config, credentials, stdout, or error bodies in this evidence.
        writeFileSync(path.join(evidence, "execution.json"), JSON.stringify({ sourceSha: sha, shard: shard.index, tests: executed }, null, 2) + "\n");
      }
    }
    if (choice === "--verify-only") assertSameInventory(inventory, checked);
    writeFileSync(path.join(evidence, "coverage.json"), JSON.stringify({ sourceSha: sha, mode: choice, totalTests: inventory.length, checkedTests: checked.length, exactCoverage: true }, null, 2) + "\n");
    console.log(`Authenticated coverage verified: ${checked.length}/${inventory.length} tests (${choice}).`);
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
