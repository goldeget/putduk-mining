import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  realpathSync as nodeRealpathSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { dirname, resolve, relative, isAbsolute, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  stageBackend197UnitFixtureSource,
  backend197UnitConfigPair,
} from "./backend-successor-197-unit-fixture.mjs";

const realpathSync = nodeRealpathSync.native ?? nodeRealpathSync;

// This module constructs historical test fixtures only. Runtime source guards
// continue to inspect the actual checkout and do not import this module.
const PRESERVED = "630ca8ac2cfda90e39cdf6e04b0df906986cb275";
const BASELINE = "e220356be85a56e21e3469023b19b0c2fd4aebba";
const repository = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const maps = [
  [185, "principal-review-r2-ci-source.json"],
  [187, "principal-backend-engine-187-source.json"],
  [188, "principal-backend-first-188-source.json"],
  [191, "principal-backend-first-191-source.json"],
  [193, "backend-http-local-193-source.json"],
  [195, "backend-http-195-source.json"],
  [197, "backend-successor-197-source.json"],
];
const gitCache = new Map();
const sourceCache = new Map();
const pinCache = new Map();
const manifestStats = new Map();
function safePath(path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.includes("\\") ||
    path.includes(":") ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw Error("HISTORICAL_RECOVERY_PATH_REJECTED");
  return path;
}
function owned(root, path) {
  safePath(path);
  if (realpathSync(root) !== repository)
    throw Error("HISTORICAL_RECOVERY_ROOT_REJECTED");
  const full = realpathSync(resolve(root, path));
  const rel = relative(repository, full);
  if (
    !rel ||
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith("../") ||
    rel.startsWith("..\\")
  )
    throw Error("HISTORICAL_RECOVERY_PATH_REJECTED");
  return full;
}
function gitBytes(head, path) {
  safePath(path);
  const key = head + ":" + path;
  if (!gitCache.has(key))
    gitCache.set(
      key,
      execFileSync("git", ["--no-optional-locks", "show", key], {
        cwd: repository,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  return gitCache.get(key);
}
function effectivePins(generation, verifyCurrentManifests = true) {
  if (![191, 193, 195, 197].includes(generation))
    throw Error("HISTORICAL_RECOVERY_GENERATION_REJECTED");
  // Cached JSON parsing never suppresses a later frozen-manifest change.
  if (verifyCurrentManifests || !pinCache.has(generation))
    for (const [version, name] of maps) {
      if (version > generation) continue;
      const path = "tests/e2e/fixtures/" + name;
      const full = owned(repository, path);
      const stat = statSync(full, { bigint: true });
      const stamp = [
        stat.dev,
        stat.ino,
        stat.size,
        stat.mtimeNs,
        stat.ctimeNs,
      ].join(":");
      if (manifestStats.get(path) !== stamp) {
        if (digest(readFileSync(full)) !== digest(gitBytes(PRESERVED, path)))
          throw Error("HISTORICAL_RECOVERY_MANIFEST_CHANGED");
        manifestStats.set(path, stamp);
      }
    }
  if (pinCache.has(generation)) return pinCache.get(generation);
  const pins = new Map();
  for (const [version, name] of maps) {
    if (version > generation) continue;
    const path = "tests/e2e/fixtures/" + name;
    const frozen = gitBytes(PRESERVED, path);
    if (digest(readFileSync(owned(repository, path))) !== digest(frozen))
      throw Error("HISTORICAL_RECOVERY_MANIFEST_CHANGED");
    pins.set(path, digest(frozen));
    const map = JSON.parse(frozen.toString("utf8"));
    for (const row of [
      ...(map.sources ?? []),
      ...(map.additionalRuntimeSources ?? []),
      ...(map.evidenceSources ?? []),
      ...(map.additionalSources ?? []),
    ])
      pins.set(safePath(row.path), row.sha256);
    for (const row of map.reviewedRuntimeOverrides ?? [])
      pins.set(safePath(row.path), row.reviewedSha256);
    for (const row of map.replacements ?? []) {
      if (pins.get(safePath(row.path)) !== row.previousSha256)
        throw Error("HISTORICAL_RECOVERY_PREDECESSOR_PIN_CHANGED");
      pins.set(row.path, row.sha256);
    }
  }
  pinCache.set(generation, pins);
  return pins;
}
export function verifyHistoricalRecoveryBytes(path, bytes, generation) {
  safePath(path);
  const expected = effectivePins(generation).get(path);
  if (!expected || digest(bytes) !== expected)
    throw Error("HISTORICAL_RECOVERY_BLOB_CHANGED");
  return true;
}
export function readHistoricalRecoverySource(root, path, generation) {
  return readHistoricalBytes(root, path, generation, false);
}
// Frozen fixture constructors copy only independently verified immutable bytes.
// Each manifest source is rechecked; cached product blobs need no current-file
// attestation because this path makes no claim about the current product.
export function readHistoricalRecoveryFixtureSource(root, path, generation) {
  return readHistoricalBytes(root, path, generation, true);
}
function readHistoricalBytes(root, path, generation, fixtureCopy) {
  safePath(path);
  if (root !== repository && realpathSync(root) !== repository)
    throw Error("HISTORICAL_RECOVERY_ROOT_REJECTED");
  const isManifest = /^tests\/e2e\/fixtures\/[^/]+\.json$/.test(path);
  const pins = effectivePins(generation, !fixtureCopy || isManifest);
  let expected = pins.get(path);
  // Predecessor manifests/profile are themselves exact preserved test evidence.
  if (!expected) {
    if (!/^tests\/e2e\/fixtures\/[^/]+\.json$/.test(path))
      throw Error("HISTORICAL_RECOVERY_UNMAPPED_SOURCE");
    expected = digest(gitBytes(PRESERVED, path));
  }
  // Configuration mode conversion remains the separately pinned original code.
  if (path === "supabase/config.toml") {
    const data = readFileSync(owned(root, path));
    if (
      ![
        "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac",
        "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7",
      ].includes(digest(data))
    )
      throw Error("HISTORICAL_RECOVERY_CONFIG_CHANGED");
    return data;
  }
  const key = generation + ":" + path + ":" + expected;
  if (!fixtureCopy) owned(root, path);
  if (sourceCache.has(key)) return Buffer.from(sourceCache.get(key));
  let current;
  try {
    current = readFileSync(owned(root, path));
  } catch (error) {
    // Fixture copies attest immutable historical bytes, not a current path.
    // A reviewed rename may remove that path; only ENOENT can fall through
    // to the existing exact-hash Git/archive recovery below. Runtime reads
    // and all root/path/symlink or other filesystem errors remain failures.
    if (!fixtureCopy || error.code !== "ENOENT") throw error;
  }
  if (current && digest(current) === expected) {
    sourceCache.set(key, current);
    return Buffer.from(current);
  }
  // Only these immutable commits and hash-addressed preserved archives qualify.
  for (const [head, candidate] of [
    [PRESERVED, path],
    [BASELINE, path],
    [
      PRESERVED,
      "tests/e2e/fixtures/backend-predecessor-195/" + expected + ".source.txt",
    ],
  ]) {
    let data;
    try {
      data = gitBytes(head, candidate);
    } catch {
      continue;
    }
    if (digest(data) === expected) {
      sourceCache.set(key, data);
      return Buffer.from(data);
    }
  }
  throw Error("HISTORICAL_RECOVERY_EXACT_BLOB_UNAVAILABLE");
}
export function preloadHistorical193UnitFixtureSources(root) {
  if (realpathSync(root) !== repository)
    throw Error("HISTORICAL_RECOVERY_ROOT_REJECTED");
  const paths = new Set([
    ...effectivePins(193).keys(),
    ...[
      "backend-http-local-execution-profile.json",
      "principal-review-r2-source.json",
      "principal-integrated-source.json",
      "principal-local-recovery-source.json",
      "principal-local-recovery-source-v3.json",
      "principal-local-recovery-source-v4.json",
    ].map((name) => "tests/e2e/fixtures/" + name),
  ]);
  for (const path of paths)
    if (path !== "supabase/config.toml")
      readHistoricalRecoveryFixtureSource(root, path, 193);
}
// Construction readiness only: no guard result or source-read cache is retained.
// The test body independently reads and hashes every source after this check.
export function verifyPreparedHistoricalFixture(root, entries, prefix) {
  if (
    ![
      "putduk-backend197-unit-",
      "putduk-backend-195-source-",
      "putduk-backend-http-source-",
    ].includes(prefix)
  )
    throw Error("HISTORICAL_RECOVERY_FIXTURE_SCOPE_REJECTED");
  const physicalRoot = realpathSync(root);
  if (
    dirname(physicalRoot) !== realpathSync(tmpdir()) ||
    !basename(physicalRoot).startsWith(prefix)
  )
    throw Error("HISTORICAL_RECOVERY_FIXTURE_SCOPE_REJECTED");
  for (const [path, expected] of entries) {
    safePath(path);
    const actual = realpathSync(resolve(physicalRoot, path));
    const rel = relative(physicalRoot, actual);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\")
    )
      throw Error("HISTORICAL_RECOVERY_FIXTURE_SCOPE_REJECTED");
    if (!Buffer.from(readFileSync(actual)).equals(Buffer.from(expected)))
      throw Error("HISTORICAL_RECOVERY_FIXTURE_COPY_CHANGED");
  }
}
export function prepareBackend197UnitFixtures(root, scratch, prefix, roots) {
  if (
    realpathSync(root) !== repository ||
    realpathSync(scratch) !== realpathSync(tmpdir()) ||
    prefix !== "putduk-backend197-unit-" ||
    !Array.isArray(roots)
  )
    throw Error("HISTORICAL_RECOVERY_FIXTURE_SCOPE_REJECTED");
  const pins = effectivePins(197);
  const bytes = new Map(
    [...pins.keys()].map((path) => [
      path,
      readHistoricalRecoveryFixtureSource(root, path, 197),
    ]),
  );
  const configs = backend197UnitConfigPair(
    bytes.get("supabase/config.toml").toString("utf8"),
  );
  let active;
  return {
    prepare() {
      active = realpathSync(mkdtempSync(resolve(scratch, prefix)));
      if (
        dirname(active) !== realpathSync(scratch) ||
        !basename(active).startsWith(prefix)
      )
        throw Error("HISTORICAL_RECOVERY_FIXTURE_SCOPE_REJECTED");
      roots.push(active);
      for (const [path, data] of bytes) {
        mkdirSync(dirname(resolve(active, path)), { recursive: true });
        writeFileSync(resolve(active, path), data);
      }
      writeFileSync(resolve(active, "supabase/config.toml"), configs.canonical);
      verifyPreparedHistoricalFixture(
        active,
        new Map([...bytes, ["supabase/config.toml", configs.canonical]]),
        prefix,
      );
    },
    root(mode) {
      if (!active || !["canonical", "local"].includes(mode))
        throw Error("HISTORICAL_RECOVERY_FIXTURE_REQUIRED");
      writeFileSync(resolve(active, "supabase/config.toml"), configs[mode]);
      return active;
    },
  };
}
export function prepareHistorical195UnitFixtures(root, scratch, prefix, roots) {
  if (
    realpathSync(root) !== repository ||
    realpathSync(scratch) !== realpathSync(tmpdir()) ||
    prefix !== "putduk-backend-195-source-" ||
    !Array.isArray(roots)
  )
    throw Error("HISTORICAL_RECOVERY_FIXTURE_SCOPE_REJECTED");
  const paths = new Set(effectivePins(195).keys());
  for (const name of [
    "principal-review-r2-source.json",
    "principal-integrated-source.json",
    "principal-local-recovery-source.json",
    "principal-local-recovery-source-v3.json",
    "principal-local-recovery-source-v4.json",
    "backend-http-local-execution-profile.json",
  ])
    paths.add("tests/e2e/fixtures/" + name);
  const bytes = new Map(
    [...paths].map((path) => [
      path,
      readHistoricalRecoveryFixtureSource(root, path, 195),
    ]),
  );
  const configs = backend197UnitConfigPair(
    bytes.get("supabase/config.toml").toString("utf8"),
  );
  let prepared = [];
  return {
    prepare(name) {
      const count = [
        "rejects local config through canonical and canonical through local",
        "rejects changed consumer and typed fixtures",
      ].includes(name)
        ? 2
        : 1;
      prepared = [];
      for (let index = 0; index < count; index++) {
        const active = realpathSync(mkdtempSync(resolve(scratch, prefix)));
        if (
          dirname(active) !== realpathSync(scratch) ||
          !basename(active).startsWith(prefix)
        )
          throw Error("HISTORICAL_RECOVERY_FIXTURE_SCOPE_REJECTED");
        roots.push(active);
        for (const [path, data] of bytes) {
          mkdirSync(dirname(resolve(active, path)), { recursive: true });
          writeFileSync(resolve(active, path), data);
        }
        verifyPreparedHistoricalFixture(active, bytes, prefix);
        prepared.push(active);
      }
    },
    root(mode) {
      const active = prepared.shift();
      if (!active || !["canonical", "local"].includes(mode))
        throw Error("HISTORICAL_RECOVERY_FIXTURE_REQUIRED");
      writeFileSync(resolve(active, "supabase/config.toml"), configs[mode]);
      return active;
    },
  };
}
const changes = {
  "principal-e2e-source.test.ts": [
    "writeFileSync(target, readFileSync(path));",
    'writeFileSync(target, readHistoricalRecoveryFixtureSource(resolve("."), path, 191));',
  ],
  "usdt-manual-195-native-fixture-v2.test.ts": [
    'import { readFileSync } from "node:fs";',
    'import { readHistoricalNativeProvenance as readFileSync } from "../../scripts/historical-recovery-unit-stage.mjs";',
  ],
  "backend-successor-197-browser-source.test.ts": [
    "copyFileSync(resolve(p), resolve(root, p));",
    'writeFileSync(resolve(root, p), readHistoricalBrowserTransportSource(resolve("."), p));',
  ],
  "usdt-manual-195-native-fixture-v3.test.ts": [
    'import { readFileSync } from "node:fs";',
    'import { readHistoricalNativeProvenance as readFileSync } from "../../scripts/historical-recovery-unit-stage.mjs";',
  ],
  "brand-assets.test.ts": [
    'import { readFile } from "node:fs/promises";',
    'import { readBrandFixtureFile as readFile, primeBrandFixtureReads } from "../../scripts/brand-unit-file-cache.mjs";',
  ],
  "principal-review-r2-source.test.ts": [
    "copyFileSync(name, target)",
    "writeFileSync(target, readHistoricalRecoveryFixtureSource(projectRoot, name, 191))",
  ],
  "backend-http-canonical-source.test.ts": [
    "readPredecessor193TestSource(checkout, name)",
    "readHistoricalRecoveryFixtureSource(checkout, name, 193)",
  ],
  "backend-http-local-source.test.ts": [
    "readPredecessor193TestSource(checkout, name)",
    "readHistoricalRecoveryFixtureSource(checkout, name, 193)",
  ],
  "backend-http-195-source.test.ts": [
    "readPredecessor195TestSource(ROOT, path)",
    "readHistoricalRecoveryFixtureSource(ROOT, path, 195)",
  ],
  "backend-successor-197-source.test.ts": [
    '"../../scripts/backend-successor-197-unit-fixture.mjs"',
    '"../../scripts/historical-recovery-unit-stage.mjs"',
  ],
};
// Exact Prettier 3.9.9 projections of the immutable 630 originals, using the
// preserved repository prettier.config.mjs. These are test input projections,
// never replacement pins for current product/runtime source acceptance.
const formattedInputs = {
  "usdt-manual-195-native-fixture-v2.test.ts":
    "dc2e39c8b2e4facbf081168bea71031d3a4b090e06e833fa2f2078d03624420c",
  "usdt-manual-195-native-fixture-v3.test.ts":
    "941b687b98f92aa90c7df232c5c3e6d8ac22e0a81a0358b784e563edc13154be",
  "principal-review-r2-source.test.ts":
    "28477c2e9b120bacc2aad628f470472f8d1151e3f8c22b77068933f87a2109da",
  "backend-http-canonical-source.test.ts":
    "fa710ec6ac9a03951d8014ba24cff8849ab3f0ce27aae6cc38e516cdde4be2f4",
  "backend-http-local-source.test.ts":
    "238c7ddd7e1f5140c67665ed45aa22905867dc1eccfd0d05fd53592b84aeb41a",
  "backend-http-195-source.test.ts":
    "c9781b2180d5c2998dfdfe63dbaf47021e4172422f5a7c6d322291cf5b06d054",
};

// Only byte-provenance reads use immutable original helpers. Imported derivative
// implementations remain the actual current modules, so behavior is still tested.
export function readHistoricalNativeProvenance(path, ...options) {
  const pins = {
    "scripts/usdt-manual-195-native-fixture-v2.mjs":
      "7a50c15227c9dffe55d21530f0a0c7f4e12d760f6e35af8dec70cc0867dc4a97",
    "scripts/usdt-manual-195-native-fixture-v3.mjs":
      "38a348adea4891c05a94c6472094d13aa059de0f0bc3a13dd0e6a3fc9fd14030",
    "scripts/usdt-manual-195-native-fixture.d.mts":
      "d3b6b3cc927c759b1aabd414fa279a376a0e1dbcd4aba29087c350dab995a138",
    "scripts/usdt-manual-195-native-fixture-v2.d.mts":
      "d3b6b3cc927c759b1aabd414fa279a376a0e1dbcd4aba29087c350dab995a138",
    "scripts/usdt-manual-195-native-fixture-v3.d.mts":
      "d3b6b3cc927c759b1aabd414fa279a376a0e1dbcd4aba29087c350dab995a138",
  };
  if (Object.hasOwn(pins, path)) {
    if (options.length) throw Error("HISTORICAL_RECOVERY_ENCODING_REJECTED");
    const bytes = gitBytes(PRESERVED, path);
    if (digest(bytes) !== pins[path])
      throw Error("HISTORICAL_RECOVERY_BLOB_CHANGED");
    return Buffer.from(bytes);
  }
  return readFileSync(path, ...options);
}

export function readHistoricalBrowserTransportSource(root, path) {
  if (realpathSync(root) !== repository)
    throw Error("HISTORICAL_RECOVERY_ROOT_REJECTED");
  safePath(path);
  const guard = gitBytes(
    PRESERVED,
    "scripts/backend-successor-197-browser-source.mjs",
  ).toString("utf8");
  const pins = new Map(
    [...guard.matchAll(/"([^"\n]+)":\s*"([a-f0-9]{64})"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  if (pins.size !== 12 || !pins.has(path))
    throw Error("HISTORICAL_RECOVERY_UNMAPPED_SOURCE");
  const bytes = gitBytes(PRESERVED, path);
  if (digest(bytes) !== pins.get(path))
    throw Error("HISTORICAL_RECOVERY_BLOB_CHANGED");
  return Buffer.from(bytes);
}

export function stageHistoricalRecoveryTestSource(source, name) {
  const change = changes[name];
  if (!change) throw Error("HISTORICAL_RECOVERY_TEST_REJECTED");
  const original = gitBytes(PRESERVED, "tests/unit/" + name).toString("utf8");
  const frozen =
    name === "backend-successor-197-source.test.ts"
      ? stageBackend197UnitFixtureSource(original)
      : original;
  if (
    digest(source) !== digest(frozen) &&
    digest(source) === formattedInputs[name]
  )
    source = original;
  if (digest(source) !== digest(frozen) || source.split(change[0]).length !== 2)
    throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
  if (name === "backend-http-local-source.test.ts") {
    const start = frozen.indexOf("function fixture() {"),
      end = frozen.indexOf("\nfunction changed(", start);
    if (start < 0 || end <= start)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const span = frozen.slice(start, end),
      before = 'import { afterEach, describe, expect, it } from "vitest";',
      after =
        'import { afterEach, beforeEach, describe, expect, it } from "vitest";';
    const finish = "  return { root, baseline, manifest, allSources };";
    if (span.split(finish).length !== 2)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const replacement =
      "preloadHistorical193UnitFixtureSources(checkout);\nlocalTestConfig();\n" +
      'let preparedLocalFixture: ReturnType<typeof constructHistoricalLocalFixture> | undefined;\nbeforeEach(() => { preparedLocalFixture = constructHistoricalLocalFixture(); });\nfunction fixture() {\n  const value = preparedLocalFixture;\n  if (!value) throw new Error("HISTORICAL_RECOVERY_FIXTURE_REQUIRED");\n  preparedLocalFixture = undefined;\n  return value;\n}\n' +
      span
        .replace(
          "function fixture()",
          "function constructHistoricalLocalFixture()",
        )
        .replace(change[0], change[1])
        .replace(
          finish,
          '  verifyPreparedHistoricalFixture(root, [...names].map((name) => [name, name === "supabase/config.toml" ? localTestConfig() : readHistoricalRecoveryFixtureSource(checkout, name, 193)]), "putduk-backend-http-source-");\n' +
            finish,
        );
    const imported =
      'import { readHistoricalRecoveryFixtureSource, verifyPreparedHistoricalFixture, preloadHistorical193UnitFixtureSources } from "../../scripts/historical-recovery-unit-stage.mjs";\n';
    if (source.split(span).length !== 2 || source.split(before).length !== 2)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const staged =
      imported + source.replace(span, replacement).replace(before, after);
    if (
      digest(
        staged
          .slice(imported.length)
          .replace(replacement, span)
          .replace(after, before),
      ) !== digest(frozen)
    )
      throw Error("HISTORICAL_RECOVERY_STAGE_INVERSE_FAILED");
    return staged;
  }
  if (name === "backend-http-canonical-source.test.ts") {
    const start = frozen.indexOf("function fixture(local = false) {");
    const end = frozen.indexOf("\nfunction append(", start);
    if (start < 0 || end <= start)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const span = frozen.slice(start, end);
    const before = 'import { afterEach, describe, expect, it } from "vitest";';
    const after =
      'import { afterEach, beforeEach, describe, expect, it } from "vitest";';
    const replacement =
      'let preparedCanonicalRoot: string | undefined;\nbeforeEach(() => { preparedCanonicalRoot = constructHistoricalCanonicalFixture(); });\nfunction fixture(local = false) {\n  const root = preparedCanonicalRoot;\n  if (!root) throw new Error("HISTORICAL_RECOVERY_FIXTURE_REQUIRED");\n  preparedCanonicalRoot = undefined;\n  writeFileSync(join(root, "supabase/config.toml"), local ? localTestConfig() : frozenConfig());\n  if (local) writeFileSync(join(root, profilePath), readHistoricalRecoveryFixtureSource(checkout, profilePath, 193));\n  return root;\n}\n' +
      span
        .replace(
          "function fixture(local = false)",
          "function constructHistoricalCanonicalFixture(local = false)",
        )
        .replace(change[0], change[1]);
    const imported =
      'import { readHistoricalRecoveryFixtureSource } from "../../scripts/historical-recovery-unit-stage.mjs";\n';
    if (source.split(span).length !== 2 || source.split(before).length !== 2)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const staged =
      imported + source.replace(span, replacement).replace(before, after);
    if (
      digest(
        staged
          .slice(imported.length)
          .replace(replacement, span)
          .replace(after, before),
      ) !== digest(frozen)
    )
      throw Error("HISTORICAL_RECOVERY_STAGE_INVERSE_FAILED");
    return staged;
  }
  if (name === "backend-http-195-source.test.ts") {
    const start = frozen.indexOf(
      'function fixture(mode: "canonical" | "local" = "canonical") {',
    );
    const end = frozen.indexOf("\nfunction append(", start);
    if (start < 0 || end <= start)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const span = frozen.slice(start, end);
    const before = 'import { afterEach, describe, expect, it } from "vitest";';
    const after =
      'import { afterEach, beforeEach, describe, expect, it } from "vitest";';
    const replacement =
      'const historical195 = prepareHistorical195UnitFixtures(ROOT, scratch, PREFIX, roots);\nbeforeEach((context) => historical195.prepare(context.task.name));\nfunction fixture(mode: "canonical" | "local" = "canonical") {\n  return historical195.root(mode);\n}';
    const imported =
      'import { prepareHistorical195UnitFixtures } from "../../scripts/historical-recovery-unit-stage.mjs";\n';
    if (source.split(span).length !== 2 || source.split(before).length !== 2)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const loadingStart = frozen.indexOf(
        "const { assertBackendHttp195CanonicalCandidateSources: canonical,",
      ),
      loadingEnd = frozen.indexOf("\nconst PREFIX", loadingStart);
    if (loadingStart < 0 || loadingEnd <= loadingStart)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const loadingBefore = frozen.slice(loadingStart, loadingEnd),
      loadingAfter =
        'import { assertBackendHttp195CanonicalCandidateSources as canonical, assertBackendHttp195LocalCandidateSources as local } from "../../scripts/backend-http-195-source.mjs";';
    if (source.split(loadingBefore).length !== 2)
      throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
    const staged =
      imported +
      source
        .replace(span, replacement)
        .replace(before, after)
        .replace(loadingBefore, loadingAfter);
    if (
      digest(
        staged
          .slice(imported.length)
          .replace(replacement, span)
          .replace(after, before)
          .replace(loadingAfter, loadingBefore),
      ) !== digest(frozen)
    )
      throw Error("HISTORICAL_RECOVERY_STAGE_INVERSE_FAILED");
    return staged;
  }
  const imported =
    name === "brand-assets.test.ts"
      ? 'import { beforeAll } from "vitest";\nbeforeAll(() => primeBrandFixtureReads());\n'
      : name === "backend-successor-197-source.test.ts"
        ? ""
        : name === "backend-successor-197-browser-source.test.ts"
          ? 'import { readHistoricalBrowserTransportSource } from "../../scripts/historical-recovery-unit-stage.mjs";\n'
          : 'import { readHistoricalRecoveryFixtureSource } from "../../scripts/historical-recovery-unit-stage.mjs";\n';
  const staged = imported + source.replace(change[0], change[1]);
  if (
    digest(staged.slice(imported.length).replace(change[1], change[0])) !==
    digest(frozen)
  )
    throw Error("HISTORICAL_RECOVERY_STAGE_INVERSE_FAILED");
  return staged;
}
const nativeGuardInputs = {
  "backend-http-195-source.mjs": [
    "cfca3b3190b99148a80f3ab0c365f9e252dbb59d239206c6674ce2a1c2679068",
    "ac63d13e3275021deb4b3fff34eacafafccd89c853c2db5d52e387172afb0e4d",
  ],
  "backend-successor-197-source.mjs": [
    "415d8c434598aceb2721ea0ab92ade79625ee05129a45f4849bb729c16655b00",
    "faf70181349b75d5b450eb6319483a0f47cbeaa8bf0629296bb10d5bfca7364c",
  ],
};
// Virtual unit execution only. Disk guard bytes and all source pins stay intact.
export function stageHistoricalRecoveryGuardSource(source, name) {
  const pins = nativeGuardInputs[name];
  if (!pins) throw Error("HISTORICAL_RECOVERY_GUARD_REJECTED");
  const original = gitBytes(PRESERVED, "scripts/" + name).toString("utf8");
  if (digest(original) !== pins[0] || !pins.includes(digest(source)))
    throw Error("HISTORICAL_RECOVERY_GUARD_SOURCE_CHANGED");
  const match = original.match(/import \{([^}]+)\} from "node:fs";/);
  if (
    !match ||
    match[1].split("realpathSync").length !== 2 ||
    original.split(match[0]).length !== 2
  )
    throw Error("HISTORICAL_RECOVERY_GUARD_IMPORT_CHANGED");
  const before = match[0],
    after =
      before.replace("realpathSync", "realpathSync as nodeRealpathSync") +
      "\nconst realpathSync = nodeRealpathSync.native;";
  const staged = original.replace(before, after);
  if (
    staged.split(after).length !== 2 ||
    digest(staged.replace(after, before)) !== pins[0]
  )
    throw Error("HISTORICAL_RECOVERY_GUARD_INVERSE_FAILED");
  return staged;
}

export function historicalRecoveryUnitPlugin() {
  return {
    name: "putduk-historical-recovery-unit-only",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0].replaceAll("\\", "/");
      for (const name of Object.keys(nativeGuardInputs))
        if (path === resolve(repository, "scripts", name).replaceAll("\\", "/"))
          return {
            code: stageHistoricalRecoveryGuardSource(code, name),
            map: null,
          };
      for (const name of Object.keys(changes))
        if (
          path === resolve(repository, "tests/unit", name).replaceAll("\\", "/")
        )
          return {
            code: stageHistoricalRecoveryTestSource(code, name),
            map: null,
          };
    },
  };
}
