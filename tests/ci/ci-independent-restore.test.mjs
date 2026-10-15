import test from "node:test";
import assert from "node:assert/strict";
import {
  admitSource,
  admitOwnedTarget,
  assertSameEpoch,
  assertUnprivileged,
  assertSupportedFilesystem,
  buildRoleBootstrap,
  buildSupplement,
  buildDatabaseAcl,
} from "../../scripts/ci-independent-restore.mjs";

const id = "a".repeat(64),
  image = `sha256:${"b".repeat(64)}`;
const source = () => ({
  Id: id,
  Name: "/supabase_db_putduk-mining-ci-r2-20261009",
  Image: image,
  Config: {
    Labels: { "com.supabase.cli.project": "putduk-mining-ci-r2-20261009" },
  },
  State: { Running: true },
  Mounts: [
    {
      Type: "volume",
      Name: "source-volume",
      Destination: "/var/lib/postgresql/data",
    },
  ],
});
const expected = {
  id: "c".repeat(64),
  image,
  name: "putduk-mining-restore-123-1-abc",
  nonce: "nonce",
  run: "123-1",
  volume: "putduk-mining-restore-123-1-abc-data",
  command: "owned-command",
};
const target = () => ({
  Id: expected.id,
  Name: `/${expected.name}`,
  Image: image,
  Config: {
    Entrypoint: ["/bin/sh"],
    Cmd: ["-c", expected.command],
    Healthcheck: { Test: ["NONE"] },
    Labels: {
      "putduk.owner": "ci-independent-restore",
      "putduk.nonce": "nonce",
      "putduk.run": "123-1",
    },
  },
  HostConfig: {
    NetworkMode: "none",
    ReadonlyRootfs: true,
    PortBindings: {},
    GroupAdd: null,
    Memory: 268435456,
    MemorySwap: 268435456,
    PidsLimit: 64,
    NanoCpus: 500000000,
    CapAdd: ["CHOWN", "FOWNER", "SETUID", "SETGID"],
    CapDrop: ["ALL"],
    SecurityOpt: ["no-new-privileges"],
    LogConfig: {
      Type: "local",
      Config: { "max-size": "10m", "max-file": "1" },
    },
  },
  Mounts: [
    {
      Type: "volume",
      Name: expected.volume,
      Destination: "/restore",
      RW: true,
    },
  ],
});
test("exact fresh CI project and full content image are admitted", () =>
  assert.equal(admitSource(source()).Image, image));
for (const [name, mutate] of [
  ["wrong source name", (x) => (x.Name = "/supabase_db_other")],
  [
    "wrong project label",
    (x) => (x.Config.Labels["com.supabase.cli.project"] = "other"),
  ],
  ["noncontent image", (x) => (x.Image = "postgres:17")],
  ["short container ID", (x) => (x.Id = "abc")],
])
  test(`reject ${name}`, () => {
    const x = source();
    mutate(x);
    assert.throws(() => admitSource(x));
  });
test("cleanup accepts exact owned independent target", () =>
  assert.equal(admitOwnedTarget(target(), expected, source()).Id, expected.id));
for (const [name, mutate] of [
  ["wrong nonce", (x) => (x.Config.Labels["putduk.nonce"] = "other")],
  ["wrong image", (x) => (x.Image = `sha256:${"d".repeat(64)}`)],
  ["source volume attached", (x) => (x.Mounts[0].Name = "source-volume")],
  [
    "extra mount",
    (x) => x.Mounts.push({ Type: "bind", Source: "/etc", Destination: "/etc" }),
  ],
  ["network enabled", (x) => (x.HostConfig.NetworkMode = "bridge")],
  ["supplementary group", (x) => (x.HostConfig.GroupAdd = ["0"])],
  ["extra capability", (x) => x.HostConfig.CapAdd.push("SYS_ADMIN")],
  ["altered command", (x) => (x.Config.Cmd = ["-c", "other-command"])],
  ["missing no new privileges", (x) => (x.HostConfig.SecurityOpt = [])],
])
  test(`cleanup rejects ${name}`, () => {
    const x = target();
    mutate(x);
    assert.throws(() => admitOwnedTarget(x, expected, source()));
  });
