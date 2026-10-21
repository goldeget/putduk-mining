import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseOwner202Arguments,
  assertOwner202SessionProof,
  assertOwner202Dump,
  owner202SessionSql,
  owner202ChildEnvironment,
  readOwner202DockerTarget,
  owner202PsqlArguments,
  owner202DumpArguments,
  owner202ChildFailure,
  recordOwner202ChildFailure,
  assertOwner202RestoreRoleAdmission,
  owner202RestorePsqlArguments,
  OWNER202_RESTORE_ROLE_SQL,
  OWNER202_OWNED_PUBLIC_SQL,
  assertOwner202OwnedPublicAdmission,
} from "./owner-admin-202-concurrency.mjs";
const id = "a".repeat(64),
  db = "putduk_owner202_" + "b".repeat(32);
const project = "putduk-mining-ci-r2-20261009",
  now = Date.parse("2026-10-21T00:10:00Z");
test("owner202 preserves only an empty initdb public schema in the exact new owned database", () => {
  const proof = {
    database: db,
    user: "postgres",
    schema: "public",
    owner: "pg_database_owner",
    relations: 0,
    functions: 0,
  };
  assert.deepEqual(assertOwner202OwnedPublicAdmission(proof, db), proof);
  for (const change of [
    { database: "postgres" },
    { user: "supabase_admin" },
    { schema: "auth" },
    { owner: null },
    { owner: "postgres" },
    { relations: 1 },
    { functions: 1 },
    { relations: "0" },
    { functions: -1 },
    { secret: "must-not-copy" },
  ])
    assert.throws(() =>
      assertOwner202OwnedPublicAdmission({ ...proof, ...change }, db),
    );
  for (const value of [null, [], {}])
    assert.throws(() => assertOwner202OwnedPublicAdmission(value, db));
  for (const target of ["postgres", "template0", "foreign", [db]])
    assert.throws(() => assertOwner202OwnedPublicAdmission(proof, target));
});
test("owner202 public precondition reads owner, relation and function metadata without recreating or dropping schema", () => {
  assert.match(OWNER202_OWNED_PUBLIC_SQL, /^begin read only;/);
  assert.match(OWNER202_OWNED_PUBLIC_SQL, /nspname='public'/);
  assert.match(OWNER202_OWNED_PUBLIC_SQL, /pg_class/);
  assert.match(OWNER202_OWNED_PUBLIC_SQL, /pg_proc/);
  assert.match(OWNER202_OWNED_PUBLIC_SQL, /rollback;$/);
  assert.doesNotMatch(
    OWNER202_OWNED_PUBLIC_SQL,
    /\b(?:grant|revoke|insert|update|delete|create|alter|drop)\b/i,
  );
});
test("owner202 admits only the existing login superuser and original auth owner before fencing", () => {
  const proof = {
    database: "postgres",
    user: "postgres",
    restoreRole: "supabase_admin",
    canLogin: true,
    superuser: true,
    authSchemaOwner: "supabase_admin",
  };
  assert.deepEqual(assertOwner202RestoreRoleAdmission(proof), proof);
  assert.match(OWNER202_RESTORE_ROLE_SQL, /^begin read only;/);
  assert.match(OWNER202_RESTORE_ROLE_SQL, /rolname='supabase_admin'/);
  assert.doesNotMatch(
    OWNER202_RESTORE_ROLE_SQL,
    /\b(?:grant|revoke|insert|update|delete|create|alter|drop)\b/i,
  );
  for (const change of [
    { database: db },
    { user: "supabase_admin" },
    { restoreRole: "postgres" },
    { canLogin: false },
    { superuser: false },
    { superuser: "true" },
    { authSchemaOwner: "postgres" },
    { secret: "must-not-copy" },
  ])
    assert.throws(() =>
      assertOwner202RestoreRoleAdmission({ ...proof, ...change }),
    );
  for (const value of [null, [], {}, { ...proof, canLogin: undefined }])
    assert.throws(() => assertOwner202RestoreRoleAdmission(value));
});
test("owner202 restore alone uses the fixed system role in the exact owned database and local socket", () => {
  const original = owner202PsqlArguments(id, db),
    restore = owner202RestorePsqlArguments(id, db),
    expected = [...original];
  expected[expected.indexOf("-U") + 1] = "supabase_admin";
  assert.deepEqual(restore, expected);
  assert.equal(original[original.indexOf("-U") + 1], "postgres");
  assert.equal(
    owner202PsqlArguments(id, "postgres")[original.indexOf("-U") + 1],
    "postgres",
  );
  for (const database of [
    "postgres",
    "template0",
    "foreign",
    db + ";SELECT 1",
    "putduk_owner202_" + "a".repeat(31),
  ])
    assert.throws(() => owner202RestorePsqlArguments(id, database));
  for (const container of ["foreign", "a".repeat(63), id + " --user root"])
    assert.throws(() => owner202RestorePsqlArguments(container, db));
  assert.throws(() => owner202RestorePsqlArguments([id], db));
  assert.throws(() => owner202RestorePsqlArguments(id, [db]));
  assert.throws(() => owner202RestorePsqlArguments(id, db, "postgres"));
});
test("owner202 child failure diagnostics retain only stage and bounded process/SQLSTATE fields", () => {
  const result = {
    status: 3,
    signal: "SIGTERM",
    error: { code: "ETIMEDOUT", message: "private-key-must-not-leak" },
    stdout: "private SQL and row contents",
    stderr:
      "psql:<stdin>:17: ERROR:  42501\nDETAIL: private@example.invalid\nSQL: private SQL",
  };
  assert.deepEqual(owner202ChildFailure("RESTORE_OWNED_SCHEMA", result), {
    version: 1,
    state: "FAILED_NOT_ACCEPTED_NO_RETRY",
    stage: "RESTORE_OWNED_SCHEMA",
    status: 3,
    signal: "SIGTERM",
    errorCode: "ETIMEDOUT",
    sqlStates: ["42501"],
  });
  const dirty = owner202ChildFailure("CREATE_OWNED_DATABASE", {
    status: "private-status",
    signal: "PRIVATE_SIGNAL",
    error: { code: "PRIVATE_CODE" },
    stderr:
      "ERROR:  42501 secret suffix\nDETAIL: ERROR: 42P01\nERROR: abcde\nERROR: 123456\nFATAL:  28P01\nERROR:  28P01",
  });
  assert.equal(dirty.status, null);
  assert.equal(dirty.signal, null);
  assert.equal(dirty.errorCode, null);
  assert.deepEqual(dirty.sqlStates, ["28P01"]);
  assert.throws(() => owner202ChildFailure("private arbitrary stage", result));
  assert.doesNotMatch(
    JSON.stringify([dirty, owner202ChildFailure("OWNED_COUNTS", result)]),
    /private|DETAIL|SQL:|stdout|stderr/,
  );
});
test("owner202 diagnostic receipt is create-only and cannot replace original failure evidence", () => {
  const output = mkdtempSync(join(tmpdir(), "putduk-owner202-diagnostic-"));
  try {
    recordOwner202ChildFailure(output, "OWNED_PUBLIC_PREFLIGHT", {
      status: 1,
      stderr: "ERROR:  42501\nsecret SQL",
    });
    const file = join(output, "child-failure.json"),
      original = readFileSync(file, "utf8");
    assert.equal(JSON.parse(original).stage, "OWNED_PUBLIC_PREFLIGHT");
    assert.doesNotMatch(original, /secret SQL/);
    assert.throws(
      () => recordOwner202ChildFailure(output, "OWNED_COUNTS", { status: 9 }),
      { code: "EEXIST" },
    );
    assert.equal(readFileSync(file, "utf8"), original);
  } finally {
    rmSync(output, { recursive: true });
  }
});
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
const schemaDump = (sql) =>
  "-- synthetic schema-only fixture\n" + " ".repeat(100) + "\n" + sql;
