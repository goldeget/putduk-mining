import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
    const cli = require.resolve("@playwright/test/cli");
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

test("project-specific scheduling retains slower mobile observation and unknown fallbacks", () => {
  const make = (project, file, id) => ({
    key: JSON.stringify([project, id]),
    project,
    file: `tests/e2e/authenticated/${file}`,
  });
  const all = [
    make("chromium", "home-catalog-materials.spec.ts", "desktop"),
    make("mobile-chrome", "home-catalog-materials.spec.ts", "mobile"),
    make("future-project", "home-catalog-materials.spec.ts", "future"),
    make("chromium", "unknown-new.spec.ts", "unknown"),
  ];
  const shards = balanceInventory(all, 4);
  const weight = (project, suffix) =>
    shards.find((shard) =>
      shard.tests.some(
        (item) => item.project === project && item.file.endsWith(suffix),
      ),
    ).estimateSeconds;
  assert.equal(weight("chromium", "home-catalog-materials.spec.ts"), 403);
  assert.equal(weight("mobile-chrome", "home-catalog-materials.spec.ts"), 565);
  assert.equal(weight("future-project", "home-catalog-materials.spec.ts"), 389);
  assert.equal(weight("chromium", "unknown-new.spec.ts"), 20);
  assertSameInventory(
    all,
    shards.flatMap((shard) => shard.tests),
  );
});

test("completed member mockup uses observed placement margin without changing its deadline or coverage", () => {
  const all = inventoryFromReport(
    report([...specs(), ...specs("chromium")]),
    cwd,
  );
  const shards = balanceInventory(all, 12);
  const units = shards.flatMap((shard) => shard.groups);
  assert.equal(units.length, 14);
  assertSameInventory(
    all,
    shards.flatMap((shard) => shard.tests),
  );
  const single = (project, title) =>
    shards.find(
      (shard) =>
        shard.tests.length === 1 &&
        shard.tests[0].project === project &&
        shard.tests[0].titlePath[0] === title,
    );
  assert.equal(single("mobile-chrome", titles[1]).estimateSeconds, 380);
  assert.equal(single("chromium", titles[1]).estimateSeconds, 178);
});

