import assert from "node:assert/strict";
import { test } from "node:test";
import {
  admitAbsent,
  admitContext,
  admitDatabase,
  admitInputs,
  admitStarted,
  PROJECT,
} from "../../scripts/assert-ci-fresh-db.mjs";
const env = {
  GITHUB_ACTIONS: "true",
  RUNNER_OS: "Linux",
  GITHUB_REPOSITORY: "goldeget/putduk-mining",
  GITHUB_JOB: "authenticated",
  GITHUB_RUN_ID: "1",
  GITHUB_RUN_ATTEMPT: "1",
};
test("fresh guard is restricted to exact authenticated Linux CI", () => {
  assert.equal(admitContext(env), "1/1");
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: "false",
    RUNNER_OS: "Windows",
    GITHUB_REPOSITORY: "other/repo",
    GITHUB_JOB: "worker",
    GITHUB_RUN_ID: "",
  }))
    assert.throws(() => admitContext({ ...env, [key]: value }));
});
test("absence requires exact daemon not-found, never generic nonzero", () => {
  admitAbsent(
    { status: 1, stdout: "[]\n", stderr: "Error: No such object: exact\n" },
    "container",
    "exact",
  );
  admitAbsent(
    {
      status: 1,
      stdout: "[]\n",
      stderr: "Error response from daemon: get exact: no such volume\n",
    },
    "volume",
    "exact",
  );
  for (const result of [
    { status: 0, stdout: "[]", stderr: "" },
    { status: 1, stdout: "[]", stderr: "Cannot connect to Docker" },
    { status: 1, stdout: "[]", stderr: "Error: No such object: wrong" },
    {
      status: null,
      error: Error("timeout"),
      stdout: "[]",
      stderr: "Error: No such object: exact",
    },
  ])
    assert.throws(() => admitAbsent(result, "container", "exact"));
});
test("only enabled migrations and the current comment-only seed permit replacement", () => {
  const config = `project_id = "${PROJECT}"\n[db.migrations]\nenabled = true\n[db.seed]\nenabled = true\nsql_paths = ["./seed/*.sql"]\n`;
  const migrations = Array.from({ length: 201 }, (_, n) => ({
    version: String(n),
    sha256: "pin",
  }));
  const seeds = [
    { name: "000_no_production_rules.sql", content: "-- no data\n" },
  ];
  assert.match(admitInputs(config, migrations, seeds), /^[a-f0-9]{64}$/);
  assert.throws(() =>
    admitInputs(
      config.replace("enabled = true", "enabled = false"),
      migrations,
      seeds,
    ),
  );
  assert.throws(() => admitInputs(config, migrations.slice(1), seeds));
  assert.throws(() =>
    admitInputs(config, migrations, [
      { ...seeds[0], content: "insert into auth.users default values;" },
    ]),
  );
});
test("poststart rejects reused identity, stale proof, changed source and foreign mounts", () => {
  const proof = {
    state: "ABSENT_BEFORE_START",
    run: "1/1",
    fingerprint: "pin",
    startedAt: 10000,
  };
  const container = {
    Id: "a".repeat(64),
    Name: `/supabase_db_${PROJECT}`,
    project: PROJECT,
    Running: true,
    Created: new Date(11000).toISOString(),
    Mounts: [
      {
        Destination: "/var/lib/postgresql/data",
        Type: "volume",
        Name: `supabase_db_${PROJECT}`,
      },
    ],
  };
  assert.equal(
    admitStarted(container, proof, "pin", "1/1", 12000),
    container.Id,
  );
  assert.throws(() =>
    admitStarted(
      { ...container, Created: new Date(9000).toISOString() },
      proof,
      "pin",
      "1/1",
      12000,
    ),
  );
  assert.throws(() => admitStarted(container, proof, "changed", "1/1", 12000));
  assert.throws(() => admitStarted(container, proof, "pin", "2/1", 12000));
  assert.throws(() => admitStarted(container, proof, "pin", "1/1", 1000000));
  assert.throws(() =>
    admitStarted(
      { ...container, Mounts: [{ ...container.Mounts[0], Name: "old" }] },
      proof,
      "pin",
      "1/1",
      12000,
    ),
  );
});
test("exact ordered migration history and empty users and money are mandatory", () => {
  const actual = {
    versions: ["1", "2"],
    authUsers: 0,
    ledgerTransactions: 0,
    ledgerEntries: 0,
    database: "postgres",
    role: "postgres",
  };
  admitDatabase(actual, ["1", "2"]);
  assert.throws(() => admitDatabase(actual, ["2", "1"]));
  for (const key of ["authUsers", "ledgerTransactions", "ledgerEntries"])
    assert.throws(() => admitDatabase({ ...actual, [key]: 1 }, ["1", "2"]));
});
