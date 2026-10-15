/** CI-local fresh201 backup/restore. Importing this module performs no I/O. */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  chmodSync,
  openSync,
  closeSync,
  statSync,
  unlinkSync,
  realpathSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";
import { assertBackend201CanonicalSources } from "./backend-successor-201-source.mjs";
import { readBackend201FreshCatalog } from "./backend-successor-201-catalog.mjs";
import { compareRestoreCatalogs } from "./lib/restore-catalog-compare.mjs";

const PROJECT = "putduk-mining-ci-r2-20261009";
const need = (value, code) => {
  if (!value) throw Error(`INDEPENDENT_RESTORE_${code}`);
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) =>
  Array.isArray(value)
    ? value.map(normalize)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, normalize(value[key])]),
        )
      : value;
const stable = (value) => JSON.stringify(normalize(value));
const same = (a, b) => stable(a) === stable(b);
const contentId = (x) => /^sha256:[a-f0-9]{64}$/.test(x ?? "");
const fullId = (x) => /^[a-f0-9]{64}$/.test(x ?? "");
const qi = (x) => '"' + String(x).replaceAll('"', '""') + '"';
const qs = (x) => "'" + String(x).replaceAll("'", "''") + "'";

export function admitSource(source) {
  need(fullId(source?.Id) && contentId(source.Image), "SOURCE_FULL_ID_IMAGE");
  need(
    source.Name === `/supabase_db_${PROJECT}` &&
      source.Config?.Labels?.["com.supabase.cli.project"] === PROJECT &&
      source.State?.Running === true,
    "SOURCE_PROJECT_IDENTITY",
  );
  need(
    Array.isArray(source.Mounts) && source.Mounts.length > 0,
    "SOURCE_MOUNTS_UNKNOWN",
  );
  return source;
}
export function buildTargetPreparation(uid, gid) {
  need(
    Number.isSafeInteger(uid) &&
      uid > 0 &&
      Number.isSafeInteger(gid) &&
      gid > 0,
    "TARGET_NATIVE_UID_GID",
  );
  return {
    rootCommand: `mkdir /restore/pgdata /restore/socket && chown ${uid}:${gid} /restore/pgdata /restore/socket && chmod 700 /restore/pgdata /restore/socket && test "$(stat -c '%u:%g:%a' /restore/pgdata)" = '${uid}:${gid}:700' && touch /restore/ready && chown ${uid}:${gid} /restore && chmod 700 /restore && exec sleep 160`,
    permissionUser: `${uid}:${gid}`,
  };
}
export function admitOwnedTarget(target, expected, source) {
  need(
    fullId(expected?.id) &&
      fullId(target?.Id) &&
      target.Id === expected.id &&
      target.Id !== source.Id,
    "OWN_TARGET_ID",
  );
  need(
    target.Name === `/${expected.name}` &&
      target.Image === expected.image &&
      target.Image === source.Image,
    "OWN_TARGET_NAME_IMAGE",
  );
  const labels = target.Config?.Labels;
  need(
    labels?.["putduk.owner"] === "ci-independent-restore" &&
      labels["putduk.nonce"] === expected.nonce &&
      labels["putduk.run"] === expected.run,
    "OWN_TARGET_LABELS",
  );
  const h = target.HostConfig;
  need(
    h?.NetworkMode === "none" &&
      h.ReadonlyRootfs === true &&
      !Object.keys(h.PortBindings ?? {}).length &&
      !h.GroupAdd?.length &&
      h.Memory === 268435456 &&
      h.MemorySwap === 268435456 &&
      h.PidsLimit === 64,
    "OWN_TARGET_SECURITY",
  );
  const requiredCaps = ["CHOWN", "FOWNER", "SETGID", "SETUID"];
  const normalizedCaps = Array.isArray(h.CapAdd)
    ? h.CapAdd.map((cap) =>
        requiredCaps.find((known) => cap === known || cap === `CAP_${known}`),
      )
    : [];
  need(
    normalizedCaps.length === 4 &&
      new Set(normalizedCaps).size === 4 &&
      same([...normalizedCaps].sort(), requiredCaps) &&
      same(h.CapDrop, ["ALL"]) &&
      h.SecurityOpt?.length === 1 &&
      ["no-new-privileges", "no-new-privileges=true"].includes(
        h.SecurityOpt[0],
      ) &&
      h.NanoCpus === 500000000,
    "OWN_TARGET_CAPABILITIES_CPU",
  );
  need(
    target.Config.User === "0:0" &&
      typeof expected.command === "string" &&
      same(target.Config.Entrypoint, ["/bin/sh"]) &&
      same(target.Config.Cmd, ["-c", expected.command]) &&
      same(target.Config.Healthcheck?.Test, ["NONE"]) &&
      same(h.LogConfig, {
        Type: "local",
        Config: { "max-size": "10m", "max-file": "1", compress: "false" },
      }),
    "OWN_TARGET_COMMAND_HEALTH_LOGS",
  );
  need(target.Mounts?.length === 1, "OWN_TARGET_MOUNT_COUNT");
  const mount = target.Mounts[0];
  need(
    mount.Type === "volume" &&
      mount.Name === expected.volume &&
      mount.Destination === "/restore" &&
      mount.RW === true &&
      !source.Mounts.some(
        (x) => x.Name === mount.Name || (x.Source && x.Source === mount.Source),
      ),
    "OWN_TARGET_MOUNT",
  );
  return target;
}
export function assertSameEpoch(before, after, targetSystemId) {
  need(
    /^\d+$/.test(before?.system_identifier ?? "") &&
      /^\d+$/.test(targetSystemId ?? "") &&
      before.system_identifier !== targetSystemId,
    "INDEPENDENT_SYSTEM_ID",
  );
  need(same(before, after), "SOURCE_EPOCH_CHANGED");
}
export function assertUnprivileged(status, uid, gid) {
  for (const [field, expected] of [
    ["Uid", uid],
    ["Gid", gid],
  ]) {
    const values = new RegExp(`^${field}:\\s*(.*)$`, "m")
      .exec(status)?.[1]
      .trim()
      .split(/\s+/);
    need(
      values?.length === 4 && values.every((x) => x === String(expected)),
      "TARGET_UID_GID",
    );
  }
  const groups = /^Groups:[ \t]*(.*)$/m.exec(status)?.[1].trim();
  need(
    groups !== undefined && (groups === "" || groups === String(gid)),
    "TARGET_GROUPS",
  );
  need(/^CapEff:[ \t]*0+\s*$/m.test(status), "TARGET_EFFECTIVE_CAPABILITIES");
}
export function assertSupportedFilesystem(token) {
  need(["ext2/ext3", "ext4"].includes(token), "UNSUPPORTED_FILESYSTEM");
}

