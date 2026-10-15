import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";
import { assertBackend201BrowserCanonicalSources } from "./backend-successor-201-browser-source.mjs";

// Scheduling hints only, NOT timeouts, product policy, or acceptance thresholds.
// Rounded-up per-file observed project peaks from CI 38467268179 (R7).
// Failed/partial observations and unstarted sibling projects are estimates only;
// these hints do not establish a green runtime or the whole-run 20-minute gate.
// Files with no R7 observation retain the existing per-test fallback estimate.
// Unknown/new files are always discovered and included, never omitted.
// R10 allocation split units have no completed timing observation yet. Reserve
// their unchanged 360-second test ceiling for placement only, including repeated
// real AAL2/publication setup; stage telemetry must replace these estimates.
// This does not change any deadline or establish the whole-run 20-minute gate.
const TIMING_HINTS = {
  "admin-assistant-context.spec.ts": 10,
  "admin-assistant-read-draft.spec.ts": 23,
  "admin-economy-policy.spec.ts": 31,
  "admin-exceptions-product.spec.ts": 142,
  "admin-exceptions-recon-ack.spec.ts": 59,
  "admin-krw-browser-money.spec.ts": 120,
  "admin-kyc-product.spec.ts": 100,
  "admin-members-product.spec.ts": 38,
  "admin-restrictions-safe-mode.spec.ts": 32,
  "admin-session-totp.spec.ts": 10,
  "admin-today.spec.ts": 3,
  "admin-usdt-browser-money.spec.ts": 120,
  "admin-v7-operator-ux.spec.ts": 18,
  "admin-withdrawal-step-up.spec.ts": 124,
  "admin-withdrawals-product.spec.ts": 24,
  "ai-context-help.spec.ts": 16,
  "ai-product.spec.ts": 26,
  "catalog-allocation.spec.ts": 360,
  "catalog-allocated-home-dark.spec.ts": 360,
  "catalog-allocated-home-light.spec.ts": 360,
  "catalog-allocated-wallet-dark.spec.ts": 360,
  "catalog-allocated-wallet-light.spec.ts": 360,
  "catalog-materials.spec.ts": 204,
  "deposit-product.spec.ts": 57,
  "events-product.spec.ts": 23,
  "first-krw-withdrawal.spec.ts": 14,
  "first-usdt-withdrawal.spec.ts": 13,
  "funded-home-typography.spec.ts": 117,
  "home-catalog-materials.spec.ts": 389,
  "home-start-product.spec.ts": 190,
  "home-typography.spec.ts": 125,
  "member-product-scene.spec.ts": 25,
  "menu-product.spec.ts": 47,
  "mining-product.spec.ts": 16,
  "mockup-reference-coverage.spec.ts": 359,
  "notifications-product.spec.ts": 24,
  "operator-fixture-isolation.spec.ts": 2,
  "principal-withdrawal-product.spec.ts": 446,
  "products-catalog.spec.ts": 9,
  "public-admin-boundary.spec.ts": 1,
  "signup-reconstruction.spec.ts": 4,
  "start-onboarding-eligibility.spec.ts": 17,
  "success-visual-evidence.spec.ts": 20,
  "support-channel-talk.spec.ts": 6,
  "usdt-manual-full-payout-195.spec.ts": 5,
  "usdt-manual-full-payout-197.spec.ts": 5,
  "wallet-product.spec.ts": 14,
  "welcome-withdrawal-error-copy.spec.ts": 18,
  "withdrawal-destination-reauth.spec.ts": 122,
  "withdrawal-hydration.spec.ts": 14,
  "withdrawal-logical-idempotency.spec.ts": 25,
  "withdrawal-negative-guards.spec.ts": 92,
  "withdrawal-p1-recovery.spec.ts": 272,
  "withdrawal-product.spec.ts": 47,
};
const CONFIG = "playwright.backend-browser-201.config.ts";
const TOTAL = 12;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Only this reviewed file has independent per-test pages, members and outputs.
// Reservations are unchanged test ceilings, NOT observed durations/deadlines.
const MOCKUP_FILE = "tests/e2e/authenticated/mockup-reference-coverage.spec.ts";
const MOCKUP_RESERVATIONS = new Map([
  [
    "captures every public authentication reference family with live controls",
    240,
  ],
  [
    "captures every member reference family without fabricated balances or activity",
    360,
  ],
  [
    "captures reconstructed mining at seven widths with genuine read-only controls",
    240,
  ],
  [
    "captures reconstructed wallet at seven widths with real links and keyboard selection",
    240,
  ],
  ...["products", "menu", "ai"].map((screen) => [
    `captures reconstructed ${screen} at seven widths and 200 percent Korean text`,
    240,
  ]),
]);

