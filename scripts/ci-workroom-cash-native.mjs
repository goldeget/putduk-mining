/** Early disposable compile/lifecycle probe; never substitutes for the full native gates. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { prepareWorkroomNativeStage } from "./workroom-native-stage.mjs";
import { WORKROOM_CASH_TESTS } from "./workroom-cash-admission.mjs";
import { assertNativeTap } from "./workroom-native-runner.mjs";

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "goldeget/putduk-mining"
)
  throw Error("CASH_NATIVE_HOSTED_DISPOSABLE_ONLY");
const output = "test-results/workroom-cash-probe";
mkdirSync(output, { recursive: true });
const stage = resolve(
  mkdtempSync(resolve(tmpdir(), "workroom-cash-")),
  "stage",
);
const manifest = prepareWorkroomNativeStage(stage);
const successor = resolve(stage, "successor");
const project = "putduk-mining-ci-r2-20261009";
const records = [];
let started = false;
function command(binary, args, label, { tap = false, record = true } = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    timeout: 600000,
    maxBuffer: 64 * 1024 * 1024,
  });
  // Supabase startup output may contain disposable API credentials. Never save it.
  if (record)
    writeFileSync(
      `${output}/${label}.log`,
      (result.stdout ?? "") + "\n" + (result.stderr ?? ""),
    );
  if (result.error || result.status !== 0) {
    if (!record) {
      const diagnostics = ((result.stdout ?? "") + "\n" + (result.stderr ?? ""))
        .replace(/\u001b\[[0-9;]*m/g, "")
        .split(/\r?\n/)
        .filter((line) =>
          /^(?:ERROR:|LINE \d+:|CONTEXT:|SQLSTATE|Applying migration \d{14}_)/.test(
            line,
          ),
        )
        .join("\n");
      writeFileSync(
        `${output}/${label}-diagnostics.log`,
        diagnostics ||
          "Startup failed; credential-bearing raw output was not retained.\n",
      );
    }
    throw Error("CASH_NATIVE_" + label);
  }
  records.push({
    label,
    assertions: tap ? assertNativeTap(result.stdout) : null,
  });
  return result.stdout;
}
try {
  started = true;
  command("supabase", ["start", "--workdir", successor], "start", {
    record: false,
  });
  command(
    "supabase",
    ["db", "reset", "--local", "--workdir", successor],
    "reset-local-only",
  );
  const info = JSON.parse(
    execFileSync(
      "docker",
      [
        "inspect",
        "--format",
        '{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.supabase.cli.project")}},"running":{{json .State.Running}},"networks":{{json .NetworkSettings.Networks}}}',
        "supabase_db_" + project,
      ],
      { encoding: "utf8" },
    ),
  );
  const ip = Object.values(info.networks).find((n) =>
    /^(172\.|192\.168\.|10\.)/.test(n.IPAddress),
  )?.IPAddress;
  if (
    info.project !== project ||
    !info.running ||
    !ip ||
    !/^[a-f0-9]{64}$/.test(info.id)
  )
    throw Error("CASH_NATIVE_EXACT_DISPOSABLE_REQUIRED");
  const remote = "/tmp/workroom-cash-" + manifest.head.slice(0, 12);
  command("docker", ["cp", successor + "/.", info.id + ":" + remote], "copy");
  command(
    "docker",
    [
      "cp",
      resolve(stage, "fixtures") + "/.",
      info.id + ":" + remote + "/workroom-fixtures",
    ],
    "fixture-copy",
  );
  const psql = [
    "exec",
    "-i",
    "-e",
    "PGPASSWORD=postgres",
    info.id,
    "psql",
    "-X",
    "-w",
    "-h",
    ip,
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-A",
    "-t",
    "-v",
    "ON_ERROR_STOP=1",
  ];
  command(
    "docker",
    [
      ...psql,
      "-c",
      "do $$begin if (select count(*) from supabase_migrations.schema_migrations)<>203 or to_regprocedure('public.read_workroom_cash(uuid)') is null then raise exception 'EXACT_203_REQUIRED';end if;end$$;",
    ],
    "schema",
  );
  command(
    "docker",
    [...psql, "-f", remote + "/workroom-fixtures/signup_metadata.sql"],
    "signup-fixture",
  );
  const failedTests = [];
  // Each psql process owns its transaction. A failed sequential fixture rolls
  // back on disconnect, so the independent race fixture can still report its
  // result. Both suites remain mandatory for a passing receipt.
  for (const path of WORKROOM_CASH_TESTS) {
    const label = path.split("/").at(-1);
    try {
      command("docker", [...psql, "-f", remote + "/" + path], label, {
        tap: true,
      });
    } catch {
      failedTests.push(label);
    }
  }
  writeFileSync(
    `${output}/receipt.json`,
    JSON.stringify(
      {
        state: failedTests.length ? "FAILED" : "PASSED",
        head: manifest.head,
        project,
        containerId: info.id,
        migrationCount: 203,
        records,
        failedTests,
        scope:
          "Early native SQL compile and direct-cash lifecycle/races; full historical and authenticated gates remain mandatory",
      },
      null,
      2,
    ) + "\n",
  );
  if (failedTests.length) throw Error("CASH_NATIVE_REQUIRED_SUITES_FAILED");
} finally {
  if (started)
    command(
      "supabase",
      ["stop", "--workdir", successor, "--no-backup"],
      "stop",
      { record: false },
    );
}
