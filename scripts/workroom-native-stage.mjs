import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  realpathSync,
  cpSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  WORKROOM_CASH_FILES,
  WORKROOM_CASH_ACL_TESTS,
  adaptWorkroomCashDefinerRoster,
} from "./workroom-cash-admission.mjs";
import { execFileSync } from "node:child_process";
import {
  WORKROOM_APP_FILES,
  adaptWorkroomAppDefinerRoster,
} from "./workroom-app-admission.mjs";
import {
  sha256,
  adaptWorkroomDefinerRoster,
  adaptWorkroomSignupFixtures,
  adaptWorkroomPractice,
  adaptWorkroomRetiredTrialAcl,
  adaptWorkroomWithdrawalPolicyVersions,
  adaptWorkroomSafeModeConcurrency,
} from "./workroom-native-adapters.mjs";
import {
  adaptBackend201NativeInput3,
  adaptBackend201DefinerRoster,
  adaptBackend201ServiceRoleInsertFloor,
} from "./backend-successor-201-native-stage.mjs";
import {
  buildPrincipal195Fixture,
  buildKrw195Fixture,
  buildConcurrency195Fixture,
  USDT_195_FROZEN_SOURCES,
} from "./usdt-manual-195-native-fixture-v3.mjs";
const ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
export const WORKROOM_MIGRATION =
  "supabase/migrations/20261104065015_workroom_practice_isolation.sql";
const MAP = "tests/e2e/fixtures/backend-successor-201-source.json";
const MAP_HASH =
  "5c141a642eb7964186277138e81f4ee4b51d2a211eb122a1c8eb2871afdbf75b";
