/** Authenticated CI only: prove first-start isolation instead of resetting twice. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PROJECT = "putduk-mining-ci-r2-20261009";
const DB = `supabase_db_${PROJECT}`;
const proofPath = "test-results/ci/fresh-db-prestart.json";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const need = (value, message) => assert.ok(value, `FRESH_DB_${message}`);

export function admitContext(env) {
  need(env.GITHUB_ACTIONS === "true" && env.RUNNER_OS === "Linux", "CI_ONLY");
  need(env.GITHUB_REPOSITORY === "goldeget/putduk-mining", "REPOSITORY");
  need(env.GITHUB_JOB === "authenticated", "AUTHENTICATED_ONLY");
  need(/^\d+$/.test(env.GITHUB_RUN_ID ?? ""), "RUN_ID");
  need(/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? ""), "RUN_ATTEMPT");
  return `${env.GITHUB_RUN_ID}/${env.GITHUB_RUN_ATTEMPT}`;
}

export function admitInputs(config, migrations, seeds) {
  need(
    new RegExp(`^project_id\\s*=\\s*"${PROJECT}"\\s*$`, "m").test(config),
    "PROJECT",
  );
  need(
    /\[db\.migrations\]\s*(?:#[^\n]*\n\s*)*enabled\s*=\s*true/m.test(config),
    "MIGRATIONS_ENABLED",
  );
  const seedConfig = config.match(/\[db\.seed\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  need(
    seedConfig && /^enabled\s*=\s*true\s*$/m.test(seedConfig),
    "SEED_ENABLED",
  );
  need(
    /^sql_paths\s*=\s*\["\.\/seed\/\*\.sql"\]\s*$/m.test(seedConfig),
    "SEED_PATHS",
  );
  need(
    migrations.length === 201 &&
      new Set(migrations.map((x) => x.version)).size === 201,
    "MIGRATION_ROSTER",
  );
  need(
    seeds.length === 1 && seeds[0].name === "000_no_production_rules.sql",
    "SEED_ROSTER",
  );
  need(
    seeds[0].content.replace(/--[^\n]*(?:\n|$)/g, "").trim() === "",
    "SEED_HAS_EXECUTABLE_SQL",
  );
  return sha(JSON.stringify({ config, migrations, seeds }));
}

export function admitAbsent(result, kind, name) {
  const expected =
    kind === "container"
      ? [
          `Error: No such object: ${name}`,
          `Error response from daemon: No such container: ${name}`,
        ]
      : [`Error response from daemon: get ${name}: no such volume`];
  need(
    result.status === 1 &&
      !result.error &&
      expected.includes(String(result.stderr).trim()),
    "ABSENCE_NOT_PROVEN",
  );
  need(String(result.stdout).trim() === "[]", "ABSENCE_STDOUT");
}

export function admitStarted(container, proof, fingerprint, run, now) {
  need(
    proof.state === "ABSENT_BEFORE_START" &&
      proof.run === run &&
      proof.fingerprint === fingerprint,
    "PRESTART_BINDING",
  );
  need(
    Number.isFinite(proof.startedAt) &&
      now - proof.startedAt >= 0 &&
      now - proof.startedAt < 900000,
    "PROOF_AGE",
  );
  need(/^[a-f0-9]{64}$/.test(container.Id ?? ""), "FULL_CONTAINER_ID");
  need(
    container.Name === `/${DB}` &&
      container.project === PROJECT &&
      container.Running === true,
    "CONTAINER_IDENTITY",
  );
  need(
    Date.parse(container.Created) >= proof.startedAt &&
      Date.parse(container.Created) <= now,
    "NEW_CONTAINER",
  );
  const mount = container.Mounts?.find(
    (x) => x.Destination === "/var/lib/postgresql/data",
  );
  need(mount?.Type === "volume" && mount.Name === DB, "DB_VOLUME");
  return container.Id;
}

export function admitDatabase(actual, expectedVersions) {
  assert.deepEqual(
    actual.versions,
    expectedVersions,
    "FRESH_DB_MIGRATION_SEQUENCE",
  );
  for (const key of ["authUsers", "ledgerTransactions", "ledgerEntries"]) {
    need(actual[key] === 0, `UNEXPECTED_${key}`);
  }
  need(
    actual.database === "postgres" && actual.role === "postgres",
    "SQL_IDENTITY",
  );
}

function command(bin, args, input) {
  return spawnSync(bin, args, {
    encoding: "utf8",
    input,
    timeout: 15000,
    maxBuffer: 1048576,
  });
}
function successful(bin, args, input) {
  const result = command(bin, args, input);
  need(!result.error && result.status === 0, "COMMAND_FAILED");
  return String(result.stdout).trim();
}
export function main(phase, env = process.env) {
  const run = admitContext(env);
  need(["before", "after"].includes(phase), "PHASE");
  need(successful("supabase", ["--version"]) === "2.113.0", "CLI_VERSION");
  const config = readFileSync("supabase/config.toml", "utf8");
  const migrations = readdirSync("supabase/migrations")
    .filter((x) => x.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      version: name.split("_")[0],
      sha256: sha(readFileSync(`supabase/migrations/${name}`)),
    }));
  const seeds = readdirSync("supabase/seed")
    .filter((x) => x.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      content: readFileSync(`supabase/seed/${name}`, "utf8"),
    }));
  const fingerprint = admitInputs(config, migrations, seeds);
  mkdirSync("test-results/ci", { recursive: true });
  if (phase === "before") {
    // Exact named resources only. Daemon/auth/timeout errors never mean absent.
    admitAbsent(
      command("docker", ["container", "inspect", DB]),
      "container",
      DB,
    );
    for (const prefix of [
      "supabase_db",
      "supabase_config",
      "supabase_storage",
    ]) {
      const name = `${prefix}_${PROJECT}`;
      admitAbsent(
        command("docker", ["volume", "inspect", name]),
        "volume",
        name,
      );
    }
    writeFileSync(
      proofPath,
      JSON.stringify({
        state: "ABSENT_BEFORE_START",
        run,
        fingerprint,
        startedAt: Date.now(),
      }),
      { flag: "wx" },
    );
    console.log("FRESH_DB_ABSENCE_PROVEN");
    return;
  }
  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  const format =
    '{"Id":{{json .Id}},"Name":{{json .Name}},"Created":{{json .Created}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"Running":{{json .State.Running}},"Mounts":{{json .Mounts}}}';
  const container = JSON.parse(
    successful("docker", ["container", "inspect", "--format", format, DB]),
  );
  const id = admitStarted(container, proof, fingerprint, run, Date.now());
  const sql = `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT json_build_object('database',current_database(),'role',current_user,'versions',(SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),'authUsers',(SELECT count(*) FROM auth.users),'ledgerTransactions',(SELECT count(*) FROM public.ledger_transactions),'ledgerEntries',(SELECT count(*) FROM public.ledger_entries)); COMMIT;`;
  const actual = JSON.parse(
    successful(
      "docker",
      [
        "exec",
        "-i",
        id,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      sql,
    ),
  );
  admitDatabase(
    actual,
    migrations.map((x) => x.version),
  );
  writeFileSync(
    "test-results/ci/fresh-db-verified.json",
    JSON.stringify({
      state: "FRESH_START_201_VERIFIED",
      run,
      fingerprint,
      containerId: id,
      migrationCount: migrations.length,
      commentOnlySeed: true,
      verifiedAt: Date.now(),
    }),
    { flag: "wx" },
  );
  console.log("FRESH_START_201_VERIFIED");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv[2]);
