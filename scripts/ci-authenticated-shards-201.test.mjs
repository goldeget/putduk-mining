import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import {
  inventoryFromReport,
  balanceInventory,
  assertSameInventory,
  testListFor,
} from "./ci-authenticated-shards-201.mjs";

const require = createRequire(import.meta.url);
const cwd = process.cwd();
const rootDir = path.join(cwd, "tests/e2e/authenticated");
const file = "mockup-reference-coverage.spec.ts";
const titles = [
  "captures every public authentication reference family with live controls",
  "captures every member reference family without fabricated balances or activity",
  "captures reconstructed mining at seven widths with genuine read-only controls",
  "captures reconstructed wallet at seven widths with real links and keyboard selection",
  ...["products", "menu", "ai"].map(
    (screen) =>
      `captures reconstructed ${screen} at seven widths and 200 percent Korean text`,
  ),
];
function report(specs, root = rootDir) {
  return {
    config: { rootDir: root },
    errors: [],
    suites: [{ title: file, specs, suites: [] }],
  };
}
function specs(project = "mobile-chrome", selected = titles) {
  return selected.map((title, index) => ({
    id: `${project}-${index}`,
    file,
    title,
    tests: [{ projectName: project, expectedStatus: "passed", results: [] }],
  }));
}
function inventory() {
  const data = report([...specs(), ...specs("chromium")]);
  for (let index = 0; index < 12; index++)
    data.suites[0].specs.push({
      id: `other-${index}`,
      file: `other-${index}.spec.ts`,
      title: "whole fixture",
      tests: [
        { projectName: "chromium", expectedStatus: "passed", results: [] },
      ],
    });
  return inventoryFromReport(data, cwd);
}

test("retains full test title paths for exact Playwright selection", () => {
  const data = report([]);
  data.suites[0].suites.push({
    title: "nested suite",
    specs: specs("mobile-chrome", ["exact test"]),
    suites: [],
  });
  assert.deepEqual(inventoryFromReport(data, cwd)[0].titlePath, [
    "nested suite",
    "exact test",
  ]);
});

test("splits only reviewed seven-test mockup projects, preserves every stable ID once", () => {
  const all = inventory();
  const shards = balanceInventory(all);
  assert.equal(shards.length, 12);
  assert.ok(shards.every((shard) => shard.tests.length));
  assertSameInventory(
    all,
    shards.flatMap((shard) => shard.tests),
  );
  const units = shards
    .flatMap((shard) => shard.groups)
    .filter((group) => group.file.endsWith(`/${file}`));
  assert.equal(units.length, 14);
  assert.ok(units.every((group) => group.titlePath.length === 1));
  assert.ok(
    new Set(
      shards
        .filter((shard) =>
          shard.groups.some((group) => group.file.endsWith(`/${file}`)),
        )
        .map((shard) => shard.index),
    ).size > 1,
  );
});

test("keeps other shared-fixture files whole and falls back for unreviewed mockup additions", () => {
  const all = inventory();
  for (const id of ["shared-1", "shared-2"])
    all.push({
      key: JSON.stringify(["chromium", id]),
      project: "chromium",
      file: "tests/e2e/authenticated/shared-fixture.spec.ts",
    });
  const extra = inventoryFromReport(
    report([
      {
        id: "new",
        file,
        title: "unreviewed extra",
        tests: [
          {
            projectName: "mobile-chrome",
            expectedStatus: "passed",
            results: [],
          },
        ],
      },
    ]),
    cwd,
  );
  const shards = balanceInventory([...all, ...extra]);
  const owners = shards.filter((shard) =>
    shard.tests.some(
      (item) =>
        item.project === "mobile-chrome" && item.file.endsWith(`/${file}`),
    ),
  );
  assert.equal(owners.length, 1);
  assert.equal(
    owners[0].tests.filter(
      (item) =>
        item.project === "mobile-chrome" && item.file.endsWith(`/${file}`),
    ).length,
    8,
  );
  assert.equal(
    shards.filter((shard) =>
      shard.tests.some((item) => item.file.endsWith("/shared-fixture.spec.ts")),
    ).length,
    1,
  );
  assertSameInventory(
    [...all, ...extra],
    shards.flatMap((shard) => shard.tests),
  );
});

