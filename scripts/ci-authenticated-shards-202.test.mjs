import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  assertSameInventory,
  parseAuthenticatedShardChoice,
  balanceInventory,
  inventoryFromReport,
  testListFor,
} from "./ci-authenticated-shards-202.mjs";

const cwd = path.resolve("/putduk-fixture");
const rootDir = path.join(cwd, "tests/e2e/authenticated");
function report(specs) {
  return { config: { rootDir }, errors: [], suites: [{ specs, suites: [] }] };
}
function spec(id, file = "member.spec.ts", projectName = "chromium") {
  return {
    id,
    file,
    tests: [{ projectName, expectedStatus: "passed", results: [] }],
  };
}
function fixture(count = 24) {
  return inventoryFromReport(
    report(
      Array.from({ length: count }, (_, index) =>
        spec(
          `test-${index}`,
          `file-${Math.floor(index / 2)}.spec.ts`,
          index % 2 ? "mobile-chrome" : "chromium",
        ),
      ),
    ),
    cwd,
  );
}

test("discovers nested suites and preserves every project/test", () => {
  const data = report([spec("one")]);
  data.suites[0].suites.push({
    specs: [spec("two", "nested/member.spec.ts", "mobile-chrome")],
  });
  assert.equal(inventoryFromReport(data, cwd).length, 2);
});
test("never exports raw errors, config credentials or stdout in test records", () => {
  const data = report([spec("one")]);
  data.config.secret = "do-not-copy";
  data.suites[0].specs[0].tests[0].results = [
    { status: "passed", duration: 4, retry: 0, stdout: ["do-not-copy"] },
  ];
  assert.ok(
    !JSON.stringify(inventoryFromReport(data, cwd)).includes("do-not-copy"),
  );
});
for (const data of [
  report([]),
  { suites: [], errors: [{}] },
  { suites: [] },
  report([spec("one", "../../outside.spec.ts")]),
  report([spec("one", "member.spec.ts", "bad\nproject")]),
  report([spec("one"), spec("one")]),
]) {
  test(`rejects invalid collection ${JSON.stringify(data).slice(0, 75)}`, () => {
    assert.throws(() => inventoryFromReport(data, cwd));
  });
}
test("all twelve shards form the exact original inventory", () => {
  const all = fixture();
  const shards = balanceInventory(all);
  assert.equal(shards.length, 12);
  assertSameInventory(
    all,
    shards.flatMap((shard) => shard.tests),
  );
  assert.ok(shards.every((shard) => shard.tests.length));
});
test("a whole file/project remains together, including newly discovered tests", () => {
  const all = [
    ...fixture(),
    ...inventoryFromReport(
      report([spec("new-1", "new.spec.ts"), spec("new-2", "new.spec.ts")]),
      cwd,
    ),
  ];
  const shards = balanceInventory(all);
  const owners = shards.filter((shard) =>
    shard.tests.some((item) => item.file.endsWith("/new.spec.ts")),
  );
  assert.equal(owners.length, 1);
  assert.equal(
    owners[0].tests.filter((item) => item.file.endsWith("/new.spec.ts")).length,
    2,
  );
});
test("assignment is deterministic regardless of input ordering", () => {
  const projection = (items) =>
    balanceInventory(items).map((shard) => shard.groups);
  assert.deepEqual(projection(fixture()), projection(fixture().reverse()));
});
test("long admin files are not all assigned to the first shard", () => {
  const files = [
    "admin-krw-browser-money.spec.ts",
    "admin-usdt-browser-money.spec.ts",
    "admin-withdrawal-step-up.spec.ts",
    "admin-exceptions-product.spec.ts",
  ];
  const all = [
    ...fixture(),
    ...inventoryFromReport(
      report(files.map((file, index) => spec(`heavy-${index}`, file))),
      cwd,
    ),
  ];
  const shards = balanceInventory(all);
  const owners = shards.filter((shard) =>
    shard.groups.some((group) => files.includes(path.basename(group.file))),
  );
  assert.ok(owners.length >= 4);
});
for (const bad of [0, -1, 13, 1.2, NaN]) {
  test(`rejects invalid shard total ${bad}`, () =>
    assert.throws(() => balanceInventory(fixture(), bad)));
}
test("empty shard cannot be accepted as successful coverage", () => {
  assert.throws(() =>
    balanceInventory(inventoryFromReport(report([spec("one")]), cwd)),
  );
});
for (const variant of [
  "missing",
  "duplicate",
  "unexpected",
  "wrong-file",
  "wrong-project",
]) {
  test(`coverage rejects ${variant}`, () => {
    const all = fixture();
    const actual = all.map((item) => ({ ...item }));
    if (variant === "missing") actual.pop();
    if (variant === "duplicate") actual.push(actual[0]);
    if (variant === "unexpected") actual[0].key = "unexpected";
    if (variant === "wrong-file")
      actual[0].file = "tests/e2e/authenticated/wrong.spec.ts";
    if (variant === "wrong-project") actual[0].project = "wrong";
    assert.throws(() => assertSameInventory(all, actual));
  });
}
test("test-list selects complete files with explicit projects, not grep", () => {
  const shard = balanceInventory(fixture())[0];
  for (const group of shard.groups) {
    const relative = path.relative(rootDir, path.resolve(cwd, group.file));
    assert.ok(
      testListFor(shard, rootDir, cwd).includes(
        `[${group.project}] > ${relative}\n`,
      ),
    );
  }
});

test("test-list paths are root-relative, not repository-relative", () => {
  const groups = [
    {
      project: "chromium",
      file: "tests/e2e/authenticated/withdrawal-p1-recovery.spec.ts",
    },
    {
      project: "mobile-chrome",
      file: "tests/e2e/authenticated/nested/member.spec.ts",
    },
  ];
  assert.equal(
    testListFor({ groups }, rootDir, cwd),
    "[chromium] > withdrawal-p1-recovery.spec.ts\n" +
      "[mobile-chrome] > nested/member.spec.ts\n",
  );
});
test("test-list rejects an entry outside the actual collected root", () => {
  const groups = [{ project: "chromium", file: "tests/outside.spec.ts" }];
  assert.throws(() => testListFor({ groups }, rootDir, cwd));
});
test("test-list requires an explicit absolute collected root", () => {
  const shard = balanceInventory(fixture())[0];
  assert.throws(() => testListFor(shard, undefined, cwd));
  assert.throws(() => testListFor(shard, "relative-root", cwd));
});

test("202 scheduler selects exact12 lanes and new config before execution", () => {
  for (let i = 1; i <= 12; i++)
    assert.doesNotThrow(() => parseAuthenticatedShardChoice(`${i}/12`));
  for (const s of ["1/8", "0/12", "13/12", "1/13"])
    assert.throws(() => parseAuthenticatedShardChoice(s));
  const source = readFileSync(
    new URL("./ci-authenticated-shards-202.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.includes(
      'const CONFIG = "playwright.backend-browser-202.config.ts"',
    ),
  );
  assert.ok(source.includes('PUTDUK_BACKEND_SOURCE_REVISION: "202"'));
  assert.ok(source.includes("--fail-on-flaky-tests"));
});