// Reviewed nonsecret role attributes: login/inherit/createdb/createrole/superuser/replication/bypassrls.
const ROLE_FLAGS = Object.freeze({
  anon: "0100000",
  authenticated: "0100000",
  authenticator: "1000000",
  dashboard_user: "0111010",
  pgbouncer: "1100000",
  postgres: "1111011",
  service_role: "0100001",
  supabase_admin: "1111111",
  supabase_auth_admin: "1001000",
  supabase_etl_admin: "1100011",
  supabase_functions_admin: "1001000",
  supabase_privileged_role: "0100000",
  supabase_read_only_user: "1100001",
  supabase_realtime_admin: "0000000",
  supabase_replication_admin: "1100010",
  supabase_storage_admin: "1001000",
});
const ATTRS = [
  "login",
  "inherit",
  "create_db",
  "create_role",
  "superuser",
  "replication",
  "bypass_rls",
];
const NATIVE_ROLES = new Set([
  "pg_checkpoint",
  "pg_create_subscription",
  "pg_database_owner",
  "pg_execute_server_program",
  "pg_maintain",
  "pg_monitor",
  "pg_read_all_data",
  "pg_read_all_settings",
  "pg_read_all_stats",
  "pg_read_server_files",
  "pg_signal_backend",
  "pg_stat_scan_tables",
  "pg_use_reserved_connections",
  "pg_write_all_data",
  "pg_write_server_files",
]);
export function buildRoleBootstrap(roles, memberships) {
  need(Array.isArray(roles) && Array.isArray(memberships), "ROLE_EVIDENCE");
  need(
    new Set(roles.map((x) => x.name)).size === roles.length,
    "DUPLICATE_ROLE",
  );
  need(
    roles.filter((x) => x.superuser).length === 1 &&
      roles.find((x) => x.superuser)?.name === "supabase_admin",
    "SOLE_REVIEWED_SUPERUSER",
  );
  const statements = [];
  for (const role of roles) {
    need(
      typeof role.name === "string" && /^[a-z_]+$/.test(role.name),
      "ROLE_NAME",
    );
    if (role.name.startsWith("pg_")) {
      need(
        NATIVE_ROLES.has(role.name) &&
          ATTRS.every((key) => role[key] === (key === "inherit")) &&
          role.connection_limit === -1 &&
          role.valid_until === null,
        "UNREVIEWED_NATIVE_ROLE",
      );
      continue;
    }
    need(
      Object.hasOwn(ROLE_FLAGS, role.name) &&
        ATTRS.every(
          (key, i) =>
            typeof role[key] === "boolean" &&
            Number(role[key]) === Number(ROLE_FLAGS[role.name][i]),
        ) &&
        role.connection_limit === -1 &&
        role.valid_until === null,
      "UNREVIEWED_ROLE_ATTRIBUTES",
    );
    const flags = ATTRS.map(
      (key, i) =>
        (role[key] ? "" : "NO") +
        [
          "LOGIN",
          "INHERIT",
          "CREATEDB",
          "CREATEROLE",
          "SUPERUSER",
          "REPLICATION",
          "BYPASSRLS",
        ][i],
    ).join(" ");
    statements.push(
      `${role.name === "supabase_admin" ? "ALTER" : "CREATE"} ROLE ${qi(role.name)} ${flags} CONNECTION LIMIT -1;`,
    );
  }
  const names = new Set(roles.map((x) => x.name));
  for (const m of memberships) {
    need(
      names.has(m.member) &&
        names.has(m.granted_role) &&
        m.grantor === "supabase_admin" &&
        m.granted_role !== "supabase_admin" &&
        ["admin_option", "inherit_option", "set_option"].every(
          (k) => typeof m[k] === "boolean",
        ),
      "UNREVIEWED_ROLE_MEMBERSHIP",
    );
    // Separate options avoid dependence on the multi-option GRANT synopsis.
    for (const [option, key] of [
      ["ADMIN", "admin_option"],
      ["INHERIT", "inherit_option"],
      ["SET", "set_option"],
    ])
      statements.push(
        `GRANT ${qi(m.granted_role)} TO ${qi(m.member)} WITH ${option} ${String(m[key]).toUpperCase()} GRANTED BY "supabase_admin";`,
      );
  }
  return "BEGIN;\n" + statements.join("\n") + "\nCOMMIT;";
}
const NET = Object.freeze({
  http_get: {
    args: "url text, params jsonb, headers jsonb, timeout_milliseconds integer",
    types: "text,jsonb,jsonb,integer",
    body: "fac801ed417ff4ecda0f86a0bef9874d4b749fa34cc9000153aa4546b2cc8bac",
  },
  http_post: {
    args: "url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer",
    types: "text,jsonb,jsonb,jsonb,integer",
    body: "b7cde4add3ffb30c3a667d6038d223bbb03bac6cd5d181dab62f48c79c34f362",
  },
});
const sortedGrants = (grants) => (grants ?? []).map(stable).sort();
export function buildDatabaseAcl(database) {
  need(
    database?.owner === "postgres" &&
      Array.isArray(database.grants) &&
      database.grants.length > 0,
    "DATABASE_ACL_SOURCE_EVIDENCE",
  );
  const seen = new Set();
  for (const grant of database.grants) {
    need(
      grant.grantor === "postgres" &&
        (grant.grantee === "PUBLIC" ||
          Object.hasOwn(ROLE_FLAGS, grant.grantee)) &&
        ["CREATE", "CONNECT", "TEMPORARY"].includes(grant.privilege) &&
        typeof grant.grantable === "boolean",
      "DATABASE_ACL_REVIEWED_GRANT",
    );
    const privileged = [
      "postgres",
      "supabase_admin",
      "dashboard_user",
    ].includes(grant.grantee);
    const provenBootstrapCreate =
      grant.privilege === "CREATE" &&
      grant.grantable === false &&
      ["supabase_etl_admin", "supabase_storage_admin"].includes(grant.grantee);
    need(
      (grant.privilege !== "CREATE" || privileged || provenBootstrapCreate) &&
        (!grant.grantable || privileged),
      "DATABASE_ACL_UNTRUSTED_PRIVILEGE",
    );
    const key = stable(grant);
    need(!seen.has(key), "DATABASE_ACL_DUPLICATE_GRANT");
    seen.add(key);
  }
  need(
    ["CREATE", "CONNECT", "TEMPORARY"].every((privilege) =>
      database.grants.some(
        (g) => g.grantee === "postgres" && g.privilege === privilege,
      ),
    ),
    "DATABASE_OWNER_PRIVILEGES",
  );
  const statements = [
    "BEGIN;",
    'SET ROLE "postgres";',
    `REVOKE ALL PRIVILEGES ON DATABASE "postgres" FROM PUBLIC, ${Object.keys(ROLE_FLAGS).sort().map(qi).join(", ")};`,
  ];
  for (const grant of [...database.grants].sort((a, b) =>
    stable(a).localeCompare(stable(b)),
  ))
    statements.push(
      `GRANT ${grant.privilege} ON DATABASE "postgres" TO ${grant.grantee === "PUBLIC" ? "PUBLIC" : qi(grant.grantee)}${grant.grantable ? " WITH GRANT OPTION" : ""} GRANTED BY "postgres";`,
    );
  return [...statements, "RESET ROLE;", "COMMIT;"].join("\n");
}
const schemaGrants = () => [
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
export function buildSupplement(source, target) {
  const sql = [];
  for (const [name, pin] of Object.entries(NET)) {
    const a = source.functions?.filter(
        (x) => x.schema === "net" && x.name === name,
      ),
      b = target.functions?.filter(
        (x) => x.schema === "net" && x.name === name,
      );
    need(a?.length === 1 && b?.length === 1, "NET_FUNCTION_EVIDENCE");
    const s = a[0],
      t = b[0];
    need(
      s.args === pin.args &&
        t.args === s.args &&
        s.owner === "supabase_admin" &&
        t.owner === s.owner &&
        s.body_sha256 === pin.body &&
        t.body_sha256 === pin.body &&
        s.binary_sha256 === t.binary_sha256 &&
        s.definer === true &&
        same(s.search_path_config, ["search_path=net"]) &&
        same(sortedGrants(s.grants), sortedGrants(t.grants)),
      "NET_SOURCE_CONTRACT",
    );
    const executeRoles = [
      "supabase_admin",
      "postgres",
      "anon",
      "authenticated",
      "service_role",
      "supabase_functions_admin",
    ];
    need(
      s.grants?.length === 6 &&
        s.grants.every(
          (g) =>
            g.grantor === "supabase_admin" &&
            executeRoles.includes(g.grantee) &&
            g.privilege === "EXECUTE" &&
            !g.grantable,
        ),
      "NET_EXECUTE_GRANTS",
    );
    need(
      typeof t.definer === "boolean" &&
        (same(t.search_path_config, s.search_path_config) ||
          t.search_path_config === null ||
          same(t.search_path_config, [])),
      "UNEXPECTED_NET_TARGET_CONFIG",
    );
    if (!t.definer || !same(t.search_path_config, s.search_path_config)) {
      sql.push(
        `ALTER FUNCTION net.${name}(${pin.types}) SECURITY DEFINER;`,
        `ALTER FUNCTION net.${name}(${pin.types}) SET search_path TO net;`,
      );
    }
  }
  const net = source.namespaces?.find((x) => x.schema === "net");
  need(
    net?.owner === "supabase_admin" &&
      !(net.grants ?? []).some(
        (g) =>
          g.privilege === "CREATE" &&
          ["PUBLIC", "anon", "authenticated", "service_role"].includes(
            g.grantee,
          ),
      ),
    "NET_TRUSTED_SCHEMA_BOUNDARY",
  );
  for (const name of ["graphql", "graphql_public"]) {
    const s = source.namespaces?.find((x) => x.schema === name),
      t = target.namespaces?.find((x) => x.schema === name);
    need(
      s?.owner === "supabase_admin" &&
        t?.owner === s.owner &&
        same(sortedGrants(s.grants), sortedGrants(schemaGrants())),
      "GRAPHQL_SOURCE_CONTRACT",
    );
    const expected = new Set(sortedGrants(s.grants));
    need(
      (t.grants ?? []).every((g) => expected.has(stable(g))),
      "GRAPHQL_UNEXPECTED_TARGET_GRANT",
    );
    for (const g of s.grants)
      if (!(t.grants ?? []).some((x) => same(x, g))) {
        need(
          g.privilege === "USAGE" && g.grantee !== "supabase_admin",
          "GRAPHQL_OWNER_GRANT_MISSING",
        );
        sql.push(
          `GRANT USAGE ON SCHEMA ${qi(name)} TO ${qi(g.grantee)}${g.grantable ? " WITH GRANT OPTION" : ""};`,
        );
      }
  }
  return "BEGIN;\n" + sql.join("\n") + "\nCOMMIT;";
}

const readOnly = (sql) =>
  `BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; SET LOCAL statement_timeout='15000ms'; SET LOCAL lock_timeout='2000ms'; SET LOCAL timezone='UTC'; ${sql}\nROLLBACK;`;
const hashSql = (expr) => `encode(sha256(convert_to(${expr},'UTF8')),'hex')`;
const grantsSql = (acl, defaults) =>
  `(select jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(x.grantor),'grantee',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'privilege',x.privilege_type,'grantable',x.is_grantable) order by pg_get_userbyid(x.grantor),case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) from aclexplode(${defaults ? `coalesce(${acl},${defaults})` : acl}) x)`;
const NS = "n.nspname not like 'pg_%' and n.nspname<>'information_schema'";
const CATALOG_SQL = readOnly(`with functions as (
 select n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) args,pg_get_userbyid(p.proowner) owner,p.prosecdef definer,p.provolatile volatility,
 ${hashSql("coalesce(p.proconfig::text,'')")} config_sha256,${hashSql("pg_get_functiondef(p.oid)")} definition_sha256,${hashSql("p.prosrc")} body_sha256,${hashSql("coalesce(p.probin,'')")} binary_sha256,
 (select jsonb_agg(v order by v) from unnest(p.proconfig) v where v like 'search_path=%') search_path_config,p.proacl::text raw_acl,
 (select e.extname from pg_extension e join pg_depend d on d.refobjid=e.oid and d.refclassid='pg_extension'::regclass where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e') extension,
 ${grantsSql("p.proacl", "acldefault('f',p.proowner)")} grants from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${NS} and p.prokind<>'a'
), relations as (
 select n.nspname schema,c.relname name,c.relkind relation_kind,pg_get_userbyid(c.relowner) owner,c.relrowsecurity rls,c.relforcerowsecurity force_rls,c.relacl::text raw_acl,
 ${grantsSql("c.relacl", `acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner)`)} grants from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${NS}
), columns_set as (
 select n.nspname schema,c.relname relation,a.attname name,a.attnum ordinal,format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,a.attidentity identity_kind,a.attgenerated generated_kind,${hashSql("coalesce(pg_get_expr(d.adbin,d.adrelid),'')")} default_sha256,a.attacl::text raw_acl,${grantsSql("a.attacl")} grants
 from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where ${NS} and a.attnum>0 and not a.attisdropped
), namespaces as (
 select n.nspname schema,pg_get_userbyid(n.nspowner) owner,n.nspacl::text raw_acl,${grantsSql("n.nspacl", "acldefault('n',n.nspowner)")} grants from pg_namespace n where ${NS}
) select jsonb_build_object('database',current_database(),'role',current_user,'server_version',current_setting('server_version'),'system_identifier',(select system_identifier::text from pg_control_system()),
 'functions',coalesce((select jsonb_agg(to_jsonb(f) order by schema,name,args) from functions f),'[]'::jsonb),
 'relations',coalesce((select jsonb_agg(to_jsonb(r) order by schema,name) from relations r),'[]'::jsonb),
 'columns',coalesce((select jsonb_agg(to_jsonb(c) order by schema,relation,ordinal) from columns_set c),'[]'::jsonb),
 'namespaces',coalesce((select jsonb_agg(to_jsonb(s) order by schema) from namespaces s),'[]'::jsonb))::text;`);
