/** Reviewed successor202 admission. Imports never start Git, infrastructure or provider calls. */
import { createHash } from "node:crypto";
import { readFileSync, lstatSync, realpathSync, readdirSync } from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAP = "tests/e2e/fixtures/backend-successor-202-source.json";
const MANIFEST_SHA256 =
  "3de315961a445d87a72e160606d109bc6668d9cfd152d358d430bfc2334b3d55";
export const BACKEND202_PREDECESSOR_SHA256 =
  "4f34894d5a433e205533f0d7dac4e8ee1cc270eab3b105745d6c305d88e3c2c1";
const OLD_GUARD_SHA =
  "134144dd7f2a490344729d1d70b2ca00caf9496945aed943966e2b21d89140f0";
export const BACKEND202_APPROVED_ADDITIONS = Object.freeze({
  "supabase/migrations/20261020195134_owner_admin_provisioning_intent.sql":
    "8b940aa6ee5c4f6f6e973b8b70c787703e18a0fce84f736c18ece89c497e28f3",
  "supabase/tests/database/owner_admin_provisioning_intent.sql":
    "85149e0ff37a63b0e293746dde6d3d071794ed166ecf7f3bef31b91cf4e20e25",
});
const digest = (x) => createHash("sha256").update(x).digest("hex");
const need = (v, r) => {
  if (!v) throw Error("BACKEND202_" + r);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => [...a].sort();
const pin = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function assertBackend202Origin(origin, env = {}) {
  need(
    origin === "https://github.com/goldeget/putduk-mining.git",
    "EXACT_ORIGIN_REQUIRED",
  );
  need(
    (env.GITHUB_REPOSITORY === undefined ||
      env.GITHUB_REPOSITORY === "goldeget/putduk-mining") &&
      (env.GITHUB_ACTIONS !== "true" ||
        env.GITHUB_REPOSITORY === "goldeget/putduk-mining"),
    "EXACT_CI_REPOSITORY_REQUIRED",
  );
}
function ownedReader(root) {
  const base = realpathSync(root);
  return (name) => {
    need(
      typeof name === "string" &&
        !isAbsolute(name) &&
        !name.includes("\\") &&
        !name.includes(":") &&
        name.split("/").every((p) => p && p !== "." && p !== ".."),
      "PATH_REJECTED",
    );
    let at = base;
    for (const part of name.split("/")) {
      at = resolve(at, part);
      need(!lstatSync(at).isSymbolicLink(), "SOURCE_LINK_REJECTED");
    }
    const file = realpathSync(at),
      rel = relative(base, file);
    need(
      rel &&
        !isAbsolute(rel) &&
        rel !== ".." &&
        !rel.startsWith("../") &&
        !rel.startsWith("..\\"),
      "PATH_REJECTED",
    );
    return file;
  };
}
function predecessor(owned) {
  const bytes = readFileSync(
    owned("tests/e2e/fixtures/backend-successor-201-source.json"),
  );
  need(
    digest(bytes) === BACKEND202_PREDECESSOR_SHA256,
    "PREDECESSOR_MAP_CHANGED",
  );
  need(
    digest(readFileSync(owned("scripts/backend-successor-201-source.mjs"))) ===
      OLD_GUARD_SHA,
    "PREDECESSOR_GUARD_CHANGED",
  );
  return JSON.parse(bytes);
}
function validate(m, old) {
  need(
    m &&
      m.version === 1 &&
      m.repository === "goldeget/putduk-mining" &&
      m.revision === 202 &&
      m.previousManifestSha256 === BACKEND202_PREDECESSOR_SHA256,
    "EXACT_REVIEWED_REVISION_REQUIRED",
  );
  need(
    m.admissionState === "REVIEWED_FINAL_INDEX_PINNED",
    "FINAL_INDEX_PIN_REQUIRED",
  );
  need(
    same(
      sorted(m.selfExcludedPaths || []),
      sorted([MAP, "scripts/backend-successor-202-source.mjs"]),
    ),
    "SELF_EXCLUSION_ROSTER_CHANGED",
  );
  need(
    same(m.frozenHistoricalMaps, [
      ...old.frozenHistoricalMaps,
      {
        path: "tests/e2e/fixtures/backend-successor-201-source.json",
        sha256: BACKEND202_PREDECESSOR_SHA256,
      },
    ]),
    "FROZEN_HISTORY_ROSTER_CHANGED",
  );
  const immutable201 = [
    ...old.immutable197Migrations,
    ...old.additionalMigrationPaths.map((path) => ({
      path,
      sha256: old.sourceHashes[path],
    })),
  ];
  need(
    same(m.immutable197Migrations, old.immutable197Migrations) &&
      same(m.immutable201Migrations, immutable201) &&
      m.immutable201Migrations.length === 201,
    "IMMUTABLE_201_ROSTER_CHANGED",
  );
  need(
    same(m.additionalMigrationPaths, [
      Object.keys(BACKEND202_APPROVED_ADDITIONS)[0],
    ]),
    "EXACT_ONE_APPROVED_MIGRATION_REQUIRED",
  );
  need(
    same(m.legacyRuntimePaths, old.legacyRuntimePaths),
    "LEGACY_RUNTIME_ROSTER_CHANGED",
  );
  need(
    m.sourceHashes &&
      typeof m.sourceHashes === "object" &&
      !Array.isArray(m.sourceHashes) &&
      Object.values(m.sourceHashes).every(pin),
    "SOURCE_HASHES_REQUIRED",
  );
  for (const [path, sha] of Object.entries(old.sourceHashes)) {
    if (
      /(?:scripts\/[^/]*201[^/]*|playwright\.[^/]*201[^/]*\.ts)$/.test(path)
    ) {
      need(m.sourceHashes[path] === sha, "HISTORICAL_201_LEAF_CHANGED");
    }
  }
  const expectedNative = [
    ...old.nativeFiles,
    ...Object.entries(BACKEND202_APPROVED_ADDITIONS).map(([path, sha]) => ({
      path,
      sourceSha256: sha,
      derivativeSha256: sha,
    })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  need(
    Array.isArray(m.nativeFiles) &&
      m.nativeFiles.length === 334 &&
      new Set(m.nativeFiles.map((r) => r.path)).size === 334 &&
      same(
        [...m.nativeFiles].sort((a, b) => a.path.localeCompare(b.path)),
        expectedNative,
      ),
    "EXACT_334_NATIVE_ROSTER_REQUIRED",
  );
  need(
    m.nativeFiles.filter(
      (r) =>
        r.path.startsWith("supabase/tests/database/") &&
        r.path.endsWith(".sql"),
    ).length === 115,
    "EXACT_115_DATABASE_TESTS_REQUIRED",
  );
  for (const row of m.nativeFiles)
    need(
      m.sourceHashes[row.path] === row.sourceSha256 &&
        pin(row.derivativeSha256),
      "NATIVE_INPUT_CHANGED",
    );
  for (const row of immutable201)
    need(
      m.sourceHashes[row.path] === row.sha256,
      "IMMUTABLE_201_SOURCE_CHANGED",
    );
  for (const [path, sha] of Object.entries(BACKEND202_APPROVED_ADDITIONS))
    need(m.sourceHashes[path] === sha, "APPROVED_OWNER_SOURCE_CHANGED");
  const consumers = Object.keys(old.browserConsumerHashes).map((p) =>
    p.replaceAll("201", "202"),
  );
  need(
    m.browserConsumerHashes &&
      same(sorted(Object.keys(m.browserConsumerHashes)), sorted(consumers)) &&
      consumers.every(
        (p) =>
          pin(m.browserConsumerHashes[p]) &&
          m.sourceHashes[p] === m.browserConsumerHashes[p],
      ),
    "BROWSER_CONSUMER_ROSTER_CHANGED",
  );
  need(
    same(m.ciTarget, old.ciTarget) &&
      m.ciTarget.projectId === "putduk-mining-ci-r2-20261009" &&
      m.ciTarget.apiPort === 63421 &&
      m.ciTarget.dbPort === 63422 &&
      m.ciTarget.configSha256 ===
        "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac" &&
      m.sourceHashes["supabase/config.toml"] === m.ciTarget.configSha256,
    "CI_TARGET_CHANGED",
  );
  return m;
}
/** Pure shape checks are not source admission and never yield an execution boundary. */
export function assertBackend202ManifestShape(manifest) {
  need(arguments.length === 1, "CALLER_OPTIONS_REJECTED");
  validate(manifest, predecessor(ownedReader(ROOT)));
  return Object.freeze({ state: "SHAPE_VALIDATED_NOT_SOURCE_ADMITTED" });
}
export function assertBackend202CanonicalSources(root = ROOT) {
  need(arguments.length <= 1, "CALLER_OPTIONS_REJECTED");
  const base = realpathSync(root),
    owned = ownedReader(base);
  assertBackend202Origin(
    execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: base,
      encoding: "utf8",
      timeout: 10000,
    }).trim(),
    process.env,
  );
  need(MANIFEST_SHA256 !== "0".repeat(64), "FINAL_INDEX_PIN_REQUIRED");
  const bytes = readFileSync(owned(MAP));
  need(digest(bytes) === MANIFEST_SHA256, "MANIFEST_CHANGED");
  const m = validate(JSON.parse(bytes), predecessor(owned));
  for (const row of m.frozenHistoricalMaps)
    need(
      digest(readFileSync(owned(row.path))) === row.sha256,
      "FROZEN_HISTORY_CHANGED",
    );
  for (const row of m.immutable201Migrations)
    need(
      digest(readFileSync(owned(row.path))) === row.sha256,
      "IMMUTABLE_201_MIGRATION_CHANGED",
    );
  const names = execFileSync("git", ["ls-files", "--cached", "-z"], {
    cwd: base,
    encoding: "utf8",
    timeout: 10000,
  })
    .split("\0")
    .filter(Boolean)
    .sort();
  need(
    same(
      names,
      [...Object.keys(m.sourceHashes), ...m.selfExcludedPaths].sort(),
    ),
    "COMPLETE_TRACKED_SOURCE_ROSTER_CHANGED",
  );
  need(
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: base,
      encoding: "utf8",
      timeout: 10000,
    }) === "",
    "CLEAN_CHECKOUT_REQUIRED",
  );
  for (const [name, expected] of Object.entries(m.sourceHashes))
    need(
      lstatSync(owned(name)).isFile() &&
        digest(readFileSync(owned(name))) === expected,
      "CURRENT_SOURCE_CHANGED",
    );
  const migrations = readdirSync(owned("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .map((n) => "supabase/migrations/" + n)
    .sort();
  need(
    migrations.length === 202 &&
      same(
        migrations,
        [
          ...m.immutable201Migrations.map((r) => r.path),
          ...m.additionalMigrationPaths,
        ].sort(),
      ) &&
      new Set(migrations.map((p) => p.split("/").at(-1).slice(0, 14))).size ===
        202,
    "EXACT_202_MIGRATIONS_REQUIRED",
  );
  return Object.freeze({
    scope: "CANONICAL_CI",
    repository: m.repository,
    ...m.ciTarget,
    migrationSources: 202,
    runtimeSources: m.legacyRuntimePaths.length,
    evidenceSources: 334,
    manifestSha256: MANIFEST_SHA256,
    previousManifestSha256: m.previousManifestSha256,
    sourceHashes: Object.freeze({ ...m.sourceHashes }),
    nativeHashes: Object.freeze(
      Object.fromEntries(
        m.nativeFiles.map((r) => [r.path, r.derivativeSha256]),
      ),
    ),
    migrationVersions: Object.freeze(
      migrations.map((p) => p.split("/").at(-1).slice(0, 14)),
    ),
    browserConsumerHashes: Object.freeze({ ...m.browserConsumerHashes }),
  });
}
export function assertBackend202LocalSources() {
  throw Error("BACKEND202_LOCAL_PROFILE_NOT_AUTHORIZED");
}