export function inventoryFromReport(report, cwd = process.cwd()) {
  if (!report || !Array.isArray(report.suites) || report.errors?.length) {
    throw new Error("Invalid Playwright inventory or collection errors");
  }
  const root = report.config?.rootDir;
  if (typeof root !== "string" || !path.isAbsolute(root)) {
    throw new Error("Missing absolute Playwright rootDir");
  }
  const inventory = [];
  function visit(suites, parents = [], fileLevel = true) {
    for (const suite of suites) {
      const titles = fileLevel ? [] : [...parents, suite.title];
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const project = test.projectName;
          const file = path
            .relative(cwd, path.resolve(root, spec.file))
            .split(path.sep)
            .join("/");
          if (
            !/^[a-zA-Z0-9_-]+$/.test(project ?? "") ||
            !/^tests\/e2e\/authenticated\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.spec\.ts$/.test(
              file,
            ) ||
            typeof spec.id !== "string" ||
            !spec.id
          ) {
            throw new Error(
              "Unsafe or unsupported authenticated test identity",
            );
          }
          inventory.push({
            key: JSON.stringify([project, spec.id]),
            project,
            file,
            ...(typeof spec.title === "string"
              ? { titlePath: [...titles, spec.title] }
              : {}),
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
      visit(suite.suites ?? [], titles, false);
    }
  }
  visit(report.suites);
  if (
    !inventory.length ||
    new Set(inventory.map((test) => test.key)).size !== inventory.length
  ) {
    throw new Error("Empty or duplicate authenticated test inventory");
  }
  return inventory.sort((a, b) => compare(a.key, b.key));
}

export function assertSameInventory(expected, actual) {
  const identity = (test) =>
    JSON.stringify([test.key, test.project, test.file]);
  const left = expected.map(identity).sort(compare);
  const right = actual.map(identity).sort(compare);
  if (
    new Set(left).size !== left.length ||
    new Set(right).size !== right.length ||
    left.length !== right.length ||
    left.some((key, index) => key !== right[index])
  ) {
    throw new Error(
      "Authenticated test coverage mismatch: missing, duplicate, or unexpected tests",
    );
  }
}

export function assertAuthenticatedExecution(
  report,
  expected,
  cwd = process.cwd(),
) {
  const executed = inventoryFromReport(report, cwd);
  assertSameInventory(expected, executed);
  const durationIsValid = (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (
    report.config?.configFile !== path.resolve(cwd, CONFIG) ||
    report.config?.rootDir !== path.resolve(cwd, "tests/e2e/authenticated") ||
    !Array.isArray(report.errors) ||
    report.errors.length !== 0 ||
    report.stats?.expected !== expected.length ||
    report.stats?.unexpected !== 0 ||
    report.stats?.flaky !== 0 ||
    report.stats?.skipped !== 0 ||
    !durationIsValid(report.stats?.duration) ||
    executed.some(
      (test) =>
        test.expectedStatus !== "passed" ||
        test.status !== "expected" ||
        test.results.length !== 1 ||
        test.results[0].status !== "passed" ||
        test.results[0].retry !== 0 ||
        !durationIsValid(test.results[0].duration),
    )
  ) {
    throw new Error(
      "Incomplete or unsuccessful authenticated execution evidence",
    );
  }
  return executed;
}

export function balanceInventory(inventory, total = TOTAL) {
  if (
    !Number.isInteger(total) ||
    total < 1 ||
    total > TOTAL ||
    !inventory.length
  ) {
    throw new Error("Invalid authenticated shard plan");
  }
  assertSameInventory(inventory, inventory);
  const groups = new Map();
  for (const test of inventory) {
    const key = JSON.stringify([test.project, test.file]);
    const group = groups.get(key) ?? {
      key,
      project: test.project,
      file: test.file,
      tests: [],
    };
    group.tests.push(test);
    groups.set(key, group);
  }
  const units = [...groups.values()].flatMap((group) => {
    const reviewed =
      group.file === MOCKUP_FILE &&
      ["chromium", "mobile-chrome"].includes(group.project) &&
      group.tests.length === MOCKUP_RESERVATIONS.size &&
      group.tests.every(
        (test) =>
          test.titlePath?.length === 1 &&
          MOCKUP_RESERVATIONS.has(test.titlePath[0]),
      ) &&
      new Set(group.tests.map((test) => test.titlePath[0])).size ===
        MOCKUP_RESERVATIONS.size;
    // New titles, nesting or roster drift retain the whole fixture boundary.
    if (!reviewed) return [group];
    return group.tests.map((test) => ({
      ...group,
      key: JSON.stringify([group.project, group.file, test.key]),
      tests: [test],
      titlePath: test.titlePath,
      reservation: MOCKUP_RESERVATIONS.get(test.titlePath[0]),
    }));
  });
  const weighted = units.map((group) => ({
    ...group,
    estimateSeconds:
      group.reservation ??
      TIMING_HINTS[path.basename(group.file)] ??
      group.tests.length * 20,
  }));
  weighted.sort(
    (a, b) => b.estimateSeconds - a.estimateSeconds || compare(a.key, b.key),
  );
  const shards = Array.from({ length: total }, (_, index) => ({
    index: index + 1,
    estimateSeconds: 0,
    groups: [],
    tests: [],
  }));
  for (const group of weighted) {
    const target = [...shards].sort(
      (a, b) => a.estimateSeconds - b.estimateSeconds || a.index - b.index,
    )[0];
    target.estimateSeconds += group.estimateSeconds;
    target.groups.push({
      project: group.project,
      file: group.file,
      ...(group.titlePath ? { titlePath: group.titlePath } : {}),
    });
    target.tests.push(...group.tests);
  }
  if (shards.some((shard) => !shard.tests.length)) {
    throw new Error("Authenticated shard is empty");
  }
  assertSameInventory(
    inventory,
    shards.flatMap((shard) => shard.tests),
  );
  return shards;
}

export function testListFor(shard, rootDir, cwd = process.cwd()) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
    throw new Error("Missing absolute test-list rootDir");
  }
  for (const group of shard.groups) {
    if (
      group.titlePath !== undefined &&
      (!Array.isArray(group.titlePath) ||
        !group.titlePath.length ||
        group.titlePath.some(
          (title) =>
            typeof title !== "string" ||
            !title ||
            title.trim() !== title ||
            /[>›\r\n]/u.test(title),
        ))
    ) {
      throw new Error("Unsafe authenticated test title path");
    }
    for (const other of shard.groups) {
      if (
        group === other ||
        group.project !== other.project ||
        group.file !== other.file
      )
        continue;
      const left = group.titlePath ?? [];
      const right = other.titlePath ?? [];
      if (
        left.length <= right.length &&
        left.every((title, index) => title === right[index])
      ) {
        throw new Error("Authenticated test title prefix collision");
      }
    }
  }
  return (
    shard.groups
      .map(({ project, file, titlePath }) => {
        // Playwright compares against config.rootDir, not cwd or list location.
        const relative = path
          .relative(rootDir, path.resolve(cwd, file))
          .split(path.sep)
          .join("/");
        if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.spec\.ts$/.test(relative)) {
          throw new Error("Test-list entry is outside the collected rootDir");
        }
        return `[${project}] > ${relative}${titlePath ? ` > ${titlePath.join(" > ")}` : ""}`;
      })
      .join("\n") + "\n"
  );
}