// Exact historical 05f5939 identities and completed-run start intervals, not
// a new timeout or runtime guarantee. Keep shared-fixture files whole.
// Rows: project/file/space-separated stable IDs/observed seconds/title index.
const COMPLETED_05F_UNITS = [
  [
    "mobile-chrome",
    "home-catalog-materials.spec.ts",
    "eb9c9a56e3ccd76b4934-5a9e9d7d37c53caddb4d",
    513.092,
  ],
  [
    "chromium",
    "admin-krw-browser-money.spec.ts",
    "8b341ee790652ae4de27-723205cd57e6c003f3b4",
    136.845,
  ],
  [
    "mobile-chrome",
    "admin-v7-operator-ux.spec.ts",
    "320e14f2028358a30dc9-734be931851d1f543e19",
    26.555,
  ],
  [
    "chromium",
    "home-typography.spec.ts",
    "cb71da3475b647939694-4c8ecb7675a27d2092d3",
    48.142,
  ],
  [
    "chromium",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-21f06f23b6bea7132da8",
    26.32,
    6,
  ],
  [
    "chromium",
    "events-product.spec.ts",
    "6f4c219bc12beae5ac90-1429f6f1413b64373f7b 6f4c219bc12beae5ac90-808cadc5a6a684ea3e54 6f4c219bc12beae5ac90-c384d100aadf5c15ecdc 6f4c219bc12beae5ac90-ca705b7a740607109e5a",
    20.468,
  ],
  [
    "mobile-chrome",
    "ai-context-help.spec.ts",
    "57388b02e624bcaf2c1c-1ff40c3edb1742888e83 57388b02e624bcaf2c1c-7b1b09f76025671dd9e5",
    15.57,
  ],
  [
    "mobile-chrome",
    "admin-restrictions-safe-mode.spec.ts",
    "41d3989e5865222ee1d2-4db4a4a98baa4342e1a3",
    22.747,
  ],
  [
    "chromium",
    "admin-today.spec.ts",
    "a1511fb4f046a74bd26e-fd7b0577f7c8adcaf759",
    2.323,
  ],
  [
    "mobile-chrome",
    "principal-withdrawal-product.spec.ts",
    "b7307c161dee6ca742c7-2c0d7305411c8c73df82 b7307c161dee6ca742c7-4a83b8b225cca969a1bf b7307c161dee6ca742c7-82374d94dc8b89d8f4d5 b7307c161dee6ca742c7-eb3c774a1620532b0480",
    482.973,
  ],
  [
    "mobile-chrome",
    "admin-exceptions-product.spec.ts",
    "d8dab606f3828e781fe0-4ea1f04c20d154c4c7d1 d8dab606f3828e781fe0-5871a49b8a31107e2653 d8dab606f3828e781fe0-6f8448c1d17976b95bbf d8dab606f3828e781fe0-f41a740f741e1155e627 d8dab606f3828e781fe0-fea1ee3756accd8d7bb8",
    135.703,
  ],
  [
    "mobile-chrome",
    "withdrawal-negative-guards.spec.ts",
    "9417e857de07145905d5-131946f881de801539b0 9417e857de07145905d5-4af8730911b099704dd3 9417e857de07145905d5-63b79664672c93b875fa 9417e857de07145905d5-9e1cff7b576b49653c11 9417e857de07145905d5-b61ca27877cf5348f067",
    92.587,
  ],
  [
    "chromium",
    "admin-exceptions-recon-ack.spec.ts",
    "7ffd38d380e110b1d914-039706e0021e509a0ce9 7ffd38d380e110b1d914-e8ae5e0695442905fc77",
    60.535,
  ],
  [
    "chromium",
    "admin-restrictions-safe-mode.spec.ts",
    "41d3989e5865222ee1d2-bdf72ff175a7a58161d9",
    29.562,
  ],
  [
    "mobile-chrome",
    "member-product-scene.spec.ts",
    "26156a0c8f7aa76369d7-47335c4ae0ba683c3449",
    24.63,
  ],
  [
    "chromium",
    "wallet-product.spec.ts",
    "3e099c945a1e13b425ea-9cb1e8445dadacc791ef",
    14.976,
  ],
  [
    "mobile-chrome",
    "withdrawal-hydration.spec.ts",
    "341e1bee770290cd2c44-a6c5d2187e23f95d70aa",
    13.299,
  ],
  [
    "mobile-chrome",
    "admin-today.spec.ts",
    "a1511fb4f046a74bd26e-58a558b6ff1010851b68",
    2.391,
  ],
  [
    "chromium",
    "principal-withdrawal-product.spec.ts",
    "b7307c161dee6ca742c7-04ee4ec3a281dcc69e72 b7307c161dee6ca742c7-3ef9721f20f642d5a968 b7307c161dee6ca742c7-7ac2e0aa71f99cd9fef3 b7307c161dee6ca742c7-f44c5060daeb45b8cfe3",
    415.18,
  ],
  [
    "chromium",
    "home-start-product.spec.ts",
    "5b3c96e3c219ab0adefc-2e04de6667df7450d8bf 5b3c96e3c219ab0adefc-3f925036110687f63f45 5b3c96e3c219ab0adefc-6ccb6c65e2b51ba9f8e6 5b3c96e3c219ab0adefc-b02cfa55bf03a1d2204f 5b3c96e3c219ab0adefc-bdce4d3d36fe491620f9 5b3c96e3c219ab0adefc-ff0a775cc0c316be8c9f",
    165.736,
  ],
  [
    "mobile-chrome",
    "admin-usdt-browser-money.spec.ts",
    "0327cb428fb8fd9345fc-fe06690b9c7574bc5d11",
    129.798,
  ],
  [
    "chromium",
    "menu-product.spec.ts",
    "d9f92ab5d5e6c3639796-37a6876e2f45385d8656 d9f92ab5d5e6c3639796-3af39d28e10e89ec05b5 d9f92ab5d5e6c3639796-6184dd6a9cc54982d8f2 d9f92ab5d5e6c3639796-729f6979812dc9b172ba",
    37.651,
  ],
  [
    "mobile-chrome",
    "notifications-product.spec.ts",
    "04ec84c45edf8f21ae0b-19287e2e82bcd34e7c05 04ec84c45edf8f21ae0b-264a564041c4d8617c42 04ec84c45edf8f21ae0b-f3dfca425ef749838583",
    25.53,
  ],
  [
    "chromium",
    "mining-product.spec.ts",
    "e03c42c90231e3c753d9-49ecf4147b189af6570f e03c42c90231e3c753d9-d16937cd96cf1bf431f8 e03c42c90231e3c753d9-d7131d84c9800adbe9ce e03c42c90231e3c753d9-dde8c410e7a4de868aa8",
    14.733,
  ],
  [
    "chromium",
    "withdrawal-hydration.spec.ts",
    "341e1bee770290cd2c44-c9a8a66a4b063a0098c7",
    13.268,
  ],
  [
    "chromium",
    "admin-assistant-context.spec.ts",
    "8241a9efaaffc78bc634-a509e2a34d4933c205b5 8241a9efaaffc78bc634-af4d1d558d9d2f4a19d9",
    8.54,
  ],
  [
    "mobile-chrome",
    "admin-session-totp.spec.ts",
    "19120b697487daf04620-05a25172aee5b9baedce 19120b697487daf04620-837aa3a75f0a6af60278 19120b697487daf04620-de441e02fb58e9aaf966",
    5.409,
  ],
  [
    "chromium",
    "home-catalog-materials.spec.ts",
    "eb9c9a56e3ccd76b4934-e8ba27eb444ba2bb7761",
    365.781,
  ],
  [
    "chromium",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-46232485e98589399c7d",
    161.299,
    1,
  ],
  [
    "mobile-chrome",
    "admin-withdrawal-step-up.spec.ts",
    "6de4817876c49f71876a-1dc2759a6b2b3edb32c4 6de4817876c49f71876a-2a8dd3a9fb8f1c38fb6a",
    127.842,
  ],
  [
    "mobile-chrome",
    "menu-product.spec.ts",
    "d9f92ab5d5e6c3639796-318e5bbd583f24aabaee d9f92ab5d5e6c3639796-53bcfabcbb1f23bca99a d9f92ab5d5e6c3639796-c710b09f2095935db35b d9f92ab5d5e6c3639796-c74037ef68111fd09508",
    42.609,
  ],
  [
    "mobile-chrome",
    "ai-product.spec.ts",
    "c16b691f66f0dee8c12a-02cbc4850864c298e93d c16b691f66f0dee8c12a-1efccfff387709036d1a c16b691f66f0dee8c12a-38c3d52b9cd3c8e3d733",
    24.306,
  ],
  [
    "chromium",
    "admin-withdrawals-product.spec.ts",
    "ef14811ee1108f4017f8-1ec41f3bda8f36228806 ef14811ee1108f4017f8-7ddd963464fe81407273 ef14811ee1108f4017f8-d0ffdada91cdaa3b9957",
    19.658,
  ],
  [
    "mobile-chrome",
    "admin-assistant-context.spec.ts",
    "8241a9efaaffc78bc634-3be87f97d9d881525e86 8241a9efaaffc78bc634-76484eba7a098b5b237c",
    11.507,
  ],
  [
    "mobile-chrome",
    "products-catalog.spec.ts",
    "66f71961e86dd7a2e705-7a6df7bf30e83f7111d9 66f71961e86dd7a2e705-d51f278788baedad3527",
    9.234,
  ],
  [
    "mobile-chrome",
    "usdt-manual-full-payout-195.spec.ts",
    "412888c171cf3ef1eac4-d77bdfe26a803d8999c3",
    4.095,
  ],
  [
    "mobile-chrome",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-0e968f8dc78082844372",
    345.098,
    1,
  ],
  [
    "chromium",
    "catalog-allocation.spec.ts",
    "bdcd2defbfe08245d9c4-c80504af50aa67382aa1",
    210.151,
  ],
  [
    "chromium",
    "admin-usdt-browser-money.spec.ts",
    "0327cb428fb8fd9345fc-a8eff1ebc8d127a494db",
    128.685,
  ],
  [
    "chromium",
    "deposit-product.spec.ts",
    "6bb3093ae9e365fb65f0-00f7c13ceed89d5589c4 6bb3093ae9e365fb65f0-37bf401af45b92012c7f 6bb3093ae9e365fb65f0-9145c27d0602c3839545 6bb3093ae9e365fb65f0-a204f3c31587d8b132a0 6bb3093ae9e365fb65f0-aa9e246cc379b7d298e8 6bb3093ae9e365fb65f0-b736580b7bdbf162642b 6bb3093ae9e365fb65f0-b995fa1232ef8045eee9",
    56.541,
  ],
  [
    "chromium",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-059c5649fe294e7ad763",
    45.362,
    2,
  ],
  [
    "chromium",
    "ai-product.spec.ts",
    "c16b691f66f0dee8c12a-11070f28e20028ee0863 c16b691f66f0dee8c12a-2f26c815e6ba238007fa c16b691f66f0dee8c12a-c22017a483a1f1121ff9",
    24.019,
  ],
  [
    "chromium",
    "start-onboarding-eligibility.spec.ts",
    "bb5411b032a747154a27-03eb33e7f415fc3b7251 bb5411b032a747154a27-d8c5e07038c843d0fb9c",
    19.186,
  ],
  [
    "mobile-chrome",
    "first-usdt-withdrawal.spec.ts",
    "d4f1136c03d6950ffaaf-63ed191298932b338422",
    14.031,
  ],
  [
    "chromium",
    "operator-fixture-isolation.spec.ts",
    "8b763367f203e5c0961c-d330cf620abe6227aeb5",
    0.41,
  ],
  [
    "mobile-chrome",
    "operator-fixture-isolation.spec.ts",
    "8b763367f203e5c0961c-392ef910e4decbc4e2bd",
    0.561,
  ],
  [
    "chromium",
    "withdrawal-p1-recovery.spec.ts",
    "ab217f5e7a0d128a6fd7-0b598261887c9cf83d58 ab217f5e7a0d128a6fd7-18696571f8ff3a268b22 ab217f5e7a0d128a6fd7-669e24f05c8642f7dd9e ab217f5e7a0d128a6fd7-7982e30f7852a1b8dc45 ab217f5e7a0d128a6fd7-7bc3229b17e008863720 ab217f5e7a0d128a6fd7-910d510cb7136ae758a7 ab217f5e7a0d128a6fd7-a384625b31e8d1776ef7 ab217f5e7a0d128a6fd7-a3d39a155a53fae22b65 ab217f5e7a0d128a6fd7-b7f6348d4f3d8381d4e7 ab217f5e7a0d128a6fd7-c43310c63e0f30ca7cd4 ab217f5e7a0d128a6fd7-c74534b06aae22e344f7 ab217f5e7a0d128a6fd7-d3a50e4ac6709f28903f ab217f5e7a0d128a6fd7-d7dc194dafbec0832b35",
    274.717,
  ],
  [
    "mobile-chrome",
    "home-start-product.spec.ts",
    "5b3c96e3c219ab0adefc-1e6f293bf2a88f1cae03 5b3c96e3c219ab0adefc-3e861b470999721e9134 5b3c96e3c219ab0adefc-64949936af561ade7a7f 5b3c96e3c219ab0adefc-74093f6fa995cb14981c 5b3c96e3c219ab0adefc-87631664f4db3ccc0c57 5b3c96e3c219ab0adefc-a1bbba0da1a2c2fb8e83",
    198.178,
  ],
  [
    "chromium",
    "withdrawal-destination-reauth.spec.ts",
    "4185da02c9ae994a5522-03ea55bf5dd2a9fa235f 4185da02c9ae994a5522-0662a58566e74a175f61 4185da02c9ae994a5522-16ce99c9bcc1f97c0b93 4185da02c9ae994a5522-1f434b8f407898b98c9d 4185da02c9ae994a5522-85b2c1d807ea93a5f3a7 4185da02c9ae994a5522-8b98b4a753bfae5a6f62 4185da02c9ae994a5522-aa15246e0970553a36e1 4185da02c9ae994a5522-cfde597673f3f223b090",
    130.14,
  ],
  [
    "chromium",
    "withdrawal-negative-guards.spec.ts",
    "9417e857de07145905d5-5506560aa708ec54142a 9417e857de07145905d5-8b41819101474cee0dc6 9417e857de07145905d5-d70db2fab5486b67e81a 9417e857de07145905d5-ef516793675432615572 9417e857de07145905d5-fbf5d9a6c2ff3c50c6f1",
    92.672,
  ],
  [
    "mobile-chrome",
    "admin-members-product.spec.ts",
    "978331c4b6c9b24bcc33-0189b5001d826d0b42de 978331c4b6c9b24bcc33-43c2b898942e3633ca0a 978331c4b6c9b24bcc33-4c5c4db629c32ede1780 978331c4b6c9b24bcc33-72583690fe418888c060",
    51.999,
  ],
  [
    "mobile-chrome",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-bcddc138ff983958c616",
    29.447,
    6,
  ],
  [
    "mobile-chrome",
    "withdrawal-logical-idempotency.spec.ts",
    "f86712ecf7e70be42ea3-f64fff3f6a91793742f4",
    23.607,
  ],
  [
    "chromium",
    "ai-context-help.spec.ts",
    "57388b02e624bcaf2c1c-2443927ceeb7d00440fd 57388b02e624bcaf2c1c-d5c891b5ee886677a457",
    15.448,
  ],
  [
    "chromium",
    "first-krw-withdrawal.spec.ts",
    "81c96a6c5cda3e7fa903-5deb13297bd89a0b5b9a",
    14.721,
  ],
  [
    "chromium",
    "signup-reconstruction.spec.ts",
    "890319ae1c4f9bf0ce2b-a5115597155253a9f3d6",
    2.216,
  ],
  [
    "mobile-chrome",
    "catalog-allocation.spec.ts",
    "bdcd2defbfe08245d9c4-982b9aacbb45885bd5e1",
    229.764,
  ],
  [
    "mobile-chrome",
    "catalog-allocated-wallet-light.spec.ts",
    "aab2b6367d03850aa1e2-32778ad9c59d471e5623",
    266.25,
  ],
  [
    "mobile-chrome",
    "home-typography.spec.ts",
    "cb71da3475b647939694-8d7371bbbec5d69ac504",
    106.491,
  ],
  [
    "mobile-chrome",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-bc76b2c6421115bb9ca2",
    57.816,
    5,
  ],
  [
    "mobile-chrome",
    "admin-exceptions-recon-ack.spec.ts",
    "7ffd38d380e110b1d914-03c34a29de66a5099889 7ffd38d380e110b1d914-9b1ba1993d54028b2a73",
    61.742,
  ],
  [
    "chromium",
    "admin-assistant-read-draft.spec.ts",
    "dccefce22604a30a1d68-d461bb3c79e6970d792e",
    8.832,
  ],
  [
    "chromium",
    "admin-v7-operator-ux.spec.ts",
    "320e14f2028358a30dc9-564f0853295222934ee4",
    21.415,
  ],
  [
    "mobile-chrome",
    "start-onboarding-eligibility.spec.ts",
    "bb5411b032a747154a27-49985cce25a03cea379d bb5411b032a747154a27-7f550143010541bbe7fe",
    16.958,
  ],
  [
    "mobile-chrome",
    "first-krw-withdrawal.spec.ts",
    "81c96a6c5cda3e7fa903-1a2423ac958b1e38f15c",
    13.574,
  ],
  [
    "chromium",
    "usdt-manual-full-payout-195.spec.ts",
    "412888c171cf3ef1eac4-05b992573bd932a77107",
    5.939,
  ],
  [
    "mobile-chrome",
    "withdrawal-p1-recovery.spec.ts",
    "ab217f5e7a0d128a6fd7-1d013213bfcb1f47cd32 ab217f5e7a0d128a6fd7-34e01f8726b44953189f ab217f5e7a0d128a6fd7-35e1a7d7f6c799267ee5 ab217f5e7a0d128a6fd7-4a1ce715012c47fae4d5 ab217f5e7a0d128a6fd7-587f3845794c035cbc3f ab217f5e7a0d128a6fd7-6d043abf34f723ee6ee7 ab217f5e7a0d128a6fd7-730a3266f029ede944f8 ab217f5e7a0d128a6fd7-73f09051ff98fe1bde4f ab217f5e7a0d128a6fd7-796c79f4b0cd49460648 ab217f5e7a0d128a6fd7-7e733e54f59ba9694d18 ab217f5e7a0d128a6fd7-9df4b3a3b64198b73118 ab217f5e7a0d128a6fd7-dc86023887e498339c24 ab217f5e7a0d128a6fd7-fd295573bc000c2848dd",
    265.397,
  ],
  [
    "chromium",
    "catalog-materials.spec.ts",
    "9607a3f916d679155020-9322de246f7140378580",
    227.503,
  ],
  [
    "chromium",
    "admin-withdrawal-step-up.spec.ts",
    "6de4817876c49f71876a-7e3284114bc6911a0d4e 6de4817876c49f71876a-b5aa33d9c4978c6663e9",
    117.551,
  ],
  [
    "mobile-chrome",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-f0fc96b55bea51acd8dd",
    72.959,
    2,
  ],
  [
    "chromium",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-b94cd1f96813ddd36f6a",
    37.369,
    3,
  ],
  [
    "mobile-chrome",
    "events-product.spec.ts",
    "6f4c219bc12beae5ac90-ce6ec14c4a3953b31c0f 6f4c219bc12beae5ac90-dee03533381bf8af9a10 6f4c219bc12beae5ac90-e856dde8e2100fbb4494 6f4c219bc12beae5ac90-fd8e67e7336ced682832",
    23.441,
  ],
  [
    "chromium",
    "withdrawal-logical-idempotency.spec.ts",
    "f86712ecf7e70be42ea3-d1607e073b96d5d78c42",
    23.447,
  ],
  [
    "chromium",
    "first-usdt-withdrawal.spec.ts",
    "d4f1136c03d6950ffaaf-84e200cc2b31db95e5c3",
    13.037,
  ],
  [
    "mobile-chrome",
    "wallet-product.spec.ts",
    "3e099c945a1e13b425ea-0eb0e600b0a9d159c1ff",
    12.696,
  ],
  [
    "chromium",
    "public-admin-boundary.spec.ts",
    "078713875c1cd9d5e588-346c1d2c1a7327583439 078713875c1cd9d5e588-8314ad8cff8c6189169d 078713875c1cd9d5e588-a125ee2a42e5237b5086 078713875c1cd9d5e588-a137ac08a39d87c4ea58",
    0.055,
  ],
  [
    "mobile-chrome",
    "public-admin-boundary.spec.ts",
    "078713875c1cd9d5e588-206141b78c97e0f6690f 078713875c1cd9d5e588-3796829a885149db7291 078713875c1cd9d5e588-c0ea99a928524f496e05 078713875c1cd9d5e588-fca3468c96544d99ff98",
    0.061,
  ],
  [
    "mobile-chrome",
    "catalog-materials.spec.ts",
    "9607a3f916d679155020-39612ffdc57fa305eb28",
    237.721,
  ],
  [
    "chromium",
    "catalog-allocated-wallet-light.spec.ts",
    "aab2b6367d03850aa1e2-0ef4e23b3bc9027a0a6a",
    218.105,
  ],
  [
    "mobile-chrome",
    "admin-krw-browser-money.spec.ts",
    "8b341ee790652ae4de27-237e01639feec33ca5f4",
    129.371,
  ],
  [
    "mobile-chrome",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-1175ec8105d7b3e7488d",
    95.272,
    0,
  ],
  [
    "chromium",
    "withdrawal-product.spec.ts",
    "feb64f4c654693353edb-30c267ce39b0e6549958 feb64f4c654693353edb-51ac5fb0b4c46fea0d85 feb64f4c654693353edb-b299594442b2d6f5dba3 feb64f4c654693353edb-f24a2c29294edf01fe5e",
    48.082,
  ],
  [
    "visual-evidence",
    "success-visual-evidence.spec.ts",
    "80a45e18049a08c5ab15-f9fac6656229dc0e7fca",
    32.125,
  ],
  [
    "mobile-chrome",
    "admin-withdrawals-product.spec.ts",
    "ef14811ee1108f4017f8-1332a9c4202aa66b756a ef14811ee1108f4017f8-61cef95b45f533b33f32 ef14811ee1108f4017f8-73a1af532ea077eee260",
    22.314,
  ],
  [
    "mobile-chrome",
    "welcome-withdrawal-error-copy.spec.ts",
    "a8c7b42aea28dfe63e1a-d2acb31e8617689114b9",
    18.765,
  ],
  [
    "chromium",
    "usdt-manual-full-payout-197.spec.ts",
    "386849d2dc8bbc3c9a6b-be37994ecf57a5197e25",
    6.516,
  ],
  [
    "mobile-chrome",
    "usdt-manual-full-payout-197.spec.ts",
    "386849d2dc8bbc3c9a6b-6f42213e4f34e2cac558",
    5.417,
  ],
  [
    "mobile-chrome",
    "catalog-allocated-home-light.spec.ts",
    "11adae5258c3bf78266f-2ba8fba69fdb6592a88e",
    227.195,
  ],
  [
    "chromium",
    "catalog-allocated-home-light.spec.ts",
    "11adae5258c3bf78266f-3e8fc794bc8bc6c09fca",
    202.346,
  ],
  [
    "mobile-chrome",
    "withdrawal-destination-reauth.spec.ts",
    "4185da02c9ae994a5522-08ce1c49ab0cdf9fe29a 4185da02c9ae994a5522-1e8ccd0294a95b430c43 4185da02c9ae994a5522-2e88fc269db48d5d3a47 4185da02c9ae994a5522-317379900c52aa779b78 4185da02c9ae994a5522-464d68b8f3d7fddac4ff 4185da02c9ae994a5522-4e83fb47d21fc51444d4 4185da02c9ae994a5522-669994735e67fbcb1b0b 4185da02c9ae994a5522-9dc1fcd428cf42a872cb",
    107.877,
  ],
  [
    "mobile-chrome",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-8827aad8324e81ac40c1",
    74.671,
    3,
  ],
  [
    "mobile-chrome",
    "withdrawal-product.spec.ts",
    "feb64f4c654693353edb-4649d0a30aca9a5132d3 feb64f4c654693353edb-784a2b56612dbe4a7b60 feb64f4c654693353edb-a9a50848b0939b159992 feb64f4c654693353edb-d34ff9e256acb48074a2",
    44.827,
  ],
  [
    "chromium",
    "admin-economy-policy.spec.ts",
    "f34ec590ca10217459b1-9191e17aba65c1e814e7",
    22.803,
  ],
  [
    "chromium",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-ef76f5581edd5f626d78",
    19.768,
    4,
  ],
  [
    "mobile-chrome",
    "admin-economy-policy.spec.ts",
    "f34ec590ca10217459b1-9873911fc845ff8d712d",
    11.076,
  ],
  [
    "chromium",
    "products-catalog.spec.ts",
    "66f71961e86dd7a2e705-1753d9cb7aa9fcb55ab7 66f71961e86dd7a2e705-1e2119a78c1cf1476e66",
    8.463,
  ],
  [
    "mobile-chrome",
    "support-channel-talk.spec.ts",
    "dd4183c618d79ea99358-281776ce769c87abf445 dd4183c618d79ea99358-82e38c10ca26469d68e7",
    7.603,
  ],
  [
    "mobile-chrome",
    "catalog-allocated-home-dark.spec.ts",
    "e314d3ff22a7b83f7d07-e48d3507a5bfe0d7aecd",
    233.627,
  ],
  [
    "chromium",
    "catalog-allocated-wallet-dark.spec.ts",
    "23eb468d3e7e355f9440-d42e0a1a671e754c1f19",
    224.367,
  ],
  [
    "mobile-chrome",
    "funded-home-typography.spec.ts",
    "92796cbd2404a8956016-b54f52ec5ab98c7ed7d0",
    137.346,
  ],
  [
    "chromium",
    "admin-kyc-product.spec.ts",
    "7079d9991a5eddb5e156-4d0362fbbbab4681fbcb 7079d9991a5eddb5e156-77ef5904624073e16bfb 7079d9991a5eddb5e156-935c2e041875685a6465 7079d9991a5eddb5e156-bef32bb385c9d1b8076b 7079d9991a5eddb5e156-fea7e59f607a670838c2",
    92.57,
  ],
  [
    "chromium",
    "funded-home-typography.spec.ts",
    "92796cbd2404a8956016-cb56b0bad10f935ae374",
    53.334,
  ],
  [
    "chromium",
    "admin-members-product.spec.ts",
    "978331c4b6c9b24bcc33-be26c16bec888c5fd849 978331c4b6c9b24bcc33-c509a7b2f0b2c519e0ba 978331c4b6c9b24bcc33-e12cbd5d692b12add25a 978331c4b6c9b24bcc33-e7f4691d5a6fd2932f83",
    29.11,
  ],
  [
    "chromium",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-db8e224c328a66e7d082",
    31.121,
    5,
  ],
  [
    "chromium",
    "welcome-withdrawal-error-copy.spec.ts",
    "a8c7b42aea28dfe63e1a-b410c0afc572c9aaf050",
    18.975,
  ],
  [
    "chromium",
    "admin-session-totp.spec.ts",
    "19120b697487daf04620-353099a5f6953bebbd5c 19120b697487daf04620-9c82b5b79f54a51ef792 19120b697487daf04620-ceafbde4bf9e7beb354f",
    5.52,
  ],
  [
    "chromium",
    "support-channel-talk.spec.ts",
    "dd4183c618d79ea99358-0d8286285e248aacf513 dd4183c618d79ea99358-b81ae34c94cdc47ef874",
    6.583,
  ],
  [
    "mobile-chrome",
    "catalog-allocated-wallet-dark.spec.ts",
    "23eb468d3e7e355f9440-7dbf70a961b86a7e0018",
    263.576,
  ],
  [
    "chromium",
    "catalog-allocated-home-dark.spec.ts",
    "e314d3ff22a7b83f7d07-45fca180ac0d46aa6edb",
    207.265,
  ],
  [
    "chromium",
    "admin-exceptions-product.spec.ts",
    "d8dab606f3828e781fe0-11fa40271b5704e51d73 d8dab606f3828e781fe0-3bc023cdac385eb5c706 d8dab606f3828e781fe0-55d71a3925ce1bd3b4b1 d8dab606f3828e781fe0-6a0c65f87db394ff7634 d8dab606f3828e781fe0-a179b00343dae803d5b0",
    139.374,
  ],
  [
    "mobile-chrome",
    "admin-kyc-product.spec.ts",
    "7079d9991a5eddb5e156-0cfca0164bcfe3957566 7079d9991a5eddb5e156-15281ac913096d173db0 7079d9991a5eddb5e156-38b45082cfdf1bb175d2 7079d9991a5eddb5e156-89bbe3da606cc88950a6 7079d9991a5eddb5e156-9f94b615f1da65066a78",
    97.696,
  ],
  [
    "chromium",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-59d5312c3918f5ea8a7e",
    44.85,
    0,
  ],
  [
    "mobile-chrome",
    "mockup-reference-coverage.spec.ts",
    "af4f8926399c810f8f81-90d77c70f0c40bd0e55f",
    32.531,
    4,
  ],
  [
    "chromium",
    "notifications-product.spec.ts",
    "04ec84c45edf8f21ae0b-0695828c0f0294af9433 04ec84c45edf8f21ae0b-1ff2fd8c8e17b0d3754e 04ec84c45edf8f21ae0b-7077de89f34343b98203",
    24.01,
  ],
  [
    "mobile-chrome",
    "admin-assistant-read-draft.spec.ts",
    "dccefce22604a30a1d68-b3527007e2c8d1ff0fdf",
    14.526,
  ],
  [
    "chromium",
    "member-product-scene.spec.ts",
    "26156a0c8f7aa76369d7-0c4963e0c4df4dfba93b",
    9.57,
  ],
  [
    "mobile-chrome",
    "signup-reconstruction.spec.ts",
    "890319ae1c4f9bf0ce2b-609606a9c926a29835e7",
    3.636,
  ],
];