const ROLE_SQL = readOnly(`select jsonb_build_object(
 'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'create_db',rolcreatedb,'create_role',rolcreaterole,'superuser',rolsuper,'replication',rolreplication,'bypass_rls',rolbypassrls,'connection_limit',rolconnlimit,'valid_until',rolvaliduntil) order by rolname) from pg_roles),
 'memberships',(select jsonb_agg(jsonb_build_object('granted_role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin_option',admin_option,'inherit_option',inherit_option,'set_option',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)) from pg_auth_members),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'database',(select jsonb_build_object('owner',pg_get_userbyid(datdba),'encoding',pg_encoding_to_char(encoding),'collate',datcollate,'ctype',datctype,'grants',${grantsSql("datacl", "acldefault('d',datdba)")}) from pg_database where datname=current_database()))::text;`);
const DETAILS_SQL = readOnly(`select jsonb_build_object(
 'dropped_columns',coalesce((select jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'ordinal',a.attnum) order by n.nspname,c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where ${NS} and a.attisdropped),'[]'::jsonb),
 'constraints',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true)) order by n.nspname,c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where ${NS}),
 'policies',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,p.polname,p.polcmd,p.polpermissive,(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by n.nspname,c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where ${NS}),
 'indexes',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,i.relname,x.indisvalid,x.indisready,pg_get_indexdef(x.indexrelid)) order by n.nspname,c.relname,i.relname) from pg_index x join pg_class c on c.oid=x.indrelid join pg_class i on i.oid=x.indexrelid join pg_namespace n on n.oid=c.relnamespace where ${NS}),
 'triggers',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true)) order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${NS} and not t.tgisinternal),
 'default_privileges',(select jsonb_agg(jsonb_build_array(pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype,${grantsSql("d.defaclacl")}) order by pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace),
 'ledger_unbalanced',(select count(*) from (select t.id from public.ledger_transactions t left join public.ledger_entries e on e.transaction_id=t.id group by t.id having count(e.id)<2 or coalesce(sum(e.amount_atomic) filter(where e.side='DEBIT'),0)<>coalesce(sum(e.amount_atomic) filter(where e.side='CREDIT'),0)) x),
 'direct_money_writes',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where n.nspname='public' and c.relname in ('wallet_accounts','wallet_ledger','ledger_transactions','ledger_entries','money_source_movements') and x.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE') and (x.grantee=0 or pg_get_userbyid(x.grantee) in ('anon','authenticated'))))::text;`);

