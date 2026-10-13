/** Pure exact test adapters plus explicit external staging. Never applies SQL. */
import { createHash } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  assertBackend201CanonicalSources,
  assertBackend201LocalSources,
} from "./backend-successor-201-source.mjs";
import {
  buildPrincipal195Fixture,
  buildKrw195Fixture,
  USDT_195_FROZEN_SOURCES,
} from "./usdt-manual-195-native-fixture-v3.mjs";
const ROOT = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const hash = (x) => createHash("sha256").update(x).digest("hex");
const ACL = Object.freeze({
  "rls.sql": [
    "8bbb3ac60738691c68f7fa7a12f39991ca4c242a68ee4c8a55551131bf2a67dc",
    1,
  ],
  "ws04_security_money_workers.sql": [
    "4cdc308ef0c2e023caed2e136620648450968428149f4e5d7eaaba71baa9a685",
    2,
  ],
  "ai_conversation_storage.sql": [
    "a01acbd4e2d780f85c023c8a6ba37bd34ad52b0c05de9af4f62cdd1622dd8d6b",
    1,
  ],
  "ai_conversation_summaries.sql": [
    "304c8f1d4e30fb80b0b643bf5e16305b65556ecf265c5f60d6896c2d6cb15904",
    1,
  ],
  "ai_tool_evidence.sql": [
    "4cd31ada54d15f490c6927d02de9683e7db69867c2bb8e641239803ef9082567",
    1,
  ],
});
export function adaptBackend201NativeInput3(source, basis) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (
    hash(bytes) !==
    "3127c394e860c3a8c99f801b83270670d034f2d85fed3f8cdfdaafb90b6e8ecf"
  )
    throw Error("BACKEND201_STAGE_INPUT3_SOURCE_CHANGED");
  const prepared = buildPrincipal195Fixture(basis, {
    fullPayoutConfirmed: true,
  });
  let sql = bytes.toString("utf8");
  for (const change of prepared.changes) {
    if (sql.split(change.before).length !== 2)
      throw Error("BACKEND201_STAGE_INPUT3_EXACT_SPAN_REQUIRED");
    sql = sql.replace(change.before, () => change.after);
  }
  let reversed = sql;
  for (const change of [...prepared.changes].reverse()) {
    if (reversed.split(change.after).length !== 2)
      throw Error("BACKEND201_STAGE_INPUT3_REVERSE_SPAN_REQUIRED");
    reversed = reversed.replace(change.after, () => change.before);
  }
  if (hash(reversed) !== hash(bytes))
    throw Error("BACKEND201_STAGE_INPUT3_REVERSE_FAILED");
  return {
    sql,
    sha256: hash(sql),
    originalSha256: hash(bytes),
    changes: prepared.changes.map(
      ({ name, beforeSha256, afterSha256, matches }) => ({
        name,
        beforeSha256,
        afterSha256,
        matches,
      }),
    ),
    reverseExact: true,
  };
}
export function adaptBackend201DefinerRoster(name, source) {
  const entry = ACL[name],
    bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (!entry || hash(bytes) !== entry[0])
    throw Error("BACKEND201_STAGE_ACL_SOURCE_CHANGED");
  const before =
      "        'app_private.ack_withdrawal_lifecycle_outbox(uuid,text)'::regprocedure,",
    after =
      before +
      "\n        'app_private.ack_safe_mode_outbox(uuid,text)'::regprocedure,";
  const sql = bytes.toString("utf8");
  if (sql.split(before).length !== entry[1] + 1)
    throw Error("BACKEND201_STAGE_ACL_EXACT_ROSTER_REQUIRED");
  const countBefore = "select count(*) = 83",
    countAfter = "select count(*) = 84";
  if (sql.split(countBefore).length !== 2)
    throw Error("BACKEND201_STAGE_ACL_EXACT_COUNT_REQUIRED");
  const next = sql
    .replaceAll(before, () => after)
    .replace(countBefore, () => countAfter);
  if (
    hash(
      next
        .replace(countAfter, () => countBefore)
        .replaceAll(after, () => before),
    ) !== entry[0]
  )
    throw Error("BACKEND201_STAGE_ACL_REVERSE_FAILED");
  return {
    sql: next,
    sha256: hash(next),
    originalSha256: entry[0],
    changes: [
      {
        name: "append-only-new-SECDEF-safe-mode-ack",
        matches: entry[1],
        beforeSha256: hash(before),
        afterSha256: hash(after),
      },
      {
        name: "exact-SECDEF-count-83-to-84-preserving-native-safe-mode-ack",
        matches: 1,
        beforeSha256: hash(countBefore),
        afterSha256: hash(countAfter),
      },
    ],
    reverseExact: true,
  };
}
export function adaptBackend201ServiceRoleInsertFloor(source) {
  const originalSha256 =
      "5f7304e8c9f145e2ed4596a38f4b3bfbbb4fe7ecfb048929b00f574dea2d4686",
    bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  if (hash(bytes) !== originalSha256)
    throw Error("BACKEND201_STAGE_INSERT_FLOOR_SOURCE_CHANGED");
  const before =
      "    'deposit_requests',\n    'event_consumer_deliveries',\n    'funding_principal_lots',",
    after = "    'deposit_requests',\n    'funding_principal_lots',",
    original = bytes.toString("utf8");
  if (original.split(before).length !== 2)
    throw Error("BACKEND201_STAGE_INSERT_FLOOR_EXACT_SPAN_REQUIRED");
  const sql = original.replace(before, () => after);
  if (
    sql.split(after).length !== 2 ||
    hash(sql.replace(after, () => before)) !== originalSha256
  )
    throw Error("BACKEND201_STAGE_INSERT_FLOOR_REVERSE_FAILED");
  return {
    sql,
    sha256: hash(sql),
    originalSha256,
    changes: [
      {
        name: "preserve-native-event-consumer-floor-compatibility",
        matches: 1,
        beforeSha256: hash(before),
        afterSha256: hash(after),
      },
    ],
    reverseExact: true,
  };
}
function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 2 ||
    args[0] !== "--prepare" ||
    !args[1].startsWith("--output=")
  )
    throw Error("BACKEND201_STAGE_EXPLICIT_PREPARE_REQUIRED");
  const scope = process.platform === "win32" ? "LOCAL_QA" : "CANONICAL_CI";
  const boundary =
    scope === "LOCAL_QA"
      ? assertBackend201LocalSources(ROOT)
      : assertBackend201CanonicalSources(ROOT);
  const parent =
      scope === "LOCAL_QA" ? "D:/PUTDUK-MINING-QA" : process.env.RUNNER_TEMP,
    output = resolve(args[1].slice(9));
  if (
    !parent ||
    resolve(dirname(output)) !== realpathSync(parent) ||
    !/^putduk-mining-native201-[0-9a-f-]{36}$/.test(basename(output)) ||
    existsSync(output)
  )
    throw Error("BACKEND201_STAGE_NEW_EXTERNAL_OUTPUT_REQUIRED");
  if (process.env.APP_ENV !== "test")
    throw Error("BACKEND201_STAGE_TEST_ENV_REQUIRED");
  if (
    scope === "LOCAL_QA" &&
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-Volume -DriveLetter D).FileSystemLabel",
      ],
      { encoding: "utf8", timeout: 10000, windowsHide: true },
    ).trim() !== "ESD-USB"
  )
    throw Error("BACKEND201_STAGE_QA_VOLUME_REQUIRED");
  mkdirSync(output);
  const records = [];
  const basis = readFileSync(
    resolve(ROOT, USDT_195_FROZEN_SOURCES.principal.path),
  );
  function copyTree(name) {
    const target = resolve(ROOT, name);
    if (realpathSync(target) !== target)
      throw Error("BACKEND201_STAGE_SOURCE_LINK_REJECTED");
    for (const entry of readdirSync(target, { withFileTypes: true })) {
      const path = name + "/" + entry.name;
      if (entry.isSymbolicLink())
        throw Error("BACKEND201_STAGE_SOURCE_LINK_REJECTED");
      if (entry.isDirectory()) {
        copyTree(path);
        continue;
      }
      if (!entry.isFile()) throw Error("BACKEND201_STAGE_SOURCE_TYPE_REJECTED");
      const original = readFileSync(resolve(ROOT, path));
      if (hash(original) !== boundary.sourceHashes[path])
        throw Error("BACKEND201_STAGE_COPY_SOURCE_CHANGED");
      let prepared = {
        sql: original,
        sha256: hash(original),
        originalSha256: hash(original),
        changes: [],
        reverseExact: true,
      };
      if (path === "supabase/tests/database/krw_deposit_journal_integrity.sql")
        prepared = {
          ...buildKrw195Fixture(original, { fullPayoutConfirmed: true }),
          originalSha256: hash(original),
          reverseExact: true,
        };
      else if (path === USDT_195_FROZEN_SOURCES.principal.path)
        prepared = {
          ...buildPrincipal195Fixture(original, { fullPayoutConfirmed: true }),
          originalSha256: hash(original),
          reverseExact: true,
        };
      else if (
        path ===
        "supabase/tests/database/native_principal_finalize_input3_continuity.sql"
      )
        prepared = adaptBackend201NativeInput3(original, basis);
      else if (path.startsWith("supabase/tests/database/") && ACL[entry.name])
        prepared = adaptBackend201DefinerRoster(entry.name, original);
      else if (
        path === "supabase/tests/database/service_role_image_default_floor.sql"
      )
        prepared = adaptBackend201ServiceRoleInsertFloor(original);
      if (prepared.sha256 !== boundary.nativeHashes[path])
        throw Error("BACKEND201_STAGE_REVIEWED_DERIVATIVE_CHANGED");
      const out = resolve(output, path);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, prepared.sql, { flag: "wx" });
      records.push({
        path,
        originalSha256: hash(original),
        sha256: prepared.sha256,
        changes: prepared.changes.map(
          ({ name, beforeSha256, afterSha256, matches }) => ({
            name,
            beforeSha256,
            afterSha256,
            matches,
          }),
        ),
        reverseExact: prepared.reverseExact,
      });
    }
  }
  copyTree("supabase/migrations");
  copyTree("supabase/tests");
  copyTree("supabase/test-fixtures");
  if (
    records.length !== 332 ||
    records
      .map((r) => r.path)
      .sort()
      .join("\n") !== Object.keys(boundary.nativeHashes).sort().join("\n")
  )
    throw Error("BACKEND201_STAGE_EXACT_332_ROSTER_REQUIRED");
  const after =
    scope === "LOCAL_QA"
      ? assertBackend201LocalSources(ROOT)
      : assertBackend201CanonicalSources(ROOT);
  if (after.manifestSha256 !== boundary.manifestSha256)
    throw Error("BACKEND201_STAGE_SOURCE_CHANGED_DURING_COPY");
  writeFileSync(
    resolve(output, "staging-manifest.json"),
    JSON.stringify(
      {
        kind: "BACKEND201_NATIVE_SOURCE_STAGING",
        state: "PREPARED_NOT_EXECUTED",
        scope,
        sourceManifestSha256: boundary.manifestSha256,
        sourceFiles: records.length,
        files: records,
        sqlExecuted: false,
        sourceModified: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      state: "PREPARED_NOT_EXECUTED",
      output,
      files: records.length,
      sqlExecuted: false,
    }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(
      /^BACKEND201_[A-Z0-9_]+$/.test(error?.message ?? "")
        ? error.message
        : "BACKEND201_STAGE_UNCONFIRMED",
    );
    process.exitCode = 1;
  }
}