test("completed 05f inventory replay preserves 264 exact identities and balances observed work", () => {
  const all = COMPLETED_05F_UNITS.flatMap(([project, file, ids, , title]) =>
    ids.split(" ").map((id) => ({
      key: JSON.stringify([project, id]),
      project,
      file: `tests/e2e/authenticated/${file}`,
      ...(title === undefined ? {} : { titlePath: [titles[title]] }),
    })),
  );
  assert.equal(all.length, 264);
  const identities = all
    .map((item) => JSON.stringify([item.key, item.project, item.file]))
    .sort();
  assert.equal(
    createHash("sha256").update(JSON.stringify(identities)).digest("hex"),
    "192f0566b011221362f7277974d665823d2e4ac0b252a5e6189415e92bab181e",
  );
  const shards = balanceInventory(all);
  assert.equal(shards.length, 12);
  assertSameInventory(
    all,
    shards.flatMap((shard) => shard.tests),
  );
  const observed = (group) => {
    const row = COMPLETED_05F_UNITS.find(
      ([project, file, , , title]) =>
        project === group.project &&
        group.file === `tests/e2e/authenticated/${file}` &&
        (title === undefined
          ? group.titlePath === undefined
          : group.titlePath?.[0] === titles[title]),
    );
    assert.ok(row);
    return row[3];
  };
  const costs = shards.map((shard) =>
    shard.groups.reduce((sum, group) => sum + observed(group), 0),
  );
  // Replay only: prior assignment max856.657s. Queue/setup/upload are excluded;
  // unchanged 1200s whole-run acceptance remains a separate actual check.
  assert.ok(Math.max(...costs) <= 812);
  assert.ok(Math.max(...shards.map((shard) => shard.estimateSeconds)) <= 900);
  assert.ok(
    shards.every((shard, index) => shard.estimateSeconds >= costs[index] * 1.1),
  );
});