function assertCatalogComparison(comparison) {
  for (const d of comparison.differences) {
    need(
      d.status === "CHANGED" &&
        !d.securityFields.length &&
        !d.missingEvidenceFields.length &&
        d.rawFields.every(
          (x) =>
            d.representationFields.includes(x.field) ||
            (x.field === "ordinal" &&
              d.ordinalExplanation === "DROPPED_COLUMN_HOLES"),
        ),
      "CATALOG_SEMANTIC_DIFFERENCE",
    );
  }
}
const fingerprint = (catalog) =>
  Object.fromEntries(
    ["functions", "relations", "columns", "namespaces"].map((k) => [
      `${k}_sha256`,
      sha(stable(catalog[k])),
    ]),
  );
const CONTAINER_FORMAT =
  '{"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Config":{"User":{{json .Config.User}},"Entrypoint":{{json .Config.Entrypoint}},"Cmd":{{json .Config.Cmd}},"Healthcheck":{{json (index .Config "Healthcheck")}},"Labels":{"com.supabase.cli.project":{{json (index .Config.Labels "com.supabase.cli.project")}},"putduk.owner":{{json (index .Config.Labels "putduk.owner")}},"putduk.nonce":{{json (index .Config.Labels "putduk.nonce")}},"putduk.run":{{json (index .Config.Labels "putduk.run")}}}},"State":{"Running":{{json .State.Running}}},"Mounts":{{json .Mounts}},"HostConfig":{"NetworkMode":{{json .HostConfig.NetworkMode}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"PortBindings":{{json .HostConfig.PortBindings}},"GroupAdd":{{json .HostConfig.GroupAdd}},"Memory":{{json .HostConfig.Memory}},"MemorySwap":{{json .HostConfig.MemorySwap}},"PidsLimit":{{json .HostConfig.PidsLimit}},"CapAdd":{{json .HostConfig.CapAdd}},"CapDrop":{{json .HostConfig.CapDrop}},"SecurityOpt":{{json .HostConfig.SecurityOpt}},"NanoCpus":{{json .HostConfig.NanoCpus}},"LogConfig":{{json .HostConfig.LogConfig}}}}';
const VOLUME_FORMAT =
  '{"Name":{{json .Name}},"Labels":{"putduk.owner":{{json (index .Labels "putduk.owner")}},"putduk.nonce":{{json (index .Labels "putduk.nonce")}},"putduk.run":{{json (index .Labels "putduk.run")}}}}';

