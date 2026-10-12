import { readPredecessor193TestSource } from "../helpers/backend-predecessor-195.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Source = { kind: string; path: string; sha256: string };
type Boundary = {
  scope: string;
  projectId: string;
  apiPort: number;
  dbPort: number;
  migrationSources: number;
  runtimeSources: number;
  baselineRuntimeSources: number;
  migrationVersions: string[];
  manifestSha256: string;
  executionProfileSha256: string | null;
};
type Guard = (root?: string) => Boundary;
const require = createRequire(import.meta.url);
const { assertBackendHttpCanonicalSources } = require(
  "../../scripts/backend-http-canonical-source.mjs",
) as { assertBackendHttpCanonicalSources: Guard };
const { assertBackendHttpLocalCandidateSources } = require(
  "../../scripts/backend-http-local-source.mjs",
) as { assertBackendHttpLocalCandidateSources: Guard };
const checkout = resolve(".");
const frozenHead = "e220356be85a56e21e3469023b19b0c2fd4aebba";
const canonicalConfigHash =
  "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac";
const localConfigHash =
  "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7";
const manifestHash =
  "8957473c3170a41ca19835fc39a73542921dcd71abad4a58261ff7a760bda922";
const baselinePath = "tests/e2e/fixtures/principal-review-r2-ci-source.json";
const manifestPath = "tests/e2e/fixtures/backend-http-local-193-source.json";
const profilePath = "tests/e2e/fixtures/backend-http-local-execution-profile.json";
const layers = [
  "tests/e2e/fixtures/principal-backend-engine-187-source.json",
  "tests/e2e/fixtures/principal-backend-first-188-source.json",
  "tests/e2e/fixtures/principal-backend-first-191-source.json",
];
const predecessors = [
  "principal-review-r2-source.json",
  "principal-integrated-source.json",
  "principal-local-recovery-source.json",
  "principal-local-recovery-source-v3.json",
  "principal-local-recovery-source-v4.json",
].map((name) => `tests/e2e/fixtures/${name}`);
const tempParent = realpathSync(tmpdir());
const tempPrefix = "putduk-backend-canonical-source-";
const ownedRoots: string[] = [];
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

afterEach(() => {
  for (const root of ownedRoots.splice(0)) {
    const target = realpathSync(root);
    const rel = relative(tempParent, target);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel.includes("/") ||
      rel.includes("\\") ||
      !rel.startsWith(tempPrefix)
    ) throw new Error("CANONICAL_FIXTURE_DELETE_SCOPE_REJECTED");
    rmSync(target, { recursive: true, force: true });
  }
});

