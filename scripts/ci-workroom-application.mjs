import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { makeReceipt, assertVitestReport } from "./ci-workroom-evidence.mjs";
import { readFileSync } from "node:fs";
import { jsonUnitCompleteness } from "./unit-completeness-reporter.mjs";

const directory = "test-results/workroom-application";
mkdirSync(directory, { recursive: true });
const startedAt = Date.now();
const commands = [
  [
    "node",
    ["scripts/workroom-source-integrity.mjs", "--verify", "--require-clean"],
  ],
  ["pnpm", ["assets:verify"]],
  ["node", ["scripts/generate-economy-policy-seed.mjs", "--check"]],
  ["pnpm", ["format:check"]],
  ["pnpm", ["lint"]],
  ["pnpm", ["typecheck"]],
  ["node", ["scripts/stage-content-source-ci.mjs"]],
  ["node", ["scripts/ci-workroom-unit-disposition.mjs"]],
  ["node", ["scripts/ci-workroom-browser-disposition.mjs"]],
  [
    "node",
    [
      "--test",
      "scripts/ci-workroom-evidence.test.mjs",
      "scripts/ci-workroom-wall-clock.test.mjs",
      "scripts/ci-workroom-git-blobs.test.mjs",
      "scripts/ci-workroom-source-bytes.test.mjs",
      "scripts/workroom-native-adapters.test.mjs",
    ],
  ],
  ["pnpm", ["test"]],
  ["pnpm", ["build"]],
];
const completed = [];
for (const [command, args] of commands) {
  if (args[0] === "scripts/stage-content-source-ci.mjs") {
    const stdout = execFileSync(command, args, {
      stdio: ["ignore", "pipe", "inherit"],
      env: process.env,
      encoding: "utf8",
    });
    const staged = JSON.parse(stdout.trim());
    if (
      staged.state !== "FIXTURES_STAGED_TESTS_NOT_EXECUTED" ||
      staged.files !== 13 ||
      !staged.fixtureDirectory
    )
      throw Error("WORKROOM_CONTENT_FIXTURE_STAGE");
    process.env.PUTDUK_CONTENT_SOURCE_FIXTURE_DIR = staged.fixtureDirectory;
    console.log(stdout.trim());
  } else execFileSync(command, args, { stdio: "inherit", env: process.env });
  completed.push({ command, args, completedAt: Date.now() });
}
writeFileSync(
  `${directory}/commands.json`,
  JSON.stringify({ startedAt, completed }, null, 2) + "\n",
);
// Both default unit commands must produce independently complete raw reports.
for (const file of ["web-vitest.json", "admin-vitest.json"]) {
  const report = JSON.parse(readFileSync(`${directory}/${file}`, "utf8"));
  assertVitestReport(report);
  const receipt = JSON.parse(
    readFileSync(`${directory}/${file}.completeness.json`, "utf8"),
  );
  if (!jsonUnitCompleteness(receipt, report).complete)
    throw Error("WORKROOM_UNIT_JSON_COMPLETENESS");
}
writeFileSync(
  `${directory}/receipt.json`,
  JSON.stringify(
    makeReceipt({
      gate: "application",
      startedAt,
      files: [
        `${directory}/commands.json`,
        `${directory}/web-vitest.json`,
        `${directory}/admin-vitest.json`,
        `${directory}/web-vitest.json.completeness.json`,
        `${directory}/admin-vitest.json.completeness.json`,
        ".next/BUILD_ID",
        "apps/admin/.next/BUILD_ID",
      ],
    }),
    null,
    2,
  ) + "\n",
);
