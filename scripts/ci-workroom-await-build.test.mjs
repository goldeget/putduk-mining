import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  successfulApplication,
  selectBuildArtifact,
  BUILD_ARTIFACT_EXTRACTOR,
} from "./ci-workroom-await-build.mjs";

test("exact build extraction carries the runtime proof and rejects unsafe or unreviewed roots before writing", () => {
  const python = process.platform === "win32" ? "python" : "python3";
  const create =
    "import sys,json,zipfile,stat\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for item in json.loads(sys.argv[2]):\n  e=zipfile.ZipInfo(item['name'])\n  if item.get('symlink'): e.create_system=3; e.external_attr=(stat.S_IFLNK|0o777)<<16\n  z.writestr(e,'probe')\n";
  const build = (entries) => {
    const directory = mkdtempSync(resolve(tmpdir(), "workroom-build-roots-"));
    const archive = resolve(directory, "build.zip");
    const output = resolve(directory, "output");
    const made = spawnSync(
      python,
      ["-c", create, archive, JSON.stringify(entries)],
      { encoding: "utf8" },
    );
    assert.equal(made.status, 0, made.stderr);
    // The extraction cwd is separate from the ZIP and never points at source.
    const prepare = spawnSync(python, [
      "-c",
      "import pathlib,sys;pathlib.Path(sys.argv[1]).mkdir()",
      output,
    ]);
    assert.equal(prepare.status, 0);
    return {
      output,
      result: spawnSync(python, ["-c", BUILD_ARTIFACT_EXTRACTOR, archive], {
        cwd: output,
        encoding: "utf8",
      }),
    };
  };
  const permitted = [
    ".next/BUILD_ID",
    "apps/admin/.next/BUILD_ID",
    "test-results/workroom-application/receipt.json",
    "test-results/workroom-runtime/runtime-workerd-check.json",
  ];
  const good = build(permitted.map((name) => ({ name })));
  assert.equal(good.result.status, 0, good.result.stderr);
  for (const name of permitted)
    assert.equal(readFileSync(resolve(good.output, name), "utf8"), "probe");
  for (const bad of [
    { name: "test-results/unreviewed/proof.json" },
    { name: "test-results/workroom-runtime-evil/proof.json" },
    { name: "../outside.txt" },
    { name: "C:/outside.txt" },
    { name: "evil\\file" },
    { name: ".next/symlink", symlink: true },
  ]) {
    const denied = build([{ name: ".next/BUILD_ID" }, bad]);
    assert.notEqual(denied.result.status, 0, bad.name);
    assert.deepEqual(readdirSync(denied.output), []);
  }
  const duplicate = build([
    { name: ".next/BUILD_ID" },
    { name: ".next/BUILD_ID" },
  ]);
  assert.notEqual(duplicate.result.status, 0);
  assert.deepEqual(readdirSync(duplicate.output), []);
});
const identity = { id: 123, attempt: 1, head: "a".repeat(40) };
const run = {
  id: 123,
  run_attempt: 1,
  head_sha: identity.head,
  path: ".github/workflows/ci.yml",
  repository: { full_name: "goldeget/putduk-mining" },
};
const passed = {
  name: "WORKROOM application gates",
  status: "completed",
  conclusion: "success",
};
test("parallel native still waits for exact successful application gates", () => {
  assert.equal(successfulApplication(run, [], identity), false);
  assert.equal(
    successfulApplication(
      run,
      [{ ...passed, status: "in_progress" }],
      identity,
    ),
    false,
  );
  assert.equal(successfulApplication(run, [passed], identity), true);
  for (const invalid of [
    { id: 124 },
    { head_sha: "b".repeat(40) },
    { run_attempt: 2 },
    { path: ".github/workflows/other.yml" },
  ])
    assert.throws(
      () => successfulApplication({ ...run, ...invalid }, [passed], identity),
      /EXACT_BUILD_RUN_REQUIRED/,
    );
  assert.throws(
    () =>
      successfulApplication(
        run,
        [{ ...passed, conclusion: "failure" }],
        identity,
      ),
    /DID_NOT_PASS/,
  );
  assert.throws(
    () => successfulApplication(run, [passed, passed], identity),
    /AMBIGUOUS/,
  );
});
test("wrong, duplicate, expired or digestless build cannot enter browser acceptance", () => {
  const row = {
    id: 9,
    name: `workroom-build-123-1-${identity.head}`,
    expired: false,
    digest: `sha256:${"c".repeat(64)}`,
  };
  assert.equal(selectBuildArtifact([row], identity).id, 9);
  for (const rows of [
    [],
    [row, row],
    [{ ...row, expired: true }],
    [{ ...row, name: row.name + "extra" }],
    [{ ...row, digest: null }],
  ])
    assert.throws(
      () => selectBuildArtifact(rows, identity),
      /EXACT_BUILD_ARTIFACT_REQUIRED/,
    );
});
test("full acceptance admits only its own full application job and workflow", () => {
  const full = { ...identity, profile: "full" };
  const fullRun = { ...run, path: ".github/workflows/ci-full-e2e.yml" };
  const fullJob = { ...passed, name: "WORKROOM full application gates" };
  assert.equal(successfulApplication(fullRun, [fullJob], full), true);
  assert.equal(successfulApplication(fullRun, [passed], full), false);
  assert.throws(
    () => successfulApplication(run, [fullJob], full),
    /EXACT_BUILD_RUN_REQUIRED/,
  );
});
