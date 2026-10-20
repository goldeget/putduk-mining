/** Explicit CI-only synthetic proof in a new database. No import-time processes. */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertBackend202CanonicalSources } from "./backend-successor-202-source.mjs";
import { readBackend202FreshCatalog } from "./backend-successor-202-catalog.mjs";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";
const ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const need = (v, r) => {
  if (!v) throw Error("OWNER202_" + r);
};
const hash = (v) => createHash("sha256").update(v).digest("hex");
const uuid = (v) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    v,
  );
export function parseOwner202Arguments(args) {
  const flags = [
    "--execute",
    "--allow-synthetic-db-writes",
    "--allow-create-owned-database",
  ];
  need(
    args.length === 6 &&
      new Set(args).size === 6 &&
      flags.every((f) => args.includes(f)),
    "EXPLICIT_FLAGS_REQUIRED",
  );
  const value = (p) => {
    const found = args.filter((a) => a.startsWith(p));
    need(found.length === 1, "EXACT_ARGUMENT_REQUIRED");
    return found[0].slice(p.length);
  };
  const containerId = value("--fresh-container-id="),
    database = value("--database="),
    output = value("--output=");
  need(
    /^[a-f0-9]{64}$/.test(containerId) &&
      /^putduk_owner202_[a-f0-9]{32}$/.test(database) &&
      output.length > 0,
    "EXACT_OWNED_TARGET_REQUIRED",
  );
  return { containerId, database, output };
}
export function assertOwner202Dump(sql) {
  need(
    typeof sql === "string" &&
      sql.length > 100 &&
      sql.length < 32 * 1024 * 1024,
    "BOUNDED_SCHEMA_DUMP_REQUIRED",
  );
  const active = maskOwner202Dump(sql);
  need(
    !/(?:^|;)\s*(?:COPY\b|(?:CREATE|ALTER|DROP)\s+DATABASE\b)/i.test(active),
    "SCHEMA_DUMP_ESCAPE_REJECTED",
  );
  return { sha256: hash(sql), bytes: Buffer.byteLength(sql) };
}
// pg_dump emits standard_conforming_strings=on. Preserve offsets/newlines while
// masking SQL content so routine prose is not treated as a restore command.
function maskOwner202Dump(sql) {
  const parts = [],
    literalParts = [],
    quotedCalls = [];
  let plainStart = 0,
    restrictToken = null,
    restrictPairs = 0;
  const mask = (start, end, comment = false) => {
    const plain = sql.slice(plainStart, start),
      value = sql.slice(start, end),
      blank = value.replace(/[^\r\n]/g, " ");
    parts.push(plain, blank);
    literalParts.push(plain, comment ? blank : value);
    plainStart = end;
  };
  const identifier = (c) => /[A-Za-z0-9_$\u0080-\uffff]/.test(c ?? "");
  for (let i = 0; i < sql.length;) {
    const ch = sql[i],
      next = sql[i + 1];
    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i + 2);
      const stop = end < 0 ? sql.length : end;
      mask(i, stop, true);
      i = stop;
      continue;
    }
    if (ch === "/" && next === "*") {
      let end = i + 2,
        depth = 1;
      while (end < sql.length && depth > 0) {
        if (sql[end] === "/" && sql[end + 1] === "*") {
          depth++;
          end += 2;
        } else if (sql[end] === "*" && sql[end + 1] === "/") {
          depth--;
          end += 2;
        } else end++;
      }
      need(depth === 0, "SCHEMA_DUMP_LEXICAL_REJECTED");
      mask(i, end, true);
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const escaped =
        ch === "'" && /[Ee]/.test(sql[i - 1] ?? "") && !identifier(sql[i - 2]);
      let end = i + 1,
        closed = false;
      while (end < sql.length) {
        if (escaped && sql[end] === "\\") end += 2;
        else if (sql[end] === ch && sql[end + 1] === ch) end += 2;
        else if (sql[end] === ch) {
          end++;
          closed = true;
          break;
        } else end++;
      }
      need(closed, "SCHEMA_DUMP_LEXICAL_REJECTED");
      if (ch === '"') {
        const unicode =
          sql.slice(Math.max(0, i - 2), i).toUpperCase() === "U&" &&
          !identifier(sql[i - 3]);
        if (
          unicode ||
          sql
            .slice(i + 1, end - 1)
            .replace(/""/g, '"')
            .toLowerCase() === "set_config"
        )
          quotedCalls.push({ start: unicode ? i - 2 : i, end, unicode });
      }
      mask(i, end);
      i = end;
      continue;
    }
    if (ch === "$" && !identifier(sql[i - 1])) {
      const tag = sql
        .slice(i)
        .match(
          /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/,
        )?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        need(end >= 0, "SCHEMA_DUMP_LEXICAL_REJECTED");
        const stop = end + tag.length;
        mask(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === "\\") {
      const start = sql.lastIndexOf("\n", i - 1) + 1;
      const lineEnd = sql.indexOf("\n", i);
      const stop = lineEnd < 0 ? sql.length : lineEnd;
      const command = sql
        .slice(start, stop)
        .match(
          /^[\t ]*\\(restrict|unrestrict)[\t ]+([A-Za-z0-9]{1,128})[\t ]*\r?$/,
        );
      need(
        command && /^[\t ]*$/.test(sql.slice(start, i)),
        "SCHEMA_DUMP_ESCAPE_REJECTED",
      );
      if (command[1] === "restrict") {
        need(
          restrictToken === null && restrictPairs === 0,
          "SCHEMA_DUMP_ESCAPE_REJECTED",
        );
        restrictToken = command[2];
      } else {
        need(restrictToken === command[2], "SCHEMA_DUMP_ESCAPE_REJECTED");
        restrictToken = null;
        restrictPairs++;
      }
      mask(i, stop, true);
      i = stop;
      continue;
    }
    i++;
  }
  need(restrictToken === null, "SCHEMA_DUMP_ESCAPE_REJECTED");
  parts.push(sql.slice(plainStart));
  literalParts.push(sql.slice(plainStart));
  const active = parts.join("");
  const literals = literalParts.join("");
  const calls = [
    ...active.matchAll(/(?<![A-Za-z0-9_$\u0080-\uffff])set_config\s*\(/gi),
  ].map((m) => m.index);
  for (const call of quotedCalls) {
    if (!/^\s*\(/.test(active.slice(call.end))) continue;
    // pg_dump uses ordinary identifiers for its one allowed catalog call.
    need(!call.unicode, "SCHEMA_DUMP_LEXICAL_REJECTED");
    calls.push(call.start);
  }
  let statementStart = 0;
  const ends = [...active.matchAll(/;/g)].map((m) => m.index);
  ends.push(active.length);
  for (const end of ends) {
    const statement = active.slice(statementStart, end);
    const literalStatement = literals.slice(statementStart, end).trim();
    need(
      !/^\s*DO\b/i.test(statement) &&
        !/^(?:SET\b(?:\s+(?:SESSION|LOCAL)\b)?|RESET\b)\s*(?:U&)?"/i.test(
          literalStatement,
        ),
      "SCHEMA_DUMP_LEXICAL_REJECTED",
    );
    if (calls.some((position) => position >= statementStart && position < end))
      need(
        literalStatement ===
          "SELECT pg_catalog.set_config('search_path', '', false)",
        "SCHEMA_DUMP_LEXICAL_REJECTED",
      );
    statementStart = end + 1;
  }
  // An off/reset setting would invalidate ordinary-string backslash semantics.
  need(
    !/(?:^|;)\s*RESET\s+(?:standard_conforming_strings|ALL)\b/i.test(active),
    "SCHEMA_DUMP_LEXICAL_REJECTED",
  );
  for (const setting of active.matchAll(
    /(?:^|;)\s*SET\s+(?:(?:SESSION|LOCAL)\s+)?standard_conforming_strings\s*(?:=|\bTO\b)\s*([^;]*)/gi,
  ))
    need(
      setting[1].trim().toLowerCase() === "on",
      "SCHEMA_DUMP_LEXICAL_REJECTED",
    );
  return active;
}
export function owner202SessionSql(userId, requestId, email) {
  need(
    uuid(userId) &&
      uuid(requestId) &&
      /^owner202-[a-f0-9]{32}@synthetic\.invalid$/.test(email),
    "SYNTHETIC_IDENTITY_REQUIRED",
  );
  return `begin; set local statement_timeout='15000ms'; set local lock_timeout='10000ms';
 select jsonb_build_object('phase','started','pid',pg_backend_pid(),'at',extract(epoch from clock_timestamp())*1000)::text;
 select pg_sleep(0.5);
 insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values('${userId}','authenticated','authenticated','${email}',jsonb_build_object('provider','email'),jsonb_build_object('identity_flow','OWNER_ADMIN_PROVISION_V1','provision_request_id','${requestId}'));
 select pg_sleep(0.5); commit;
 select jsonb_build_object('phase','committed','pid',pg_backend_pid(),'at',extract(epoch from clock_timestamp())*1000)::text;`;
}
export function assertOwner202SessionProof(rows) {
  need(
    rows?.length === 2 && rows.every((r) => r.timedOut === false),
    "TWO_BOUNDED_SESSIONS_REQUIRED",
  );
  const parse = (r) =>
    r.stdout
      .split(/\r?\n/)
      .filter((s) => s.startsWith("{"))
      .map((s) => JSON.parse(s));
  const data = rows.map(parse),
    start = data.map((x) => x.find((v) => v.phase === "started"));
  need(
    start.every(
      (x) => Number.isSafeInteger(x?.pid) && x.pid > 0 && Number.isFinite(x.at),
    ) && start[0].pid !== start[1].pid,
    "DISTINCT_CONNECTIONS_REQUIRED",
  );
  const win = rows.findIndex((r) => r.status === 0),
    lose = rows.findIndex((r) => r.status === 3);
  need(
    win >= 0 &&
      lose >= 0 &&
      win !== lose &&
      /\b23505\b/.test(rows[lose].stderr),
    "ONE_COMMIT_ONE_DUPLICATE_REQUIRED",
  );
  const end = data[win].find((v) => v.phase === "committed");
  need(
    end?.pid === start[win].pid &&
      Number.isFinite(end.at) &&
      start.every((x) => x.at < end.at) &&
      !data[lose].some((x) => x.phase === "committed"),
    "OVERLAPPING_TRANSACTIONS_REQUIRED",
  );
  return {
    connections: 2,
    commits: 1,
    duplicateLosers: 1,
    backendPids: start.map((x) => x.pid),
    startedAt: start.map((x) => x.at),
    committedAt: end.at,
  };
}
export function owner202ChildEnvironment(env) {
  need(
    ![
      "NODE_OPTIONS",
      "NODE_PATH",
      "DOCKER_HOST",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
    ].some((k) => env[k]),
    "REMOTE_OR_RUNTIME_OVERRIDE_REJECTED",
  );
  const out = { DOCKER_CONTEXT: "default" };
  for (const k of ["PATH", "HOME", "LANG", "LC_ALL"])
    if (env[k]) out[k] = env[k];
  return out;
}
/** Same local Docker floor as the financial runner; all reads precede DB commands. */
export function readOwner202DockerTarget(
  readJson,
  expectedId,
  now = Date.now(),
) {
  const project = "putduk-mining-ci-r2-20261009",
    name = "supabase_db_" + project;
  const contexts = readJson(["context", "inspect", "default"]);
  need(
    Array.isArray(contexts) &&
      contexts.length === 1 &&
      contexts[0]?.Endpoints?.docker?.Host === "unix:///var/run/docker.sock",
    "LOCAL_DOCKER_ENDPOINT_REQUIRED",
  );
  const containers = readJson(["inspect", name]);
  need(
    Array.isArray(containers) && containers.length === 1,
    "EXACT_NAMED_CONTAINER_REQUIRED",
  );
  const info = containers[0],
    created = Date.parse(info.Created);
  const ports = info.NetworkSettings?.Ports?.["5432/tcp"];
  const mounts = info.Mounts?.filter(
    (m) => m.Destination === "/var/lib/postgresql/data",
  );
  need(
    /^[a-f0-9]{64}$/.test(expectedId) &&
      info.Id === expectedId &&
      info.Name === "/" + name &&
      info.State?.Running === true &&
      info.State?.Paused === false &&
      info.State?.Health?.Status === "healthy" &&
      info.Config?.Labels?.["com.supabase.cli.project"] === project &&
      Number.isFinite(created) &&
      created <= now &&
      now - created < 15 * 60 * 1000 &&
      Array.isArray(ports) &&
      ports.length > 0 &&
      ports.every((p) => p.HostPort === "63422") &&
      Array.isArray(mounts) &&
      mounts.length === 1 &&
      mounts[0].Type === "volume" &&
      mounts[0].Name === name &&
      Array.isArray(info.Config?.Env),
    "FRESH_PROJECT_CONTAINER_REQUIRED",
  );
  for (const item of info.Config.Env) {
    const split = item.indexOf("="),
      key = item.slice(0, split),
      value = item.slice(split + 1);
    need(
      !(
        (key === "PGHOST" &&
          !["localhost", "127.0.0.1", "/var/run/postgresql"].includes(value)) ||
        (key === "PGPORT" && value !== "5432") ||
        (key === "PGDATABASE" && value !== "postgres") ||
        (key === "PGUSER" && value !== "postgres") ||
        key === "PGSERVICE" ||
        key === "PGSERVICEFILE"
      ),
      "CONTAINER_REMOTE_PG_DEFAULT_REJECTED",
    );
  }
  const volumes = readJson(["volume", "inspect", name]),
    volumeCreated = Date.parse(volumes?.[0]?.CreatedAt);
  need(
    Array.isArray(volumes) &&
      volumes.length === 1 &&
      volumes[0].Name === name &&
      Number.isFinite(volumeCreated) &&
      volumeCreated <= now &&
      now - volumeCreated <= 60 * 60 * 1000 &&
      volumeCreated >= created - 60000,
    "FRESH_VOLUME_REQUIRED",
  );
  return {
    containerId: info.Id,
    containerName: name,
    volumeName: name,
    createdAt: info.Created,
    volumeCreatedAt: volumes[0].CreatedAt,
  };
}
function command(args, env, input, timeout = 30000) {
  const r = spawnSync("docker", ["--context", "default", ...args], {
    cwd: ROOT,
    env,
    input,
    encoding: "utf8",
    shell: false,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  need(!r.error && !r.signal && r.status === 0, "BOUNDED_CHILD_FAILED");
  return r;
}
export const owner202PsqlArguments = (cid, db) => [
  "exec",
  "-i",
  cid,
  "psql",
  "-X",
  "-qAt",
  "-w",
  "-h",
  "/var/run/postgresql",
  "-p",
  "5432",
  "-U",
  "postgres",
  "--dbname",
  db,
  "-v",
  "ON_ERROR_STOP=1",
  "-v",
  "VERBOSITY=sqlstate",
];
export const owner202DumpArguments = (cid) => [
  "exec",
  cid,
  "pg_dump",
  "-w",
  "-h",
  "/var/run/postgresql",
  "-p",
  "5432",
  "-U",
  "postgres",
  "--dbname",
  "postgres",
  "--schema-only",
];
function session(args, env, input) {
  return new Promise((resolveSession) => {
    const child = spawn("docker", ["--context", "default", ...args], {
      cwd: ROOT,
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "",
      stderr = "",
      timedOut = false,
      settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 20000);
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveSession({ status, stdout, stderr, timedOut });
    };
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.length > 65536) {
        timedOut = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 65536) {
        timedOut = true;
        child.kill("SIGKILL");
      }
    });
    child.once("error", () => finish(null));
    child.once("close", finish);
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export async function executeOwner202Concurrency(args, env = process.env) {
  const c = parseOwner202Arguments(args);
  need(
    process.platform === "linux" &&
      env.CI === "true" &&
      env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_REPOSITORY === "goldeget/putduk-mining" &&
      env.GITHUB_JOB === "database" &&
      env.APP_ENV === "test" &&
      env.GITHUB_WORKSPACE &&
      realpathSync(env.GITHUB_WORKSPACE) === ROOT,
    "ACTUAL_DATABASE_CI_REQUIRED",
  );
  const childEnv = owner202ChildEnvironment(env),
    boundary = assertBackend202CanonicalSources(),
    source = collectCiSourceEvidence(env);
  const out = resolve(c.output);
  need(
    env.RUNNER_TEMP &&
      resolve(dirname(out)) === realpathSync(env.RUNNER_TEMP) &&
      !existsSync(out),
    "NEW_EXTERNAL_OUTPUT_REQUIRED",
  );
  const target = readOwner202DockerTarget(
    (args) => JSON.parse(command(args, childEnv).stdout),
    c.containerId,
  );
  const query = (db, sql) =>
    command(owner202PsqlArguments(target.containerId, db), childEnv, sql);
  const before = readBackend202FreshCatalog(
    (sql) => query("postgres", sql),
    boundary.migrationVersions,
    c.containerId,
  );
  const dump = command(
    owner202DumpArguments(target.containerId),
    childEnv,
    undefined,
    60000,
  ).stdout;
  const dumpProof = assertOwner202Dump(dump);
  const absent = query(
    "postgres",
    `begin read only;set local statement_timeout='10000ms';select count(*) from pg_database where datname='${c.database}';rollback;`,
  ).stdout.trim();
  need(absent === "0", "DATABASE_ALREADY_EXISTS");
  // A fresh container gets one attempt. An unknown outcome cannot silently use a new database.
  writeFileSync(
    resolve(
      realpathSync(env.RUNNER_TEMP),
      `owner202-${c.containerId}.fence.json`,
    ),
    JSON.stringify({
      state: "FENCED_NO_RETRY_SAME_CONTAINER",
      runId: source.runId,
      attempt: source.attempt,
      sourceSha: source.sourceSha,
      output: out,
      database: c.database,
    }) + "\n",
    { flag: "wx" },
  );
  mkdirSync(out);
  writeFileSync(
    resolve(out, "execution-intent.json"),
    JSON.stringify(
      {
        state: "FENCED_NOT_ACCEPTED_NO_RETRY",
        source,
        containerId: c.containerId,
        database: c.database,
        sourceManifestSha256: boundary.manifestSha256,
        schemaDump: dumpProof,
        originalDatabaseApplicationWrites: 0,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  // Sole original-database write is CREATE DATABASE: no app/auth/table writes there.
  query("postgres", `CREATE DATABASE ${c.database} TEMPLATE template0;`);
  query(c.database, "drop schema public cascade;");
  query(c.database, dump);
  const userId = randomUUID(),
    requestId = randomUUID(),
    email =
      "owner202-" + randomUUID().replaceAll("-", "") + "@synthetic.invalid";
  query(
    c.database,
    `begin;set local statement_timeout='10000ms';insert into app_private.owner_admin_provision_intents(request_id,planned_auth_user_id,email_sha256,expires_at,reason,authorization_reference) values('${requestId}','${userId}','${hash(email)}',statement_timestamp()+interval '10 minutes','CI owned synthetic concurrency proof','CI:${source.runId}/${source.attempt}');commit;`,
  );
  const sql = owner202SessionSql(userId, requestId, email),
    sessions = await Promise.all([
      session(
        owner202PsqlArguments(target.containerId, c.database),
        childEnv,
        sql,
      ),
      session(
        owner202PsqlArguments(target.containerId, c.database),
        childEnv,
        sql,
      ),
    ]);
  const sessionProof = assertOwner202SessionProof(sessions);
  const counts = JSON.parse(
    query(
      c.database,
      `begin read only;set local statement_timeout='10000ms';select jsonb_build_object(
 'auth',(select count(*) from auth.users),'profiles',(select count(*) from public.user_profiles),'roles',(select count(*) from public.user_roles),'audit',(select count(*) from public.audit_logs),'receipts',(select count(*) from app_private.owner_admin_provision_receipts),'intents',(select count(*) from app_private.owner_admin_provision_intents),'consent',(select count(*) from public.user_consent_records),'wallet',(select count(*) from public.wallet_accounts),
 'binding',(select count(*) from app_private.owner_admin_provision_receipts r join public.user_profiles p on p.user_id=r.auth_user_id join public.user_roles u on u.id=r.role_id and u.user_id=r.auth_user_id join public.audit_logs a on a.id=r.audit_id and a.request_id=r.request_id and a.target_id=r.role_id::text where r.request_id='${requestId}' and r.auth_user_id='${userId}' and u.role='SUPER_ADMIN' and u.granted_by is null and u.revoked_at is null and a.action='role.owner_authorized_new_super_admin' and a.actor_user_id is null and a.actor_role is null and a.target_type='user_role' and r.receipt_digest ~ '^[0-9a-f]{64}$'))::text;rollback;`,
    ).stdout.trim(),
  );
  need(
    [
      "auth",
      "profiles",
      "roles",
      "audit",
      "receipts",
      "intents",
      "binding",
    ].every((k) => counts[k] === 1) &&
      counts.consent === 0 &&
      counts.wallet === 0,
    "EXACT_ATOMIC_SINGLETON_REQUIRED",
  );
  const after = readBackend202FreshCatalog(
    (sql) => query("postgres", sql),
    boundary.migrationVersions,
    c.containerId,
  );
  need(
    JSON.stringify(before.counts) === JSON.stringify(after.counts),
    "ORIGINAL_DATA_CHANGED",
  );
  const report = {
    version: 1,
    state: "PASS",
    scope: "CI_OWNED_SYNTHETIC_DATABASE_ONLY",
    source,
    containerId: c.containerId,
    database: c.database,
    originalDatabaseApplicationWrites: 0,
    originalDatabaseCatalogCreates: 1,
    cleanup: "NO_RETRY_NO_DROP",
    manifestSha256: boundary.manifestSha256,
    sourceHashes: {
      runner: boundary.sourceHashes["scripts/owner-admin-202-concurrency.mjs"],
      migration:
        boundary.sourceHashes[
          "supabase/migrations/20261020195134_owner_admin_provisioning_intent.sql"
        ],
    },
    schemaDump: dumpProof,
    sessions: sessionProof,
    counts,
    originalCatalog: { before, after },
  };
  writeFileSync(
    resolve(out, "owner-admin-concurrency.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  return { state: report.state, output: out };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(await executeOwner202Concurrency(process.argv.slice(2))),
    );
  } catch (e) {
    console.error(
      /^OWNER202_[A-Z_]+$/.test(e?.message || "")
        ? e.message
        : "OWNER202_EXECUTION_HOLD",
    );
    process.exitCode = 1;
  }
}
