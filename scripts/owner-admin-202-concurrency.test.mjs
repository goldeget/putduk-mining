import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseOwner202Arguments,
  assertOwner202SessionProof,
  assertOwner202Dump,
  owner202SessionSql,
  owner202ChildEnvironment,
  readOwner202DockerTarget,
  owner202PsqlArguments,
  owner202DumpArguments,
} from "./owner-admin-202-concurrency.mjs";
const id = "a".repeat(64),
  db = "putduk_owner202_" + "b".repeat(32);
const project = "putduk-mining-ci-r2-20261009",
  now = Date.parse("2026-10-21T00:10:00Z");
function dockerFixture() {
  return {
    context: [
      { Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } },
    ],
    container: [
      {
        Id: id,
        Name: "/supabase_db_" + project,
        Created: new Date(now - 60000).toISOString(),
        State: { Running: true, Paused: false, Health: { Status: "healthy" } },
        Config: {
          Labels: { "com.supabase.cli.project": project },
          Env: [
            "PGHOST=/var/run/postgresql",
            "PGPORT=5432",
            "PGDATABASE=postgres",
            "PGUSER=postgres",
          ],
        },
        NetworkSettings: { Ports: { "5432/tcp": [{ HostPort: "63422" }] } },
        Mounts: [
          {
            Destination: "/var/lib/postgresql/data",
            Type: "volume",
            Name: "supabase_db_" + project,
          },
        ],
      },
    ],
    volume: [
      {
        Name: "supabase_db_" + project,
        CreatedAt: new Date(now - 70000).toISOString(),
      },
    ],
  };
}
function mockRead(f, calls) {
  return (args) => {
    calls.push(args);
    if (args[0] === "context") return f.context;
    if (args[0] === "inspect") return f.container;
    if (args[0] === "volume") return f.volume;
    throw Error("unexpected docker/DB call");
  };
}
test("owner202 accepts only local default Docker socket and exact fresh labeled volume target before any DB call", () => {
  const calls = [],
    f = dockerFixture();
  assert.equal(
    readOwner202DockerTarget(mockRead(f, calls), id, now).containerId,
    id,
  );
  assert.deepEqual(calls, [
    ["context", "inspect", "default"],
    ["inspect", "supabase_db_" + project],
    ["volume", "inspect", "supabase_db_" + project],
  ]);
  for (const [name, change] of Object.entries({
    remote: (f) => (f.context[0].Endpoints.docker.Host = "tcp://remote:2376"),
    duplicateContext: (f) => f.context.push(f.context[0]),
    wrongLabel: (f) =>
      (f.container[0].Config.Labels["com.supabase.cli.project"] = "foreign"),
    wrongPort: (f) =>
      (f.container[0].NetworkSettings.Ports["5432/tcp"][0].HostPort = "5432"),
    wrongMount: (f) => (f.container[0].Mounts[0].Name = "foreign"),
    bindMount: (f) => (f.container[0].Mounts[0].Type = "bind"),
    staleContainer: (f) =>
      (f.container[0].Created = new Date(now - 3600001).toISOString()),
    staleVolume: (f) =>
      (f.volume[0].CreatedAt = new Date(now - 3600001).toISOString()),
    reusedVolume: (f) =>
      (f.volume[0].CreatedAt = new Date(now - 180000).toISOString()),
    remotePGHost: (f) => f.container[0].Config.Env.push("PGHOST=remote"),
    wrongPGPort: (f) => f.container[0].Config.Env.push("PGPORT=6543"),
    wrongPGDatabase: (f) =>
      f.container[0].Config.Env.push("PGDATABASE=production"),
    serviceOverride: (f) =>
      f.container[0].Config.Env.push("PGSERVICE=production"),
    serviceFile: (f) =>
      f.container[0].Config.Env.push("PGSERVICEFILE=/tmp/remote"),
    unhealthy: (f) => (f.container[0].State.Health.Status = "starting"),
  })) {
    const fixture = dockerFixture(),
      observed = [];
    change(fixture);
    assert.throws(
      () => readOwner202DockerTarget(mockRead(fixture, observed), id, now),
      undefined,
      name,
    );
    assert.ok(
      observed.every((a) => ["context", "inspect", "volume"].includes(a[0])),
      name,
    );
    if (name === "remote" || name === "duplicateContext")
      assert.equal(observed.length, 1);
  }
});
test("owner202 refuses host Docker overrides and pins psql/dump to local socket independent of container PGHOST", () => {
  for (const key of [
    "DOCKER_HOST",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "NODE_OPTIONS",
    "NODE_PATH",
  ])
    assert.throws(() => owner202ChildEnvironment({ [key]: "override" }));
  assert.deepEqual(
    owner202ChildEnvironment({
      PATH: "safe",
      DOCKER_CONTEXT: "remote",
      SUPABASE_SECRET_KEY: "must-not-inherit",
    }),
    { DOCKER_CONTEXT: "default", PATH: "safe" },
  );
  for (const args of [
    owner202PsqlArguments(id, db),
    owner202DumpArguments(id),
  ]) {
    assert.equal(args[args.indexOf("-h") + 1], "/var/run/postgresql");
    assert.equal(args[args.indexOf("-p") + 1], "5432");
    assert.ok(args.includes("-w"));
  }
});
test("owner202 rejects implicit/default/destructive/shared database execution", () => {
  for (const a of [
    [],
    ["--execute"],
    [
      "--execute",
      "--allow-synthetic-db-writes",
      "--allow-create-owned-database",
      "--fresh-container-id=" + id,
      "--database=postgres",
      "--output=/tmp/new",
    ],
  ])
    assert.throws(() => parseOwner202Arguments(a));
  const a = [
    "--execute",
    "--allow-synthetic-db-writes",
    "--allow-create-owned-database",
    "--fresh-container-id=" + id,
    "--database=" + db,
    "--output=/tmp/new",
  ];
  assert.equal(parseOwner202Arguments(a).database, db);
  assert.throws(() => parseOwner202Arguments([...a, a[0]]));
  assert.throws(() => parseOwner202Arguments([...a, "--allow-dirty"]));
});
const session = (pid, exitCode, end = undefined) => ({
  status: exitCode,
  timedOut: false,
  stdout: [
    JSON.stringify({ phase: "started", pid, at: 100 }),
    ...(end ? [JSON.stringify({ phase: "committed", pid, at: end })] : []),
  ].join("\n"),
  stderr: exitCode ? "ERROR:  23505" : "",
});
test("owner202 proves two different overlapping connections, one committed winner and one duplicate loser", () => {
  assert.doesNotThrow(() =>
    assertOwner202SessionProof([session(1, 0, 500), session(2, 3)]),
  );
  for (const rows of [
    [session(1, 0, 500), session(1, 3)],
    [session(1, 0, 500), session(2, 0, 510)],
    [session(1, 0, 500), { ...session(2, 3), stderr: "23514" }],
    [session(1, 0, 50), session(2, 3)],
  ])
    assert.throws(() => assertOwner202SessionProof(rows));
});
test("owner202 refuses schema dump database escapes and COPY row payloads", () => {
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      "-- PostgreSQL database dump" +
        " ".repeat(100) +
        "\nCREATE TABLE public.x(id uuid);",
    ),
  );
  for (const s of [
    "\\connect postgres",
    "CREATE DATABASE postgres;",
    "ALTER DATABASE postgres SET search_path=public;",
    "COPY auth.users FROM stdin;",
    "\\! bad",
  ])
    assert.throws(() => assertOwner202Dump(s));
});
test("owner202 SQL contains only synthetic auth insertion in a bounded transaction, correct user metadata", () => {
  const sql = owner202SessionSql(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "owner202-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@synthetic.invalid",
  );
  assert.match(sql, /statement_timeout='15000ms'/);
  assert.match(sql, /raw_user_meta_data/);
  assert.match(sql, /'identity_flow','OWNER_ADMIN_PROVISION_V1'/);
  assert.doesNotMatch(sql, /update|delete|withdrawal|wallet/i);
  assert.throws(() =>
    owner202SessionSql("';drop database postgres;--", "x", "x"),
  );
});