test("source ID cannot be cleaned even with forged labels", () => {
  const x = target();
  x.Id = id;
  assert.throws(() => admitOwnedTarget(x, { ...expected, id }, source()));
});
test("source epoch and independent system ID are mandatory", () => {
  const a = { system_identifier: "11", catalog: "x", data: "y" };
  assertSameEpoch(a, { ...a }, "12");
  assert.throws(() => assertSameEpoch(a, { ...a, data: "z" }, "12"));
  assert.throws(() => assertSameEpoch(a, { ...a }, "11"));
});
test("UID/GID, group and capability proof fails closed", () => {
  const status =
    "Uid:\t100\t100\t100\t100\nGid:\t101\t101\t101\t101\nGroups:\t101\nCapEff:\t0000000000000000\n";
  assertUnprivileged(status, 100, 101);
  assertUnprivileged(status.replace("Groups:\t101", "Groups:\t"), 100, 101);
  for (const bad of [
    status.replace("CapEff:\t0000000000000000", "CapEff:\t0000000000000001"),
    status.replace("Groups:\t101", "Groups:\t101 0"),
    status.replace("100\t100\t100\t100", "0\t100\t100\t100"),
  ])
    assert.throws(() => assertUnprivileged(bad, 100, 101));
});
test("filesystem comes from actual stat token", () => {
  assertSupportedFilesystem("ext2/ext3");
  assertSupportedFilesystem("ext4");
  for (const token of ["vfat", "overlayfs", "", "unknown"])
    assert.throws(() => assertSupportedFilesystem(token));
});
test("bootstrap only reviewed nonsecret roles and sole superuser", () => {
  const roles = [
    {
      name: "supabase_admin",
      superuser: true,
      login: true,
      inherit: true,
      create_db: true,
      create_role: true,
      replication: true,
      bypass_rls: true,
      connection_limit: -1,
      valid_until: null,
    },
    {
      name: "postgres",
      superuser: false,
      login: true,
      inherit: true,
      create_db: true,
      create_role: true,
      replication: true,
      bypass_rls: true,
      connection_limit: -1,
      valid_until: null,
    },
  ];
  const sql = buildRoleBootstrap(roles, []);
  assert.match(sql, /CREATE ROLE "postgres"/);
  assert.doesNotMatch(sql, /PASSWORD/i);
  assert.throws(() =>
    buildRoleBootstrap([...roles, { ...roles[1], name: "unreviewed" }], []),
  );
  assert.throws(() =>
    buildRoleBootstrap(
      roles.map((x) => ({ ...x, superuser: true })),
      [],
    ),
  );
});
test("supplement cannot invent a missing or untrusted source contract", () => {
  assert.throws(() =>
    buildSupplement(
      { functions: [], namespaces: [] },
      { functions: [], namespaces: [] },
    ),
  );
});
function supplementFixture() {
  const grants = [
    "supabase_admin",
    "postgres",
    "anon",
    "authenticated",
    "service_role",
    "supabase_functions_admin",
  ].map((grantee) => ({
    grantor: "supabase_admin",
    grantee,
    privilege: "EXECUTE",
    grantable: false,
  }));
  const functions = [
    {
      schema: "net",
      name: "http_get",
      args: "url text, params jsonb, headers jsonb, timeout_milliseconds integer",
      body_sha256:
        "fac801ed417ff4ecda0f86a0bef9874d4b749fa34cc9000153aa4546b2cc8bac",
    },
    {
      schema: "net",
      name: "http_post",
      args: "url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer",
      body_sha256:
        "b7cde4add3ffb30c3a667d6038d223bbb03bac6cd5d181dab62f48c79c34f362",
    },
  ].map((x) => ({
    ...x,
    owner: "supabase_admin",
    binary_sha256: "0".repeat(64),
    definer: true,
    search_path_config: ["search_path=net"],
    grants: structuredClone(grants),
  }));
  const schemaGrants = [
    ...["CREATE", "USAGE"].map((privilege) => ({
      grantor: "supabase_admin",
      grantee: "supabase_admin",
      privilege,
      grantable: false,
    })),
    ...["postgres", "anon", "authenticated", "service_role"].map((grantee) => ({
      grantor: "supabase_admin",
      grantee,
      privilege: "USAGE",
      grantable: grantee === "postgres",
    })),
  ];
  const source = {
    functions,
    namespaces: [
      {
        schema: "net",
        owner: "supabase_admin",
        grants: [
          {
            grantor: "supabase_admin",
            grantee: "supabase_admin",
            privilege: "CREATE",
            grantable: false,
          },
        ],
      },
      ...["graphql", "graphql_public"].map((schema) => ({
        schema,
        owner: "supabase_admin",
        grants: structuredClone(schemaGrants),
      })),
    ],
  };
  const target = structuredClone(source);
  target.functions.forEach((x) => {
    x.definer = false;
    x.search_path_config = null;
  });
  target.namespaces
    .filter((x) => x.schema !== "net")
    .forEach((x) => {
      x.grants = x.grants.filter((g) => g.grantee === "supabase_admin");
    });
  return { source, target };
}
test("proven supplement restores only two net settings and missing schema USAGE", () => {
  const { source, target } = supplementFixture(),
    unchanged = structuredClone({ source, target }),
    sql = buildSupplement(source, target);
  assert.equal((sql.match(/SECURITY DEFINER;/g) ?? []).length, 2);
  assert.equal((sql.match(/SET search_path TO net;/g) ?? []).length, 2);
  assert.equal((sql.match(/GRANT USAGE ON SCHEMA/g) ?? []).length, 8);
  assert.equal((sql.match(/WITH GRANT OPTION/g) ?? []).length, 2);
  assert.doesNotMatch(
    sql,
    /CREATE EXTENSION|GRANT CREATE|SELECT|INSERT|UPDATE|DELETE/,
  );
  assert.deepEqual({ source, target }, unchanged);
});
test("supplement rejects altered bodies and source or target privilege expansion", () => {
  for (const mutate of [
    (x) => (x.source.functions[0].body_sha256 = "f".repeat(64)),
    (x) =>
      x.source.namespaces[0].grants.push({
        grantor: "supabase_admin",
        grantee: "anon",
        privilege: "CREATE",
        grantable: false,
      }),
    (x) =>
      x.target.namespaces[1].grants.push({
        grantor: "supabase_admin",
        grantee: "anon",
        privilege: "CREATE",
        grantable: false,
      }),
  ]) {
    const x = supplementFixture();
    mutate(x);
    assert.throws(() => buildSupplement(x.source, x.target));
  }
});
const databaseFixture = () => ({
  owner: "postgres",
  grants: [
    ...["CREATE", "CONNECT", "TEMPORARY"].map((privilege) => ({
      grantor: "postgres",
      grantee: "postgres",
      privilege,
      grantable: false,
    })),
    {
      grantor: "postgres",
      grantee: "PUBLIC",
      privilege: "CONNECT",
      grantable: false,
    },
    {
      grantor: "postgres",
      grantee: "dashboard_user",
      privilege: "CREATE",
      grantable: false,
    },
  ],
});
test("database ACL reconstruction uses the proven owner and exact grants", () => {
  const database = databaseFixture(),
    unchanged = structuredClone(database),
    sql = buildDatabaseAcl(database);
  assert.match(sql, /SET ROLE "postgres"/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON DATABASE "postgres" FROM PUBLIC/);
  assert.match(sql, /GRANT CREATE ON DATABASE "postgres" TO "dashboard_user"/);
  assert.match(sql, /RESET ROLE/);
  assert.deepEqual(database, unchanged);
});
test("database ACL rejects unknown grantees, privileges and grantors", () => {
  for (const change of [
    { grantee: "other" },
    { privilege: "SELECT" },
    { grantor: "supabase_admin" },
    { grantee: "PUBLIC", privilege: "CREATE" },
  ]) {
    const x = databaseFixture();
    Object.assign(x.grants.at(-1), change);
    assert.throws(() => buildDatabaseAcl(x));
  }
});