export function runCiRestore() {
  const start = Date.now(),
    actionEnd = start + 160000,
    cleanupEnd = start + 180000;
  const report = {
    version: 1,
    state: "NOT_ACCEPTED",
    startedAt: new Date(start).toISOString(),
    sourceWrites: 0,
    sourceSafety: "UNKNOWN_UNTIL_FINAL_IDENTITY_AND_EPOCH",
    remoteOperations: 0,
    commands: [],
    cleanup: { state: "NOT_PROVISIONED" },
    limitations: [
      "FRESH_CI_SOURCE_NOT_PRESERVED_WINDOWS_ARCHIVE",
      "NO_ROLE_PASSWORD_OR_SECRET_SETTING_RECOVERY",
      "NO_REMOTE_STORAGE_OBJECT_OR_PRODUCTION_ACCEPTANCE",
    ],
  };
  let privateDir,
    archive,
    source,
    expected,
    createdVolume = false,
    volumeAttempted = false,
    createAttempted = false,
    containerId,
    bin,
    uid,
    gid;
  const safeEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/home/runner",
    LANG: "C.UTF-8",
  };
  const output = resolve("test-results/worker/independent-restore.json");
  const execute = (label, args, options = {}) => {
    const deadline = options.cleanup ? cleanupEnd : actionEnd;
    need(Date.now() < deadline, "EXECUTION_BUDGET_EXHAUSTED");
    need(
      options.input === undefined ||
        Buffer.byteLength(options.input) <= 2 * 1024 * 1024,
      "CLI_STDIN_SIZE_BOUND",
    );
    const index = report.commands.length,
      begun = Date.now();
    const r = spawnSync("docker", ["--context", "default", ...args], {
      env: safeEnv,
      encoding: options.stdoutFd === undefined ? "utf8" : undefined,
      input: options.input,
      stdio:
        options.stdoutFd === undefined
          ? undefined
          : [options.stdinFd ?? "pipe", options.stdoutFd, "pipe"],
      timeout: Math.max(
        1,
        Math.min(options.timeout ?? 30000, deadline - Date.now()),
      ),
      maxBuffer: 32 * 1024 * 1024,
      killSignal: "SIGKILL",
    });
    const stdout = r.stdout ?? "",
      stderr = r.stderr ?? "";
    if (privateDir) {
      writeFileSync(join(privateDir, `${index}-${label}.stderr`), stderr, {
        mode: 0o600,
      });
      if (options.stdoutFd === undefined)
        writeFileSync(join(privateDir, `${index}-${label}.stdout`), stdout, {
          mode: 0o600,
        });
    }
    const errorCategories = [
      [/permission denied/i, "PERMISSION_DENIED"],
      [/must be (?:owner|superuser)/i, "OWNERSHIP_OR_SUPERUSER_REQUIRED"],
      [/does not exist/i, "MISSING_OBJECT"],
      [/already exists/i, "OBJECT_EXISTS"],
      [/unrecognized (?:option|configuration)/i, "UNSUPPORTED_OPTION"],
      [/no such (?:container|volume|object)/i, "RESOURCE_NOT_FOUND"],
      [/invalid (?:argument|mount|reference)/i, "INVALID_DOCKER_ARGUMENT"],
      [/read-only file system/i, "READ_ONLY_FILESYSTEM"],
      [/no space left/i, "NO_SPACE"],
      [/could not (?:load|access).*library/i, "EXTENSION_LIBRARY_UNAVAILABLE"],
    ]
      .filter(([pattern]) => pattern.test(String(stderr)))
      .map(([, category]) => category);
    report.commands.push({
      label,
      startedAt: begun,
      durationMs: Date.now() - begun,
      exitCode: r.status,
      timedOut: r.error?.code === "ETIMEDOUT",
      stdoutSha256: sha(stdout),
      stderrSha256: sha(stderr),
      errorCategories,
    });
    if (!options.allowFailure)
      need(
        !r.error && r.status === 0,
        `CLI_${label.replaceAll(/[^A-Za-z0-9]/g, "_")}_FAILED`,
      );
    return {
      status: r.status,
      stdout: String(stdout),
      stderr: String(stderr),
      error: r.error,
    };
  };
  const inspect = (name, cleanup = false) =>
    JSON.parse(
      execute(
        "inspect-exact-container",
        ["container", "inspect", "--format", CONTAINER_FORMAT, name],
        { cleanup },
      ).stdout,
    );
  const cleanExec = (id, user, args, options = {}) =>
    execute(
      options.label ?? "native-tool",
      [
        "exec",
        ...(options.input !== undefined || options.stdinFd !== undefined
          ? ["-i"]
          : []),
        ...(user ? ["--user", user] : []),
        id,
        "/usr/bin/env",
        "-i",
        "PATH=/usr/bin:/bin",
        "LANG=C.UTF-8",
        ...args,
      ],
      options,
    );
  const sourceQuery = (sql) =>
    cleanExec(
      source.Id,
      null,
      [
        `${bin}/psql`,
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      { input: sql, label: "source-readonly-sql" },
    );
  const targetQuery = (sql, user = "postgres", database = "postgres") =>
    cleanExec(
      containerId,
      `${uid}:${gid}`,
      [
        `${bin}/psql`,
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        "/restore/socket",
        "-U",
        user,
        "-d",
        database,
      ],
      { input: sql, label: "target-sql" },
    );
  const snapshot = (query) => {
    const catalog = JSON.parse(query(CATALOG_SQL).stdout),
      roles = JSON.parse(query(ROLE_SQL).stdout),
      details = JSON.parse(query(DETAILS_SQL).stdout);
    const tables = catalog.relations
      .filter((x) => ["r", "p"].includes(x.relation_kind))
      .map((x) => ({ schema: x.schema, name: x.name }));
    need(tables.length > 0, "DATA_TABLE_ROSTER_EMPTY");
    const dataSql = readOnly(
      `select coalesce(jsonb_agg(x order by x->>'table'),'[]'::jsonb)::text from (${tables.map((t) => `select jsonb_build_object('table',${qs(t.schema + "." + t.name)},'count',count(*),'sha256',${hashSql(`coalesce(string_agg(${hashSql("to_jsonb(r)::text")},'' order by ${hashSql("to_jsonb(r)::text")}), '')`)}) x from ${qi(t.schema)}.${qi(t.name)} r`).join(" UNION ALL ")}) q;`,
    );
    const data = JSON.parse(query(dataSql).stdout);
    need(
      details.ledger_unbalanced === 0 && details.direct_money_writes === 0,
      "FINANCIAL_INVARIANTS",
    );
    return {
      catalog,
      roles,
      details,
      data,
      epoch: {
        system_identifier: catalog.system_identifier,
        catalog: sha(stable(catalog)),
        roles: sha(stable(roles)),
        details: sha(stable(details)),
        data: sha(stable(data)),
      },
    };
  };
  try {
    need(
      process.platform === "linux" &&
        process.argv.length === 3 &&
        process.argv[2] === "--ci" &&
        process.env.GITHUB_ACTIONS === "true" &&
        process.env.APP_ENV === "test",
      "CI_ONLY",
    );
    const evidence = collectCiSourceEvidence();
    need(evidence.scope === "CI", "CI_SOURCE_REQUIRED");
    report.source = evidence;
    const boundary = assertBackend201CanonicalSources();
    need(boundary.projectId === PROJECT, "CANONICAL_PROJECT");
    const tempRoot = realpathSync(process.env.RUNNER_TEMP ?? "");
    need(tempRoot.startsWith("/") && tempRoot !== "/", "PRIVATE_RUNNER_TEMP");
    privateDir = mkdtempSync(
      join(tempRoot, "putduk-mining-independent-restore-"),
    );
    chmodSync(privateDir, 0o700);
    const context = JSON.parse(
      execute("docker-local-context", [
        "context",
        "inspect",
        "--format",
        "{{json .Endpoints.docker.Host}}",
        "default",
      ]).stdout,
    );
    need(context === "unix:///var/run/docker.sock", "LOCAL_DOCKER_ENDPOINT");
    source = admitSource(inspect(`supabase_db_${PROJECT}`));
    const image = JSON.parse(
      execute("exact-image-config", [
        "image",
        "inspect",
        "--format",
        '{"Id":{{json .Id}},"Os":{{json .Os}},"Config":{"Entrypoint":{{json .Config.Entrypoint}},"Cmd":{{json .Config.Cmd}},"Volumes":{{json (index .Config "Volumes")}}}}',
        source.Image,
      ]).stdout,
    );
    need(
      image?.Id === source.Image &&
        image.Os === "linux" &&
        !Object.keys(image.Config?.Volumes ?? {}).length,
      "PINNED_IMAGE_VOLUMES",
    );
    report.sourceContainer = {
      id: source.Id,
      name: source.Name,
      image: source.Image,
      project: PROJECT,
    };
    report.image = {
      id: image.Id,
      entrypoint: image.Config?.Entrypoint ?? null,
      cmd: image.Config?.Cmd ?? null,
      volumes: image.Config?.Volumes ?? null,
    };
    const metadata = cleanExec(
      source.Id,
      null,
      [
        "/bin/sh",
        "-c",
        "command -v pg_config; pg_config --bindir; pg_config --version; id -u postgres; id -g postgres; id -un postgres",
      ],
      { label: "source-native-metadata", timeout: 5000 },
    )
      .stdout.trim()
      .split("\n");
    need(
      metadata.length === 6 &&
        /^\/[a-zA-Z0-9/_-]+$/.test(metadata[1]) &&
        metadata[2] === "PostgreSQL 17.6" &&
        metadata[5] === "postgres",
      "NATIVE_PG17_6_TOOLS",
    );
    bin = metadata[1];
    uid = Number(metadata[3]);
    gid = Number(metadata[4]);
    need(
      Number.isSafeInteger(uid) &&
        uid > 0 &&
        Number.isSafeInteger(gid) &&
        gid > 0,
      "NATIVE_NONROOT_IDS",
    );
    report.native = { bin, version: metadata[2], uid, gid };
    const preparation = buildTargetPreparation(uid, gid);
    const fresh = readBackend201FreshCatalog(
      sourceQuery,
      boundary.migrationVersions,
      source.Id,
    );
    report.freshSource = {
      migrations: 201,
      emptyTables: 16,
      systemIdentifier: fresh.metadata.systemIdentifier,
    };
    const before = snapshot(sourceQuery);
    need(
      before.catalog.server_version.startsWith("17.6") &&
        before.catalog.system_identifier === fresh.metadata.systemIdentifier,
      "SOURCE_PG_IDENTITY",
    );
    const sourceRoleNames = before.roles.roles.map((x) => x.name);
    need(
      before.roles.roles.length === 31 &&
        Object.keys(ROLE_FLAGS).every((x) => sourceRoleNames.includes(x)) &&
        before.roles.memberships.length === 25,
      "REVIEWED_ROLE_ROSTER",
    );
    const roleSql = buildRoleBootstrap(
      before.roles.roles,
      before.roles.memberships,
    );
    report.sourceDatabaseAcl = before.roles.database;
    const databaseAclSql = buildDatabaseAcl(before.roles.database);
    // Validate the exact source supplement contract before provisioning anything.
    buildSupplement(before.catalog, before.catalog);
    archive = join(privateDir, "postgres.custom");
    const dumpFd = openSync(archive, "wx", 0o600);
    try {
      cleanExec(
        source.Id,
        null,
        [
          "/usr/bin/env",
          "PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=45000",
          `${bin}/pg_dump`,
          "--format=custom",
          "--no-password",
          "--username=postgres",
          "--dbname=postgres",
        ],
        {
          label: "source-readonly-custom-dump",
          stdoutFd: dumpFd,
          timeout: 45000,
        },
      );
    } finally {
      closeSync(dumpFd);
    }
    const bytes = statSync(archive).size;
    need(bytes > 0 && bytes <= 64 * 1024 * 1024, "DUMP_SIZE_BOUND");
    report.dump = { bytes, sha256: sha(readFileSync(archive)) };
    const nonce = randomUUID(),
      run = `${evidence.runId}-${evidence.attempt}`,
      name = `putduk-mining-restore-${run}-${nonce.slice(0, 8)}`,
      volume = `${name}-data`;
    expected = { id: null, name, volume, nonce, run, image: source.Image };
    report.target = { name, volume, nonce, run, image: source.Image };
    for (const [kind, value] of [
      ["container", name],
      ["volume", volume],
    ]) {
      const absent = execute(
        `fresh-${kind}-name`,
        [
          kind,
          "inspect",
          "--format",
          kind === "container" ? CONTAINER_FORMAT : VOLUME_FORMAT,
          value,
        ],
        { allowFailure: true },
      );
      need(
        absent.status !== 0 &&
          !absent.error &&
          /No such (?:object|container|volume)/i.test(absent.stderr),
        "FRESH_RESOURCE_NAME_REQUIRED",
      );
    }
    volumeAttempted = true;
    execute("create-own-volume", [
      "volume",
      "create",
      "--label",
      "putduk.owner=ci-independent-restore",
      "--label",
      `putduk.nonce=${nonce}`,
      "--label",
      `putduk.run=${run}`,
      volume,
    ]);
    createdVolume = true;
    createAttempted = true;
    const rootPrepare = preparation.rootCommand;
    expected.command = rootPrepare;
    containerId = execute("create-own-container", [
      "create",
      "--pull=never",
      "--name",
      name,
      "--label",
      "putduk.owner=ci-independent-restore",
      "--label",
      `putduk.nonce=${nonce}`,
      "--label",
      `putduk.run=${run}`,
      "--network=none",
      "--read-only",
      "--memory=256m",
      "--memory-swap=256m",
      "--pids-limit=64",
      "--cpus=0.5",
      "--no-healthcheck",
      "--cap-drop=ALL",
      "--cap-add=CHOWN",
      "--cap-add=FOWNER",
      "--cap-add=SETUID",
      "--cap-add=SETGID",
      "--security-opt=no-new-privileges",
      "--user=0:0",
      "--log-driver=local",
      "--log-opt=max-size=10m",
      "--log-opt=max-file=1",
      "--log-opt=compress=false",
      "--mount",
      `type=volume,source=${volume},target=/restore`,
      "--entrypoint=/bin/sh",
      source.Image,
      "-c",
      rootPrepare,
    ]).stdout.trim();
    need(fullId(containerId), "OWN_CREATE_CID");
    expected.id = containerId;
    report.target.id = containerId;
    const targetBeforeStart = inspect(containerId);
    report.targetCapabilityAdmission = {
      user: targetBeforeStart.Config?.User ?? null,
      capAdd: targetBeforeStart.HostConfig?.CapAdd ?? null,
      capDrop: targetBeforeStart.HostConfig?.CapDrop ?? null,
      securityOpt: targetBeforeStart.HostConfig?.SecurityOpt ?? null,
      nanoCpus: targetBeforeStart.HostConfig?.NanoCpus ?? null,
    };
    admitOwnedTarget(targetBeforeStart, expected, source);
    execute("start-own-container", ["start", containerId]);
    const stat = cleanExec(
      containerId,
      preparation.permissionUser,
      [
        "/bin/sh",
        "-c",
        "for n in 1 2 3 4 5; do test -f /restore/ready && break; sleep 1; done; test -f /restore/ready && stat -c '%u:%g:%a' /restore/pgdata && stat -f -c %T /restore/pgdata",
      ],
      { label: "target-permission-filesystem", timeout: 7000 },
    )
      .stdout.trim()
      .split("\n");
    need(stat[0] === `${uid}:${gid}:700`, "FRESH_PGDATA_PERMISSION");
    assertSupportedFilesystem(stat[1]);
    report.filesystem = stat[1];
    assertUnprivileged(
      cleanExec(
        containerId,
        `${uid}:${gid}`,
        ["/bin/cat", "/proc/self/status"],
        { label: "target-unprivileged-status" },
      ).stdout,
      uid,
      gid,
    );
    const db = before.roles.database;
    need(
      db.encoding === "UTF8" &&
        db.owner === "postgres" &&
        typeof db.collate === "string" &&
        typeof db.ctype === "string",
      "SOURCE_DATABASE_CONTRACT",
    );
    cleanExec(
      containerId,
      `${uid}:${gid}`,
      [
        `${bin}/initdb`,
        "-D",
        "/restore/pgdata",
        "-U",
        "supabase_admin",
        "--auth-local=peer",
        "--auth-host=reject",
        "--encoding=UTF8",
        `--lc-collate=${db.collate}`,
        `--lc-ctype=${db.ctype}`,
        "--no-clean",
        "--no-instructions",
        "--wal-segsize=1",
        "--sync-method=fsync",
        "-c",
        "shared_preload_libraries=",
        "-c",
        "max_connections=10",
        "-c",
        "shared_buffers=16MB",
        "-c",
        "autovacuum=off",
        "-c",
        "max_worker_processes=0",
      ],
      { label: "target-native-initdb", timeout: 30000 },
    );
    cleanExec(
      containerId,
      `${uid}:${gid}`,
      [
        "/bin/sh",
        "-c",
        "printf '%s\\n' 'local all all peer map=owned' 'host all all 0.0.0.0/0 reject' 'host all all ::0/0 reject' > /restore/pgdata/pg_hba.conf; printf '%s\\n' 'owned postgres supabase_admin' 'owned postgres postgres' > /restore/pgdata/pg_ident.conf",
      ],
      { label: "target-local-peer-auth" },
    );
    cleanExec(
      containerId,
      `${uid}:${gid}`,
      [
        `${bin}/pg_ctl`,
        "-D",
        "/restore/pgdata",
        "-l",
        "/restore/postgres.log",
        "-o",
        "-k /restore/socket -c listen_addresses= -c fsync=on -c synchronous_commit=on -c session_preload_libraries= -c local_preload_libraries=",
        "-w",
        "-t",
        "15",
        "start",
      ],
      { label: "target-native-start", timeout: 20000 },
    );
    targetQuery(roleSql, "supabase_admin", "template1");
    targetQuery(
      `DROP DATABASE postgres; CREATE DATABASE postgres WITH OWNER postgres TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE ${qs(db.collate)} LC_CTYPE ${qs(db.ctype)};`,
      "supabase_admin",
      "template1",
    );
    const initIdentity = JSON.parse(
      targetQuery(
        readOnly(
          "select jsonb_build_object('system_identifier',(select system_identifier::text from pg_control_system()),'fsync',current_setting('fsync'),'listen',current_setting('listen_addresses'),'preload',current_setting('shared_preload_libraries'))::text;",
        ),
        "supabase_admin",
      ).stdout,
    );
    need(
      initIdentity.fsync === "on" &&
        initIdentity.listen === "" &&
        initIdentity.preload === "" &&
        initIdentity.system_identifier !== before.catalog.system_identifier,
      "TARGET_INDEPENDENT_SYNC_IDENTITY",
    );
    report.target.systemIdentifier = initIdentity.system_identifier;
    const restoreFd = openSync(archive, "r"),
      restoreOut = openSync(join(privateDir, "restore.stdout"), "wx", 0o600);
    try {
      cleanExec(
        containerId,
        `${uid}:${gid}`,
        [
          `${bin}/pg_restore`,
          "--no-password",
          "--username=supabase_admin",
          "--host=/restore/socket",
          "--dbname=postgres",
          "--single-transaction",
          "--exit-on-error",
        ],
        {
          label: "target-transactional-restore",
          stdinFd: restoreFd,
          stdoutFd: restoreOut,
          timeout: 45000,
        },
      );
    } finally {
      closeSync(restoreFd);
      closeSync(restoreOut);
    }
    const databaseAclBefore = JSON.parse(targetQuery(ROLE_SQL).stdout).database;
    need(
      databaseAclBefore.owner === "postgres",
      "TARGET_DATABASE_OWNER_BEFORE_ACL",
    );
    targetQuery(databaseAclSql, "supabase_admin");
    const databaseAclAfter = JSON.parse(targetQuery(ROLE_SQL).stdout).database;
    report.databaseAcl = {
      sourceSha256: sha(stable(before.roles.database)),
      targetBeforeSha256: sha(stable(databaseAclBefore)),
      targetAfterSha256: sha(stable(databaseAclAfter)),
      sqlSha256: sha(databaseAclSql),
    };
    need(
      same(before.roles.database, databaseAclAfter),
      "DATABASE_ACL_RESTORE_DIFFERENCE",
    );
    const rawTarget = snapshot(targetQuery);
    report.rawPreSupplement = {
      source: fingerprint(before.catalog),
      target: fingerprint(rawTarget.catalog),
      comparison: compareRestoreCatalogs(before.catalog, rawTarget.catalog, {
        sourceDetails: before.details,
        targetDetails: rawTarget.details,
        sourceFingerprint: fingerprint(before.catalog),
        targetFingerprint: fingerprint(rawTarget.catalog),
      }),
    };
    const supplement = buildSupplement(before.catalog, rawTarget.catalog);
    report.supplement = {
      sqlSha256: sha(supplement),
      statements: supplement.split(";\n").length - 2,
    };
    targetQuery(supplement, "supabase_admin");
    const afterTarget = snapshot(targetQuery),
      comparison = compareRestoreCatalogs(before.catalog, afterTarget.catalog, {
        sourceDetails: before.details,
        targetDetails: afterTarget.details,
        sourceFingerprint: fingerprint(before.catalog),
        targetFingerprint: fingerprint(afterTarget.catalog),
      });
    report.catalogComparison = comparison;
    assertCatalogComparison(comparison);
    need(
      same(before.roles, afterTarget.roles) &&
        same(before.data, afterTarget.data),
      "ROLE_EXTENSION_OR_DATA_DIFFERENCE",
    );
    for (const key of [
      "constraints",
      "indexes",
      "policies",
      "triggers",
      "default_privileges",
      "ledger_unbalanced",
      "direct_money_writes",
    ])
      need(
        same(before.details[key], afterTarget.details[key]),
        `DETAIL_${key}_DIFFERENCE`,
      );
    const finalSource = admitSource(inspect(source.Id));
    need(
      finalSource.Id === source.Id &&
        finalSource.Image === source.Image &&
        same(finalSource.Mounts, source.Mounts),
      "FINAL_SOURCE_IDENTITY_CHANGED",
    );
    readBackend201FreshCatalog(
      sourceQuery,
      boundary.migrationVersions,
      source.Id,
    );
    const afterSource = snapshot(sourceQuery);
    assertSameEpoch(
      before.epoch,
      afterSource.epoch,
      afterTarget.catalog.system_identifier,
    );
    report.sourceSafety = "FINAL_IDENTITY_AND_EPOCH_UNCHANGED";
    report.sourceEpoch = { before: before.epoch, after: afterSource.epoch };
    report.data = {
      tables: before.data.length,
      sha256: sha(stable(before.data)),
    };
    report.verification = "PASSED_PENDING_CLEANUP";
  } catch (error) {
    report.failure = /^INDEPENDENT_RESTORE_[A-Za-z0-9_]+$/.test(error.message)
      ? error.message
      : "INDEPENDENT_RESTORE_UNEXPECTED_ERROR";
    report.failureName = error.name;
  } finally {
    try {
      if (createAttempted && !containerId) {
        const found = execute(
          "reconcile-own-create",
          ["container", "inspect", "--format", CONTAINER_FORMAT, expected.name],
          { cleanup: true, allowFailure: true },
        );
        if (found.status === 0) {
          const x = JSON.parse(found.stdout);
          expected.id = x.Id;
          admitOwnedTarget(x, expected, source);
          containerId = x.Id;
        } else
          need(
            !found.error && /No such (?:object|container)/i.test(found.stderr),
            "CREATE_OUTCOME_UNKNOWN",
          );
      }
      if (containerId) {
        const own = admitOwnedTarget(
          inspect(containerId, true),
          expected,
          source,
        );
        report.cleanup.finalIdentity = {
          id: own.Id,
          image: own.Image,
          name: own.Name,
          nonce: expected.nonce,
          volume: expected.volume,
        };
        execute("remove-own-container", ["rm", "-f", containerId], {
          cleanup: true,
        });
      }
      if (volumeAttempted) {
        const found = execute(
          "inspect-own-volume",
          ["volume", "inspect", "--format", VOLUME_FORMAT, expected.volume],
          { cleanup: true, allowFailure: true },
        );
        if (found.status === 0) {
          const volume = JSON.parse(found.stdout);
          need(
            volume.Name === expected.volume &&
              volume.Labels?.["putduk.owner"] === "ci-independent-restore" &&
              volume.Labels["putduk.nonce"] === expected.nonce &&
              volume.Labels["putduk.run"] === expected.run,
            "OWN_VOLUME_IDENTITY",
          );
          execute("remove-own-volume", ["volume", "rm", expected.volume], {
            cleanup: true,
          });
          createdVolume = true;
        } else
          need(
            !found.error && /No such volume/i.test(found.stderr),
            "VOLUME_CREATE_OUTCOME_UNKNOWN",
          );
      }
      report.cleanup.state =
        createdVolume || containerId
          ? "OWN_RESOURCES_REMOVED"
          : "NOT_PROVISIONED";
    } catch (error) {
      report.cleanup.state = "UNKNOWN";
      report.cleanup.failure = /^INDEPENDENT_RESTORE_[A-Za-z0-9_]+$/.test(
        error.message,
      )
        ? error.message
        : "INDEPENDENT_RESTORE_CLEANUP_ERROR";
    }
    if (archive) {
      try {
        unlinkSync(archive);
        report.privateDumpRemoved = true;
      } catch {
        report.privateDumpRemoved = false;
      }
    }
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.now() - start;
    if (
      report.verification === "PASSED_PENDING_CLEANUP" &&
      report.cleanup.state === "OWN_RESOURCES_REMOVED" &&
      report.privateDumpRemoved &&
      report.durationMs <= 180000
    )
      report.state = "FRESH201_INDEPENDENT_RESTORE_PASSED";
    mkdirSync(resolve("test-results/worker"), { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const report = runCiRestore();
  console.log(
    JSON.stringify({
      state: report.state,
      failure: report.failure ?? null,
      cleanup: report.cleanup.state,
      summary: "test-results/worker/independent-restore.json",
    }),
  );
  if (report.state !== "FRESH201_INDEPENDENT_RESTORE_PASSED")
    process.exitCode = 1;
}