// Git bytes are test-only evidence. Runtime guards never query Git or derive pins.
let canonicalBytes: Buffer | undefined;
function frozenConfig() {
  if (!canonicalBytes) {
    const bytes = execFileSync(
      "git",
      ["--no-optional-locks", "show", `${frozenHead}:supabase/config.toml`],
      { cwd: checkout, maxBuffer: 1024 * 1024 },
    );
    if (digest(bytes) !== canonicalConfigHash)
      throw new Error("CANONICAL_FIXTURE_FROZEN_CONFIG_CHANGED");
    canonicalBytes = bytes;
  }
  return canonicalBytes;
}
function localTestConfig() {
  let text = frozenConfig().toString("utf8");
  const literals = [
    [
      'project_id = "putduk-mining-ci-r2-20261009"',
      'project_id = "putduk-mining-backend-patch-20261011"',
    ],
    ["port = 63421", "port = 65421"],
    ["port = 63422", "port = 65422"],
    ["shadow_port = 63420", "shadow_port = 65420"],
    ["port = 63429", "port = 65429"],
    ["port = 63423", "port = 65423"],
    ["port = 63424", "port = 65424"],
    ["port = 63427", "port = 65427"],
  ] as const;
  for (const [before, after] of literals) {
    if (text.split(before).length !== 2)
      throw new Error("LOCAL_FIXTURE_LITERAL_DIFF_NOT_EXACT");
    text = text.replace(before, after);
  }
  const bytes = Buffer.from(text, "utf8");
  if (digest(bytes) !== localConfigHash)
    throw new Error("LOCAL_FIXTURE_DERIVED_CONFIG_CHANGED");
  return bytes;
}
function newOwnedRoot() {
  const root = mkdtempSync(join(tempParent, tempPrefix));
  ownedRoots.push(root);
  return root;
}
function fixture(local = false) {
  const sourcePaths = [baselinePath, ...layers, manifestPath].flatMap((path) => {
    const map = JSON.parse(readFileSync(join(checkout, path), "utf8")) as {
      sources: Source[];
      additionalRuntimeSources?: Source[];
    };
    return [...map.sources, ...(map.additionalRuntimeSources ?? [])].map(
      (row) => row.path,
    );
  });
  const root = newOwnedRoot();
  const names = new Set([
    baselinePath,
    ...layers,
    ...predecessors,
    manifestPath,
    ...(local ? [profilePath] : []),
    ...sourcePaths,
  ]);
  for (const name of names) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    if (name === "supabase/config.toml") {
      writeFileSync(target, local ? localTestConfig() : frozenConfig());
    } else {
      writeFileSync(target, readPredecessor193TestSource(checkout, name));
    }
  }
  return root;
}
function append(root: string, name: string) {
  const path = join(root, name);
  writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("\n# altered\n")]));
}
function changeMap(root: string, mutate: (map: Record<string, unknown>) => void) {
  const path = join(root, manifestPath);
  const map = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  mutate(map);
  writeFileSync(path, `${JSON.stringify(map, null, 2)}\n`);
}

