/** Exact current201 source admission; import performs no infrastructure/provider operation. */
import { createHash } from "node:crypto";
import { readFileSync, lstatSync, realpathSync, readdirSync } from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MAP = "tests/e2e/fixtures/backend-successor-201-source.json";
const MANIFEST_SHA256 =
  "6c539b69edaf047982cb71ee0e0bcf3919ce2e83716d15accc08df63cc6d3c87";
const digest = (x) => createHash("sha256").update(x).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const need = (v, r) => {
  if (!v) throw Error("BACKEND201_" + r);
};
export function assertBackend201Origin(origin, env = {}) {
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
function reviewed(root) {
  const base = realpathSync(root);
  assertBackend201Origin(
    execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: base,
      encoding: "utf8",
      timeout: 10000,
    }).trim(),
    process.env,
  );
  const owned = (name) => {
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
    const p = realpathSync(at),
      rel = relative(base, p);
    need(
      rel &&
        !isAbsolute(rel) &&
        rel !== ".." &&
        !rel.startsWith("../") &&
        !rel.startsWith("..\\"),
      "PATH_REJECTED",
    );
    return p;
  };
  const bytes = readFileSync(owned(MAP));
  need(digest(bytes) === MANIFEST_SHA256, "MANIFEST_CHANGED");
  const m = JSON.parse(bytes);
  need(
    m.version === 1 &&
      m.repository === "goldeget/putduk-mining" &&
      m.revision === 201 &&
      m.previousManifestSha256 ===
        "0e7b8386c41c4e242bab233d4ef03eab095f6f74c39a2beb29b13819df9bc28e",
    "EXACT_REVIEWED_REVISION_REQUIRED",
  );
  need(
    same(
      m.selfExcludedPaths.sort(),
      [MAP, "scripts/backend-successor-201-source.mjs"].sort(),
    ),
    "SELF_EXCLUSION_ROSTER_CHANGED",
  );
  for (const row of m.frozenHistoricalMaps)
    need(
      digest(readFileSync(owned(row.path))) === row.sha256,
      "FROZEN_HISTORY_CHANGED",
    );
  need(
    m.immutable197Migrations.length === 197 &&
      m.additionalMigrationPaths.length === 4,
    "EXACT_197_PLUS_FOUR_REQUIRED",
  );
  for (const row of m.immutable197Migrations)
    need(
      digest(readFileSync(owned(row.path))) === row.sha256,
      "IMMUTABLE_197_MIGRATION_CHANGED",
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
      /^[a-f0-9]{64}$/.test(expected) &&
        lstatSync(owned(name)).isFile() &&
        digest(readFileSync(owned(name))) === expected,
      "CURRENT_SOURCE_CHANGED",
    );
  const migrations = readdirSync(owned("supabase/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .map((n) => "supabase/migrations/" + n)
    .sort();
  need(
    migrations.length === 201 &&
      same(
        migrations,
        [
          ...m.immutable197Migrations.map((r) => r.path),
          ...m.additionalMigrationPaths,
        ].sort(),
      ) &&
      new Set(migrations.map((p) => p.split("/").at(-1).slice(0, 14))).size ===
        201,
    "EXACT_201_MIGRATIONS_REQUIRED",
  );
  need(
    m.nativeFiles.length === 332 &&
      new Set(m.nativeFiles.map((r) => r.path)).size === 332 &&
      m.nativeFiles.filter(
        (r) =>
          r.path.startsWith("supabase/tests/database/") &&
          r.path.endsWith(".sql"),
      ).length === 114,
    "EXACT_332_114_NATIVE_ROSTER_REQUIRED",
  );
  for (const row of m.nativeFiles)
    need(
      m.sourceHashes[row.path] === row.sourceSha256 &&
        /^[a-f0-9]{64}$/.test(row.derivativeSha256),
      "NATIVE_INPUT_CHANGED",
    );
  const t = m.ciTarget;
  need(
    t.projectId === "putduk-mining-ci-r2-20261009" &&
      t.apiPort === 63421 &&
      t.dbPort === 63422 &&
      t.configSha256 ===
        "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac" &&
      m.sourceHashes["supabase/config.toml"] === t.configSha256,
    "CI_TARGET_CHANGED",
  );
  return Object.freeze({
    scope: "CANONICAL_CI",
    repository: m.repository,
    ...t,
    migrationSources: 201,
    runtimeSources: m.legacyRuntimePaths.length,
    evidenceSources: m.nativeFiles.length,
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
export function assertBackend201CanonicalSources(root = ROOT) {
  need(arguments.length <= 1, "CALLER_OPTIONS_REJECTED");
  return reviewed(root);
}
export function assertBackend201LocalSources() {
  throw Error("BACKEND201_LOCAL_PROFILE_NOT_AUTHORIZED");
}