test("owner202 ignores COPY and psql-like text inside matching dollar-quoted routine bodies", () => {
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      schemaDump(String.raw`
CREATE FUNCTION public.synthetic() RETURNS void LANGUAGE plpgsql AS $routine$
COPY synthetic prose inside a routine body;
CREATE DATABASE synthetic_prose;
\! synthetic body text
$other$ does not close this body
$routine$;
CREATE TABLE public.safe(id uuid);`),
    ),
  );
});
test("owner202 masks nested comments, doubled quotes and quoted identifiers without losing boundaries", () => {
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      schemaDump(String.raw`
/* outer /* COPY synthetic FROM stdin; */
\connect synthetic
DROP DATABASE synthetic;
*/
-- \! synthetic comment
SELECT 'doubled '' quote
COPY synthetic prose', "identifier""with
\! quoted identifier";
CREATE TABLE public."copy"(id uuid);`),
    ),
  );
});
test("owner202 supports E-string escapes while ordinary backslashes cannot hide active commands", () => {
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      schemaDump(String.raw`
SELECT E'escaped \' quote
COPY synthetic prose
\! quoted text';`),
    ),
  );
  for (const sql of [
    String.raw`SELECT '\'; \! synthetic`,
    String.raw`SELECT nameE'\'; \connect synthetic`,
    String.raw`SELECT 'safe';COPY synthetic FROM stdin;`,
    String.raw`SELECT $a$safe$a$;DROP DATABASE synthetic;`,
  ])
    assert.throws(() => assertOwner202Dump(schemaDump(sql)));
});
test("owner202 rejects active COPY and database commands across statement and comment boundaries", () => {
  for (const sql of [
    "SELECT 1;COPY synthetic FROM stdin;",
    "SELECT 1; /* harmless */ copy synthetic TO stdout;",
    "SELECT 1;CREATE/* harmless */DATABASE synthetic;",
    "SELECT 1;ALTER\nDATABASE synthetic SET search_path=public;",
    "/* harmless */DROP DATABASE synthetic;",
  ])
    assert.throws(() => assertOwner202Dump(schemaDump(sql)));
});
test("owner202 allows only one exact matching restrict/unrestrict token pair", () => {
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      schemaDump(String.raw`\restrict SafeToken123
CREATE TABLE public.safe(id uuid);
\unrestrict SafeToken123`),
    ),
  );
  for (const sql of [
    String.raw`\connect synthetic`,
    String.raw`SELECT 1;\! synthetic`,
    String.raw`\restrict SafeToken123 \! synthetic`,
    String.raw`\restrict SafeToken123;`,
    String.raw`\restrict bad-token`,
    String.raw`\restrict SafeToken123
\unrestrict SafeToken123 \! synthetic`,
    String.raw`\unrestrict SafeToken123`,
    String.raw`\restrict SafeToken123`,
    String.raw`\restrict SafeToken123
\unrestrict OtherToken123`,
    String.raw`\restrict SafeToken123
\restrict SafeToken123
\unrestrict SafeToken123`,
  ])
    assert.throws(() => assertOwner202Dump(schemaDump(sql)));
});
test("owner202 preserves pg_dump ordinary-string semantics and rejects changes away from on", () => {
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      schemaDump("SET standard_conforming_strings = on; SELECT '\\';"),
    ),
  );
  for (const sql of [
    "SET standard_conforming_strings = off;",
    "SET SESSION standard_conforming_strings TO off;",
    "SET LOCAL standard_conforming_strings = 'off';",
    "RESET standard_conforming_strings;",
    "RESET ALL;",
  ])
    assert.throws(() => assertOwner202Dump(schemaDump(sql)));
});
test("owner202 rejects quoted SET and RESET names that hide lexical mode changes", () => {
  for (const sql of [
    'SET "standard_conforming_strings" = off;',
    'SET"standard_conforming_strings"=off;',
    'SET SESSION /* synthetic */ "standard_conforming_strings" TO off;',
    'SET LOCAL U&"standard_conforming_strings" = off;',
    String.raw`SET U&"standard\005fconforming_strings" = off;`,
    'RESET "standard_conforming_strings";',
  ])
    assert.throws(() => assertOwner202Dump(schemaDump(sql)));
});
test("owner202 permits only the exact active pg_dump search_path set_config call", () => {
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      schemaDump(
        "-- pg_dump prologue\nSELECT pg_catalog.set_config('search_path', '', false);",
      ),
    ),
  );
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      schemaDump(
        "\\restrict SafeToken123\r\nSELECT pg_catalog.set_config('search_path', '', false);\r\n\\unrestrict SafeToken123",
      ),
    ),
  );
  for (const sql of [
    "SELECT pg_catalog.set_config('standard_conforming_strings', 'off', false);",
    "SELECT set_config('standard_conforming_strings', 'off', false);",
    `SELECT pg_catalog."set_config"('standard_conforming_strings', 'off', false);`,
    `SELECT "pg_catalog"."set_config"('standard_conforming_strings', 'off', false);`,
    String.raw`SELECT pg_catalog.U&"set\005fconfig"('standard_conforming_strings', 'off', false);`,
    "SELECT pg_catalog.set_config('search_path', 'synthetic', false);",
    "SELECT pg_catalog.set_config('search_path', '', true);",
    "SELECT pg_catalog.set_config('search_path', '', false), set_config('standard_conforming_strings', 'off', false);",
  ])
    assert.throws(() => assertOwner202Dump(schemaDump(sql)));
});
test("owner202 rejects active anonymous DO while quoted routine and comment prose stays inert", () => {
  for (const sql of [
    "DO $$ BEGIN COPY synthetic FROM stdin; END $$;",
    "SELECT 1; /* synthetic */ DO LANGUAGE plpgsql $$ BEGIN NULL; END $$;",
    "DO 'BEGIN NULL; END';",
  ])
    assert.throws(() => assertOwner202Dump(schemaDump(sql)));
  assert.doesNotThrow(() =>
    assertOwner202Dump(
      schemaDump(String.raw`
-- SELECT set_config('standard_conforming_strings', 'off', false);
CREATE FUNCTION public.synthetic_prose() RETURNS void LANGUAGE plpgsql AS $body$
DO synthetic prose
SELECT pg_catalog.set_config('standard_conforming_strings', 'off', false);
$body$;
SELECT 'set_config(';
`),
    ),
  );
});
test("owner202 fails closed on unterminated strings, identifiers, dollar quotes and nested comments", () => {
  for (const sql of [
    "SELECT 'unterminated",
    String.raw`SELECT E'escaped \'`,
    'SELECT "unterminated',
    "SELECT $tag$unterminated $other$;",
    "/* outer /* inner */ still open",
  ])
    assert.throws(() => assertOwner202Dump(schemaDump(sql)));
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
