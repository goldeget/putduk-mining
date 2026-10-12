import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFileSync,
  realpathSync,
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
  const current = readFileSync(owned(root, path));
  if (digest(current) === expected) {
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
export function stageHistoricalRecoveryTestSource(source, name) {
  const change = changes[name];
  if (!change) throw Error("HISTORICAL_RECOVERY_TEST_REJECTED");
  const original = gitBytes(PRESERVED, "tests/unit/" + name).toString("utf8");
  const frozen =
    name === "backend-successor-197-source.test.ts"
      ? stageBackend197UnitFixtureSource(original)
      : original;
  if (digest(source) !== digest(frozen) || source.split(change[0]).length !== 2)
    throw Error("HISTORICAL_RECOVERY_TEST_SOURCE_CHANGED");
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
  const imported =
    name === "backend-successor-197-source.test.ts"
      ? ""
      : 'import { readHistoricalRecoveryFixtureSource } from "../../scripts/historical-recovery-unit-stage.mjs";\n';
  const staged = imported + source.replace(change[0], change[1]);
  if (
    digest(staged.slice(imported.length).replace(change[1], change[0])) !==
    digest(frozen)
  )
    throw Error("HISTORICAL_RECOVERY_STAGE_INVERSE_FAILED");
  return staged;
}
export function historicalRecoveryUnitPlugin() {
  return {
    name: "putduk-historical-recovery-unit-only",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0].replaceAll("\\", "/");
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