export function parseAuthenticatedShardChoice(choice) {
  if (choice === "--verify-only") return null;
  if (typeof choice !== "string" || !/^(?:[1-9]|1[0-2])\/12$/.test(choice)) {
    throw new Error(
      "Usage: node scripts/ci-authenticated-shards-201.mjs --verify-only | 1/12 ... 12/12",
    );
  }
  return Number(choice.split("/")[0]) - 1;
}

async function main() {
  const choice = process.argv[2];
  if (process.argv.length !== 3) {
    throw new Error(
      "Usage: node scripts/ci-authenticated-shards-201.mjs --verify-only | 1/12 ... 12/12",
    );
  }
  const selectedIndex = parseAuthenticatedShardChoice(choice);
  // Reject an unreviewed source/context before creating evidence or spawning tests.
  const sourceBoundary = assertBackend201BrowserCanonicalSources();
  const source = { ...collectCiSourceEvidence(), sourceBoundary };
  const temporary = mkdtempSync(path.join(tmpdir(), "putduk-ci-shards-"));
  // Playwright clears its test-results output directory before execution.
  // line/json reporters do not clear this separately ignored evidence path.
  const evidence = path.resolve("playwright-report/ci-shard-evidence");
  mkdirSync(evidence, { recursive: true });
  // A list-only run or failed execution must never inherit an earlier pass.
  for (const name of ["plan", "coverage", "execution"]) {
    rmSync(path.join(evidence, `${name}.json`), { force: true });
  }
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
  const execute = (args, output, listing) =>
    new Promise((resolve, reject) => {
      if (interrupted)
        return reject(new Error("Authenticated shard interrupted"));
      active = spawn(
        "pnpm",
        ["exec", "playwright", "test", "--config", CONFIG, ...args],
        {
          stdio: listing ? ["ignore", "ignore", "inherit"] : "inherit",
          env: {
            ...process.env,
            E2E_WITH_ADMIN_SERVER: "1",
            PUTDUK_BACKEND_SOURCE_REVISION: "201",
            PLAYWRIGHT_JSON_OUTPUT_FILE: output,
          },
          ...(listing ? { timeout: 45_000 } : {}),
        },
      );
      active.once("error", () =>
        reject(new Error("Could not start locked Playwright")),
      );
      active.once("close", (code, signal) => {
        active = undefined;
        if (code !== 0 || signal || interrupted)
          reject(
            new Error("Authenticated Playwright failed or was interrupted"),
          );
        else resolve();
      });
    });
  let collectionRoot;
  const collect = async (name, args = []) => {
    const output = path.join(temporary, `${name}.json`);
    await execute([...args, "--list", "--reporter=json"], output, true);
    const report = JSON.parse(readFileSync(output, "utf8"));
    const inventory = inventoryFromReport(report);
    if (collectionRoot && collectionRoot !== report.config.rootDir) {
      throw new Error(
        "Playwright rootDir changed during coverage verification",
      );
    }
    collectionRoot = report.config.rootDir;
    return inventory;
  };
  try {
    const inventory = await collect("all");
    const shards = balanceInventory(inventory);
    const plan = {
      ...source,
      config: CONFIG,
      totalTests: inventory.length,
      schedulingOnly: true,
      shards,
    };
    writeFileSync(
      path.join(evidence, "plan.json"),
      JSON.stringify(plan, null, 2) + "\n",
    );
    const selected = selectedIndex === null ? shards : [shards[selectedIndex]];
    const checked = [];
    for (const shard of selected) {
      const list = path.join(temporary, `shard-${shard.index}.txt`);
      writeFileSync(list, testListFor(shard, collectionRoot));
      const actual = await collect(`selected-${shard.index}`, [
        "--test-list",
        list,
      ]);
      assertSameInventory(shard.tests, actual);
      checked.push(...actual);
      if (choice !== "--verify-only") {
        const output = path.join(temporary, "executed.json");
        await execute(
          [
            "--test-list",
            list,
            "--fail-on-flaky-tests",
            "--reporter=line,json",
          ],
          output,
          false,
        );
        const report = JSON.parse(readFileSync(output, "utf8"));
        const executed = assertAuthenticatedExecution(report, shard.tests);
        // No raw report config, credentials, stdout, or error bodies in this evidence.
        writeFileSync(
          path.join(evidence, "execution.json"),
          JSON.stringify(
            { ...source, shard: shard.index, tests: executed },
            null,
            2,
          ) + "\n",
        );
      }
    }
    if (choice === "--verify-only") assertSameInventory(inventory, checked);
    writeFileSync(
      path.join(evidence, "coverage.json"),
      JSON.stringify(
        {
          ...source,
          mode: choice,
          totalTests: inventory.length,
          checkedTests: checked.length,
          exactCoverage: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `Authenticated coverage verified: ${checked.length}/${inventory.length} tests (${choice}).`,
    );
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