const ACL = [
  "rls.sql",
  "ws04_security_money_workers.sql",
  "ai_conversation_storage.sql",
  "ai_conversation_summaries.sql",
  "ai_tool_evidence.sql",
];
export function buildWorkroomNativeFiles(root = ROOT) {
  const bytes = readFileSync(resolve(root, MAP));
  if (sha256(bytes) !== MAP_HASH)
    throw Error("WORKROOM_NATIVE_HISTORICAL_MAP_CHANGED");
  const map = JSON.parse(bytes),
    files = [];
  const basis = readFileSync(
    resolve(root, USDT_195_FROZEN_SOURCES.principal.path),
  );
  for (const row of map.nativeFiles) {
    let original = readFileSync(resolve(root, row.path));
    // Git text checkout may use CRLF for .inc. Admit only the pinned canonical
    // LF bytes; this never admits a semantic or whitespace edit.
    if (sha256(original) !== row.sourceSha256)
      original = Buffer.from(
        original.toString("utf8").replaceAll("\r\n", "\n"),
      );
    if (sha256(original) !== row.sourceSha256)
      throw Error("WORKROOM_NATIVE_HISTORICAL_SOURCE_CHANGED:" + row.path);
    let prepared = { sql: original.toString("utf8"), sha256: sha256(original) };
    if (row.path === USDT_195_FROZEN_SOURCES.principal.path)
      prepared = buildPrincipal195Fixture(original, {
        fullPayoutConfirmed: true,
      });
    else if (
      row.path === "supabase/tests/database/krw_deposit_journal_integrity.sql"
    )
      prepared = buildKrw195Fixture(original, { fullPayoutConfirmed: true });
    else if (
      row.path ===
      "supabase/tests/database/native_principal_finalize_input3_continuity.sql"
    )
      prepared = adaptBackend201NativeInput3(original, basis);
    else if (
      row.path.startsWith("supabase/tests/database/") &&
      ACL.includes(row.path.split("/").at(-1))
    )
      prepared = adaptBackend201DefinerRoster(
        row.path.split("/").at(-1),
        original,
      );
    else if (
      row.path ===
      "supabase/tests/database/service_role_image_default_floor.sql"
    )
      prepared = adaptBackend201ServiceRoleInsertFloor(original);
    if (sha256(prepared.sql) !== row.derivativeSha256)
      throw Error("WORKROOM_NATIVE_HISTORICAL_DERIVATIVE_CHANGED:" + row.path);
    let successor = String(prepared.sql);
    if (!row.path.startsWith("supabase/migrations/")) {
      if (ACL.includes(row.path.split("/").at(-1)))
        successor = adaptWorkroomDefinerRoster(successor).sql;
      if (row.path === "supabase/tests/database/rls.sql")
        successor = adaptWorkroomRetiredTrialAcl(successor).sql;
      if (row.path.startsWith("supabase/tests/database/"))
        successor = adaptWorkroomWithdrawalPolicyVersions(
          row.path.split("/").at(-1),
          successor,
        ).sql;
      if (
        row.path ===
        "supabase/tests-concurrent/safe_mode_concurrent_command.sql"
      )
        successor = adaptWorkroomSafeModeConcurrency(successor).sql;
      try {
        successor = adaptWorkroomSignupFixtures(successor).sql;
      } catch (e) {
        throw Error(e.message + ":" + row.path);
      }
    }
    files.push({
      path: row.path,
      baseline: prepared.sql,
      successor,
      sourceSha256: row.sourceSha256,
      baselineSha256: row.derivativeSha256,
      successorSha256: sha256(successor),
    });
  }
  if (files.length !== 332)
    throw Error("WORKROOM_NATIVE_332_HISTORICAL_INPUTS_REQUIRED");
  return files;
}
export function prepareWorkroomNativeStage(output, profile = "ci") {
  const target = resolve(output),
    rel = relative(ROOT, target);
  if (existsSync(target) || (!rel.startsWith("..") && !isAbsolute(rel)))
    throw Error("WORKROOM_NATIVE_NEW_EXTERNAL_STAGE_REQUIRED");
  const files = buildWorkroomNativeFiles();
  const reviewed = JSON.parse(
    readFileSync(resolve(ROOT, "scripts/workroom-native-roster.json"), "utf8"),
  );
  if (
    JSON.stringify(reviewed) !==
    JSON.stringify(
      files.map(({ path, sourceSha256, baselineSha256, successorSha256 }) => ({
        path,
        sourceSha256,
        baselineSha256,
        successorSha256,
      })),
    )
  )
    throw Error("WORKROOM_NATIVE_REVIEWED_ROSTER_CHANGED");
  const write = (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data, { flag: "wx" });
  };
  for (const f of files) {
    write(resolve(target, "baseline", f.path), f.baseline);
    write(resolve(target, "successor", f.path), f.successor);
  }
  const concurrency = buildConcurrency195Fixture(
    readFileSync(
      resolve(ROOT, USDT_195_FROZEN_SOURCES.concurrency.path),
      "utf8",
    ).replaceAll("\r\n", "\n"),
    { fullPayoutConfirmed: true },
  );
  for (const phase of ["baseline", "successor"])
    write(
      resolve(target, phase, "tests/integration/external-send-concurrency.py"),
      concurrency.sql,
    );
  if (!["ci", "local"].includes(profile))
    throw Error("WORKROOM_NATIVE_PROFILE_REQUIRED");
  let config = readFileSync(resolve(ROOT, "supabase/config.toml"), "utf8");
  if (!config.includes('project_id = "putduk-mining-ci-r2-20261009"'))
    throw Error("WORKROOM_NATIVE_CONFIG_BASIS_CHANGED");
  if (profile === "local")
    config = config
      .replace(
        'project_id = "putduk-mining-ci-r2-20261009"',
        'project_id = "putduk-mining-workroom-local-20261104"',
      )
      .replaceAll("6342", "6453");
  for (const phase of ["baseline", "successor"]) {
    write(resolve(target, phase, "supabase/config.toml"), config);
    for (const dir of ["seed", "functions"])
      cpSync(
        resolve(ROOT, "supabase", dir),
        resolve(target, phase, "supabase", dir),
        { recursive: true, errorOnExist: true },
      );
  }
  write(
    resolve(target, "successor", WORKROOM_MIGRATION),
    readFileSync(resolve(ROOT, WORKROOM_MIGRATION)),
  );
  const cashFiles = WORKROOM_CASH_FILES.map((path) => {
    const bytes = readFileSync(resolve(ROOT, path));
    write(resolve(target, "successor", path), bytes);
    return { path, sha256: sha256(bytes) };
  });
  const cashAclFiles = WORKROOM_CASH_ACL_TESTS.map((path) => {
    const original = files.find((file) => file.path === path);
    if (!original) throw Error("WORKROOM_CASH_ACL_SOURCE_MISSING");
    const adapted = adaptWorkroomCashDefinerRoster(original.successor, {
      occurrences: path.endsWith("/ws04_security_money_workers.sql") ? 2 : 1,
    });
    const stagedPath = "supabase/cash-regressions/" + path.split("/").at(-1);
    write(resolve(target, "successor", stagedPath), adapted.sql);
    return {
      path,
      stagedPath,
      originalSha256: adapted.originalSha256,
      sha256: adapted.sha256,
    };
  });
  const appFiles = WORKROOM_APP_FILES.map((path) => {
    const bytes = readFileSync(resolve(ROOT, path));
    write(resolve(target, "successor", path), bytes);
    return { path, sha256: sha256(bytes) };
  });
  const appAclFiles = cashAclFiles.map((record) => {
    const adapted = adaptWorkroomAppDefinerRoster(
      readFileSync(resolve(target, "successor", record.stagedPath), "utf8"),
      {
        occurrences: record.path.endsWith("/ws04_security_money_workers.sql")
          ? 2
          : 1,
      },
    );
    const stagedPath =
      "supabase/app-regressions/" + record.path.split("/").at(-1);
    write(resolve(target, "successor", stagedPath), adapted.sql);
    return {
      path: record.path,
      stagedPath,
      originalSha256: adapted.originalSha256,
      sha256: adapted.sha256,
    };
  });
  const practice = adaptWorkroomPractice(
    readFileSync(
      resolve(ROOT, "supabase/tests/database/workroom_practice.sql"),
      "utf8",
    ),
  ).sql;
  write(
    resolve(target, "successor/supabase/tests/database/workroom_practice.sql"),
    practice,
  );
  cpSync(
    resolve(ROOT, "supabase/workroom-test-fixtures"),
    resolve(target, "fixtures"),
    { recursive: true },
  );
  const fixtureHashes = Object.fromEntries(
    readdirSync(resolve(target, "fixtures"))
      .sort()
      .map((name) => [
        name,
        sha256(readFileSync(resolve(target, "fixtures", name))),
      ]),
  );
  const manifest = {
    kind: "WORKROOM_NATIVE_STAGE",
    state: "PREPARED_NOT_EXECUTED",
    profile,
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim(),
    historicalMapSha256: MAP_HASH,
    fixtureHashes,
    files: files.map(
      ({ path, sourceSha256, baselineSha256, successorSha256 }) => ({
        path,
        sourceSha256,
        baselineSha256,
        successorSha256,
      }),
    ),
    externalSendSha256: sha256(concurrency.sql),
    practiceSha256: sha256(practice),
    configSha256: sha256(config),
    migrationSha256: sha256(readFileSync(resolve(ROOT, WORKROOM_MIGRATION))),
    cashFiles,
    cashAclFiles,
    appFiles,
    appAclFiles,
  };
  write(
    resolve(target, "staging-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (
    ![4, 5].includes(process.argv.length) ||
    process.argv[2] !== "--prepare" ||
    (process.argv[4] && process.argv[4] !== "--local")
  )
    throw Error("WORKROOM_NATIVE_EXPLICIT_PREPARE_REQUIRED");
  execFileSync(
    process.execPath,
    [
      resolve(ROOT, "scripts/workroom-source-integrity.mjs"),
      "--verify",
      "--require-clean",
    ],
    { stdio: "inherit" },
  );
  const m = prepareWorkroomNativeStage(
    process.argv[3],
    process.argv[4] ? "local" : "ci",
  );
  console.log(
    JSON.stringify({
      state: m.state,
      profile: m.profile,
      files: m.files.length,
      output: resolve(process.argv[3]),
    }),
  );
}