test("assignment is deterministic under input order and rejects duplicate IDs", () => {
  const all = inventory();
  const projection = (items) =>
    balanceInventory(items).map((shard) => shard.groups);
  assert.deepEqual(projection(all), projection([...all].reverse()));
  assert.throws(() => balanceInventory([...all, all[0]]), /coverage mismatch/);
});

test("rejects ambiguous title-path delimiters instead of broadening selection", () => {
  const group = {
    project: "chromium",
    file: `tests/e2e/authenticated/${file}`,
    titlePath: ["bad > title"],
  };
  assert.throws(() => testListFor({ groups: [group] }, rootDir, cwd), /title/i);
});

test("rejects prefix-colliding selection paths", () => {
  const group = {
    project: "chromium",
    file: `tests/e2e/authenticated/${file}`,
  };
  assert.throws(
    () =>
      testListFor(
        {
          groups: [
            { ...group, titlePath: ["suite"] },
            { ...group, titlePath: ["suite", "test"] },
          ],
        },
        rootDir,
        cwd,
      ),
    /title|prefix/i,
  );
});

test("unreviewed describe nesting falls back before rendering any test-level list", () => {
  const all = inventory().map((item) =>
    item.project === "mobile-chrome" && item.file.endsWith(`/${file}`)
      ? { ...item, titlePath: ["unreviewed suite", ...(item.titlePath ?? [])] }
      : item,
  );
  const owners = balanceInventory(all).filter((shard) =>
    shard.tests.some(
      (item) =>
        item.project === "mobile-chrome" && item.file.endsWith(`/${file}`),
    ),
  );
  assert.equal(owners.length, 1);
  const group = owners[0].groups.find(
    (item) =>
      item.project === "mobile-chrome" && item.file.endsWith(`/${file}`),
  );
  assert.equal(group.titlePath, undefined);
});

test("pinned Playwright test-list selects one exact reviewed test, including loop-shared source locations", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "putduk-201-selection-"));
  try {
    const root = path.join(temporary, "tests/e2e/authenticated");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, file),
      `const { test } = require(${JSON.stringify(require.resolve("@playwright/test"))});\nfor (const title of ${JSON.stringify(titles)}) test(title, async () => {});\n`,
    );
    const config = path.join(temporary, "playwright.config.cjs");
    writeFileSync(
      config,
      `module.exports = { testDir: ${JSON.stringify(root)}, projects: [{name:"chromium"},{name:"mobile-chrome"}] };\n`,
    );
    const cli = path.join(
      path.dirname(require.resolve("playwright/package.json")),
      "cli.js",
    );
    const collect = (extra = []) => {
      const result = spawnSync(
        process.execPath,
        [
          "--max-old-space-size=128",
          cli,
          "test",
          "--config",
          config,
          "--list",
          "--reporter=json",
          ...extra,
        ],
        {
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          env: process.env,
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      return inventoryFromReport(JSON.parse(result.stdout), temporary);
    };
    const all = collect();
    const wanted = all.find(
      (item) =>
        item.project === "mobile-chrome" && item.titlePath?.[0] === titles[6],
    );
    assert.ok(wanted);
    const list = path.join(temporary, "selected.txt");
    writeFileSync(
      list,
      testListFor(
        {
          groups: [
            {
              project: wanted.project,
              file: wanted.file,
              titlePath: wanted.titlePath,
            },
          ],
        },
        root,
        temporary,
      ),
    );
    assertSameInventory([wanted], collect(["--test-list", list]));
    const groups = balanceInventory(all).flatMap((shard) => shard.groups);
    writeFileSync(list, testListFor({ groups }, root, temporary));
    assertSameInventory(all, collect(["--test-list", list]));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
