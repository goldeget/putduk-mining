/** Candidate197 is independent of frozen 191/193/195 guard execution. */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, readdirSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAP = "tests/e2e/fixtures/backend-successor-197-source.json";
// Coordinator sets only after independent review. Empty is deliberately fail-closed.
const MANIFEST_SHA256 = "0e7b8386c41c4e242bab233d4ef03eab095f6f74c39a2beb29b13819df9bc28e";
const LOCAL_CONFIG =
  "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7";
const CANONICAL_CONFIG =
  "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac";
const HISTORY = [
  [
    "principal-review-r2-ci-source.json",
    "338ea5ab29065a5962d40047e3c2e4fd76825fd8ce453ac299b9152d08396bc1",
    183,
  ],
  [
    "principal-backend-engine-187-source.json",
    "1dc13d2b2c71524d37bc1c6bdde4bba4d4f988b707b1959d4597430b621eb9f3",
    187,
  ],
  [
    "principal-backend-first-188-source.json",
    "9c2ea55a0c06f07c3570f25ff80341e6ff67b37623ec497fde3062646882d616",
    188,
  ],
  [
    "principal-backend-first-191-source.json",
    "899bf27e5def9a2c48af491eaa1d2115134f0efbd40581f919c6155e5bb86adb",
    191,
  ],
  [
    "backend-http-local-193-source.json",
    "8957473c3170a41ca19835fc39a73542921dcd71abad4a58261ff7a760bda922",
    193,
  ],
  [
    "backend-http-195-source.json",
    "0d078c0787b5619edfebd800f3f6a5f00848540d97373fac369c87872313b3df",
    195,
  ],
];
const NEW_MIGRATIONS = [
  "supabase/migrations/20261011173627_withdrawal_completion_notification_original.sql",
  "supabase/migrations/20261011173637_safe_mode_closed_outbox_ack.sql",
];
const ALLOWED_REPLACEMENTS = [
  "app/api/v1/ai/chat/route.ts",
  "workers/runner.mjs",
  "playwright.backend-http-195.config.ts",
  "scripts/usdt-manual-195-native-fixture.mjs",
  "tests/unit/withdrawal-lifecycle-worker.test.ts",
  "tests/unit/ai-chat-audit-persistence-failure.test.ts",
].sort();
const hash = (x) => createHash("sha256").update(x).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pin = (x) => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
const fail = (x) => {
  throw Error("BACKEND197_" + x);
};
function reviewed(root, scope) {
  if (!pin(MANIFEST_SHA256)) fail("UNREVIEWED_MANIFEST");
  const base = realpathSync(root);
  const owned = (name) => {
    if (
      typeof name !== "string" ||
      isAbsolute(name) ||
      name.includes("\\") ||
      name.split("/").some((p) => !p || p === "." || p === "..")
    )
      fail("PATH_REJECTED");
    let path;
    try {
      path = realpathSync(resolve(base, name));
    } catch {
      fail("SOURCE_MISSING");
    }
    const loc = relative(base, path);
    if (
      !loc ||
      isAbsolute(loc) ||
      loc === ".." ||
      loc.startsWith("../") ||
      loc.startsWith("..\\")
    )
      fail("PATH_REJECTED");
    return path;
  };
  const read = (path, expected) => {
    const bytes = readFileSync(owned(path));
    if (hash(bytes) !== expected) fail("MANIFEST_CHANGED");
    try {
      return JSON.parse(bytes);
    } catch {
      fail("MANIFEST_INVALID");
    }
  };
  const old = [];
  let oldEvidence = [];
  for (const [name, sha, count] of HISTORY) {
    const layer = read("tests/e2e/fixtures/" + name, sha);
    if (
      layer.repository !== "goldeget/putduk-mining" ||
      layer.migration_count !== count
    )
      fail("HISTORY_INVALID");
    old.push(...layer.sources, ...(layer.additionalRuntimeSources ?? []));
    for (const replacement of layer.reviewedRuntimeOverrides ?? []) {
      const row = old.find((r) => r.path === replacement.path);
      if (
        !row ||
        row.sha256 !== replacement.previousSha256 ||
        !pin(replacement.reviewedSha256)
      )
        fail("HISTORY_OVERRIDE_INVALID");
      row.sha256 = replacement.reviewedSha256;
    }
    if (count === 195) oldEvidence = layer.evidenceSources;
  }
  const predecessor = [...old, ...oldEvidence].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  if (
    old.filter((r) => r.kind === "migration").length !== 195 ||
    old.filter((r) => r.kind === "runtime").length !== 33 ||
    new Set(predecessor.map((r) => r.path)).size !== predecessor.length
  )
    fail("HISTORY_INVENTORY_INVALID");
  const map = read(MAP, MANIFEST_SHA256);
  if (
    !equal(
      Object.keys(map).sort(),
      [
        "additionalSources",
        "migration_count",
        "previousEffectiveSha256",
        "previousManifestSha256",
        "replacements",
        "repository",
        "version",
      ].sort(),
    ) ||
    map.version !== 1 ||
    map.repository !== "goldeget/putduk-mining" ||
    map.migration_count !== 197 ||
    map.previousManifestSha256 !== HISTORY.at(-1)[1] ||
    map.previousEffectiveSha256 !== hash(JSON.stringify(predecessor))
  )
    fail("SUCCESSOR_INVALID");
  if (
    !Array.isArray(map.replacements) ||
    new Set(map.replacements.map((r) => r.path)).size !==
      map.replacements.length ||
    map.replacements.some((r) => !ALLOWED_REPLACEMENTS.includes(r.path))
  )
    fail("REPLACEMENT_ROSTER_INVALID");
  const effective = predecessor.map((row) => {
    const next = map.replacements.find((r) => r.path === row.path);
    if (!next) return { ...row };
    if (
      !equal(Object.keys(next).sort(), ["path", "previousSha256", "sha256"]) ||
      next.previousSha256 !== row.sha256 ||
      !pin(next.sha256) ||
      next.sha256 === row.sha256
    )
      fail("REPLACEMENT_INVALID");
    return { ...row, sha256: next.sha256 };
  });
  if (map.replacements.some((r) => !predecessor.some((p) => p.path === r.path)))
    fail("REPLACEMENT_SOURCE_MISSING");
  if (
    !Array.isArray(map.additionalSources) ||
    !equal(
      map.additionalSources
        .filter((r) => r.kind === "migration")
        .map((r) => r.path)
        .sort(),
      NEW_MIGRATIONS,
    )
  )
    fail("MIGRATION_ROSTER_INVALID");
  effective.push(...map.additionalSources);
  if (new Set(effective.map((r) => r.path)).size !== effective.length)
    fail("DUPLICATE_SOURCE");
  const migrations = effective.filter((r) => r.kind === "migration");
  const expectedTests = effective
    .filter(
      (row) =>
        row.path.startsWith("supabase/tests/") ||
        row.path.startsWith("supabase/test-fixtures/"),
    )
    .map((row) => row.path)
    .sort();
  const testFiles = [];
  const walk = (name) => {
    for (const entry of readdirSync(owned(name), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) fail("TEST_SOURCE_LINK_REJECTED");
      const path = name + "/" + entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) testFiles.push(path);
      else fail("TEST_SOURCE_TYPE_REJECTED");
    }
  };
  walk("supabase/tests");
  walk("supabase/test-fixtures");
  if (!equal(testFiles.sort(), expectedTests))
    fail("NATIVE_TEST_INVENTORY_CHANGED");
  const actual = readdirSync(owned("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .map((n) => "supabase/migrations/" + n)
    .sort();
  if (
    migrations.length !== 197 ||
    !equal(actual, migrations.map((r) => r.path).sort()) ||
    new Set(migrations.map((r) => r.path.split("/").at(-1).slice(0, 14)))
      .size !== 197
  )
    fail("MIGRATION_INVENTORY_CHANGED");
  for (const row of effective) {
    if (
      !equal(Object.keys(row).sort(), ["kind", "path", "sha256"]) ||
      !["migration", "runtime", "evidence"].includes(row.kind) ||
      !pin(row.sha256)
    )
      fail("SOURCE_ROW_INVALID");
    const expected =
      row.path === "supabase/config.toml"
        ? scope === "LOCAL_QA"
          ? LOCAL_CONFIG
          : CANONICAL_CONFIG
        : row.sha256;
    if (row.path === "supabase/config.toml" && row.sha256 !== CANONICAL_CONFIG)
      fail("CONFIG_PIN_CHANGED");
    if (hash(readFileSync(owned(row.path))) !== expected)
      fail("SOURCE_CHANGED");
  }
  const local = scope === "LOCAL_QA",
    config = readFileSync(owned("supabase/config.toml"), "utf8");
  const projectId = local
    ? "putduk-mining-backend-patch-20261011"
    : "putduk-mining-ci-r2-20261009";
  const apiPort = local ? 65421 : 63421,
    dbPort = local ? 65422 : 63422;
  const sectionPort = (name) =>
    Number(
      config
        .split(new RegExp("^\\[" + name + "\\]\\s*$", "m"))[1]
        ?.split(/^\[/m)[0]
        ?.match(/^port\s*=\s*([0-9]+)\s*$/m)?.[1],
    );
  if (
    config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1] !== projectId ||
    sectionPort("api") !== apiPort ||
    sectionPort("db") !== dbPort
  )
    fail("CONFIG_TARGET_MISMATCH");
  return Object.freeze({
    scope,
    repository: map.repository,
    projectId,
    apiPort,
    dbPort,
    migrationSources: 197,
    runtimeSources: 33,
    evidenceSources: effective.filter((r) => r.kind === "evidence").length,
    manifestSha256: MANIFEST_SHA256,
    previousManifestSha256: map.previousManifestSha256,
    sourceHashes: Object.freeze(
      Object.fromEntries(
        effective.map((row) => [
          row.path,
          row.path === "supabase/config.toml"
            ? local
              ? LOCAL_CONFIG
              : CANONICAL_CONFIG
            : row.sha256,
        ]),
      ),
    ),
    migrationVersions: Object.freeze(
      migrations.map((r) => r.path.split("/").at(-1).slice(0, 14)).sort(),
    ),
  });
}
export function assertBackend197CanonicalSources(root = ROOT) {
  if (arguments.length > 1) fail("CALLER_OPTIONS_REJECTED");
  return reviewed(root, "CANONICAL_CI");
}
export function assertBackend197LocalSources(root = ROOT) {
  if (arguments.length > 1) fail("CALLER_OPTIONS_REJECTED");
  return reviewed(root, "LOCAL_QA");
}