describe("closed canonical CI 193-source boundary", () => {
  it("accepts exact canonical config and 193/30 reviewed source inventory without QA profile", () => {
    const result = assertBackendHttpCanonicalSources(fixture());
    expect(result).toMatchObject({
      scope: "CANONICAL_CI",
      projectId: "putduk-mining-ci-r2-20261009",
      apiPort: 63421,
      dbPort: 63422,
      migrationSources: 193,
      baselineRuntimeSources: 29,
      runtimeSources: 30,
      manifestSha256: manifestHash,
      executionProfileSha256: null,
    });
    expect(result.migrationVersions).toHaveLength(193);
    expect(new Set(result.migrationVersions).size).toBe(193);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it("derives only test-local config from pinned frozen bytes, preserving LOCAL_QA acceptance", () => {
    expect(digest(frozenConfig())).toBe(canonicalConfigHash);
    expect(digest(localTestConfig())).toBe(localConfigHash);
    const result = assertBackendHttpLocalCandidateSources(fixture(true));
    expect(result).toMatchObject({
      scope: "LOCAL_QA", projectId: "putduk-mining-backend-patch-20261011",
      apiPort: 65421, dbPort: 65422, migrationSources: 193, runtimeSources: 30,
    });
  });
  it("rejects independently pinned LOCAL_QA config on the canonical entry", () => {
    expect(() => assertBackendHttpCanonicalSources(fixture(true))).toThrow(
      "BACKEND_HTTP_CANONICAL_SOURCE_CHANGED",
    );
  });
  it("rejects canonical config on the LOCAL_QA entry even with the valid QA profile", () => {
    const root = fixture(true);
    writeFileSync(join(root, "supabase/config.toml"), frozenConfig());
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_SOURCE_CHANGED",
    );
  });
  for (const name of [baselinePath, ...layers, ...predecessors, manifestPath]) {
    it(`rejects changed independently frozen evidence ${name}`, () => {
      const root = fixture();
      append(root, name);
      expect(() => assertBackendHttpCanonicalSources(root)).toThrow(
        "BACKEND_HTTP_CANONICAL_FROZEN_MAP_CHANGED",
      );
    });
  }
  for (const name of [
    "supabase/config.toml",
    "workers/runner.mjs",
    "domain/events/participation.ts",
    "lib/events/participation-handler.server.ts",
    "app/api/v1/wallet/summary/route.ts",
    "supabase/migrations/20261011110300_backend_referral_nonmoney_bridge.sql",
    "supabase/migrations/20261011112058_nonmoney_award_outbox_ack.sql",
  ]) {
    it(`rejects changed reviewed runtime or migration bytes ${name}`, () => {
      const root = fixture();
      append(root, name);
      expect(() => assertBackendHttpCanonicalSources(root)).toThrow(
        "BACKEND_HTTP_CANONICAL_SOURCE_CHANGED",
      );
    });
  }
  it("rejects exact-count SQL path substitution", () => {
    const root = fixture();
    renameSync(
      join(root, "supabase/migrations/20261011112058_nonmoney_award_outbox_ack.sql"),
      join(root, "supabase/migrations/20261011999999_unreviewed_same_count.sql"),
    );
    expect(() => assertBackendHttpCanonicalSources(root)).toThrow(
      "BACKEND_HTTP_CANONICAL_MIGRATION_INVENTORY_CHANGED",
    );
  });
  it("rejects an extra SQL and never accepts a minimum-only count", () => {
    const root = fixture();
    writeFileSync(join(root, "supabase/migrations/20261011999999_extra.sql"), "select 1;\n");
    expect(() => assertBackendHttpCanonicalSources(root)).toThrow(
      "BACKEND_HTTP_CANONICAL_MIGRATION_INVENTORY_CHANGED",
    );
  });
  it("rejects a missing approved SQL", () => {
    const root = fixture();
    rmSync(join(root, "supabase/migrations/20261011112058_nonmoney_award_outbox_ack.sql"));
    expect(() => assertBackendHttpCanonicalSources(root)).toThrow(
      "BACKEND_HTTP_CANONICAL_MIGRATION_INVENTORY_CHANGED",
    );
  });
  it("rejects caller rehash of a changed runtime", () => {
    const root = fixture();
    append(root, "workers/runner.mjs");
    changeMap(root, (map) => {
      const rows = map.reviewedRuntimeOverrides as { reviewedSha256: string }[];
      rows[0]!.reviewedSha256 = digest(readFileSync(join(root, "workers/runner.mjs")));
    });
    expect(() => assertBackendHttpCanonicalSources(root)).toThrow(
      "BACKEND_HTTP_CANONICAL_FROZEN_MAP_CHANGED",
    );
  });
  it("rejects duplicate and scope-escape source rows even with caller rehash", () => {
    const root = fixture();
    changeMap(root, (map) => {
      const rows = map.sources as Source[];
      rows[1]!.path = "../outside.sql";
      rows.push({ ...rows[0]! });
    });
    expect(() => assertBackendHttpCanonicalSources(root)).toThrow(
      "BACKEND_HTTP_CANONICAL_FROZEN_MAP_CHANGED",
    );
  });
  it("rejects actual runtime junction/symlink escape before reading target bytes", () => {
    const root = fixture();
    const external = newOwnedRoot();
    renameSync(join(root, "workers"), join(external, "workers"));
    symlinkSync(join(external, "workers"), join(root, "workers"), process.platform === "win32" ? "junction" : "dir");
    expect(() => assertBackendHttpCanonicalSources(root)).toThrow(
      "BACKEND_HTTP_CANONICAL_SOURCE_SCOPE_REJECTED",
    );
  });
  it("does not accept environment flags, caller mode or caller config hash", () => {
    const root = fixture(true);
    const old = process.env.PUTDUK_SKIP_SOURCE_GUARD;
    process.env.PUTDUK_SKIP_SOURCE_GUARD = "1";
    try {
      const call = assertBackendHttpCanonicalSources as unknown as (...args: unknown[]) => unknown;
      expect(() => call(root, { scope: "LOCAL_QA", configSha256: localConfigHash })).toThrow(
        "BACKEND_HTTP_CANONICAL_SOURCE_CHANGED",
      );
    } finally {
      if (old === undefined) delete process.env.PUTDUK_SKIP_SOURCE_GUARD;
      else process.env.PUTDUK_SKIP_SOURCE_GUARD = old;
    }
  });
});
