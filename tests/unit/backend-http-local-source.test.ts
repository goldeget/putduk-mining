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
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Source = { kind: string; path: string; sha256: string };
type LocalBoundary = {
  scope: string;
  projectId: string;
  apiPort: number;
  dbPort: number;
  baselineRuntimeSources: number;
  runtimeSources: number;
  migrationSources: number;
  migrationVersions: string[];
};
// Node 24's synchronous ESM loading avoids a fabricated TypeScript declaration.
const { assertBackendHttpLocalCandidateSources } = createRequire(
  import.meta.url,
)("../../scripts/backend-http-local-source.mjs") as {
  assertBackendHttpLocalCandidateSources: (root?: string) => LocalBoundary;
};
const manifestPath = "tests/e2e/fixtures/backend-http-local-193-source.json";
const profilePath =
  "tests/e2e/fixtures/backend-http-local-execution-profile.json";
const baselinePath = "tests/e2e/fixtures/principal-review-r2-ci-source.json";
const layerPaths = [
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
const checkout = resolve(".");
const ownedTempParent = realpathSync(tmpdir());
const roots: string[] = [];
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const canonicalConfigHash =
  "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac";
const localConfigHash =
  "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7";
let canonicalBytes: Buffer | undefined;

// Test-only source evidence. The runtime guard never queries Git or derives pins.
function frozenConfig() {
  if (!canonicalBytes) {
    const bytes = execFileSync(
      "git",
      [
        "--no-optional-locks",
        "show",
        "e220356be85a56e21e3469023b19b0c2fd4aebba:supabase/config.toml",
      ],
      { cwd: checkout, maxBuffer: 1024 * 1024 },
    );
    if (digest(bytes) !== canonicalConfigHash)
      throw new Error("LOCAL_FIXTURE_FROZEN_CONFIG_CHANGED");
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

afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = realpathSync(root);
    const rel = relative(ownedTempParent, target);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel.includes("\\") ||
      rel.includes("/") ||
      !rel.startsWith("putduk-backend-http-source-")
    )
      throw new Error("BACKEND_HTTP_SOURCE_FIXTURE_DELETE_SCOPE_REJECTED");
    rmSync(target, { recursive: true, force: true });
  }
});

function fixture() {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
    sources: Source[];
  };
  const layers = layerPaths.map(
    (path) => JSON.parse(readFileSync(path, "utf8")) as { sources: Source[] },
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    sources: Source[];
    additionalRuntimeSources: Source[];
    reviewedRuntimeOverrides: { path: string; reviewedSha256: string }[];
  };
  const allSources = [
    ...baseline.sources,
    ...layers.flatMap((layer) => layer.sources),
    ...manifest.sources,
    ...manifest.additionalRuntimeSources,
  ];
  const root = mkdtempSync(
    join(ownedTempParent, "putduk-backend-http-source-"),
  );
  roots.push(root);
  const names = new Set([
    baselinePath,
    ...layerPaths,
    ...predecessors,
    manifestPath,
    profilePath,
    ...allSources.map((row) => row.path),
  ]);
  for (const name of names) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    if (name === "supabase/config.toml") {
      writeFileSync(target, localTestConfig());
    } else {
      writeFileSync(target, readPredecessor193TestSource(checkout, name));
    }
  }
  return { root, baseline, manifest, allSources };
}
function changed(root: string, name: string) {
  const target = join(root, name);
  writeFileSync(
    target,
    `${readFileSync(target, "utf8")}\n# unreviewed change\n`,
  );
}
function changedJson(
  root: string,
  name: string,
  change: (map: Record<string, unknown>) => void,
) {
  const target = join(root, name);
  const value = JSON.parse(readFileSync(target, "utf8")) as Record<
    string,
    unknown
  >;
  change(value);
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

describe("separately pinned backend HTTP LOCAL_QA source boundary", () => {
  it("fails closed until all coordinator review pins exist", () => {
    const { root } = fixture();
    const sourceText = readFileSync(
      "scripts/backend-http-local-source.mjs",
      "utf8",
    );
    if (
      /const REVIEWED_[A-Z_]+ = "";/.test(sourceText) ||
      /const (SOURCE_MANIFEST|EXECUTION_PROFILE)_SHA256 = "";/.test(sourceText)
    ) {
      expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
        "BACKEND_HTTP_LOCAL_REVIEW_NOT_PINNED",
      );
    } else {
      expect(assertBackendHttpLocalCandidateSources(root).scope).toBe(
        "LOCAL_QA",
      );
    }
  });
  it("accepts exact 193 SQL, original 29 runtime and one reviewed wallet addition", () => {
    const { root } = fixture();
    const result = assertBackendHttpLocalCandidateSources(root);
    expect(result).toMatchObject({
      scope: "LOCAL_QA",
      projectId: "putduk-mining-backend-patch-20261011",
      apiPort: 65421,
      dbPort: 65422,
      migrationSources: 193,
      baselineRuntimeSources: 29,
      runtimeSources: 30,
    });
    expect(result.migrationVersions).toHaveLength(193);
    expect(new Set(result.migrationVersions).size).toBe(193);
  });
  for (const name of [
    baselinePath,
    ...layerPaths,
    ...predecessors,
    manifestPath,
    profilePath,
  ]) {
    it(`rejects modified frozen evidence ${name}`, () => {
      const { root } = fixture();
      changed(root, name);
      expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
        "BACKEND_HTTP_LOCAL_FROZEN_MAP_CHANGED",
      );
    });
  }
  for (const name of [
    "domain/events/participation.ts",
    "lib/events/participation-handler.server.ts",
    "workers/runner.mjs",
    "app/api/v1/wallet/summary/route.ts",
    "supabase/config.toml",
    "supabase/migrations/20261011110300_backend_referral_nonmoney_bridge.sql",
  ]) {
    it(`rejects unreviewed bytes ${name}`, () => {
      const { root } = fixture();
      changed(root, name);
      expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
        "BACKEND_HTTP_LOCAL_SOURCE_CHANGED",
      );
    });
  }
  it("rejects unreviewed acknowledgement migration bytes", () => {
    const { root, manifest } = fixture();
    changed(root, manifest.sources[1]!.path);
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_SOURCE_CHANGED",
    );
  });
  it("rejects same-count migration filename substitution", () => {
    const { root, manifest } = fixture();
    const original = join(root, manifest.sources[1]!.path);
    renameSync(
      original,
      join(dirname(original), "20261011999999_unreviewed_same_count.sql"),
    );
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_MIGRATION_INVENTORY_CHANGED",
    );
  });
  it("rejects an unapproved 194th SQL", () => {
    const { root } = fixture();
    writeFileSync(
      join(root, "supabase/migrations/20261011999999_unreviewed_extra.sql"),
      "select 1;\n",
    );
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_MIGRATION_INVENTORY_CHANGED",
    );
  });
  it("rejects a missing reviewed migration", () => {
    const { root, manifest } = fixture();
    rmSync(join(root, manifest.sources[1]!.path));
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_MIGRATION_INVENTORY_CHANGED",
    );
  });
  it("rejects caller-rehash of SQL in successor JSON", () => {
    const { root, manifest } = fixture();
    const name = manifest.sources[1]!.path;
    changed(root, name);
    changedJson(root, manifestPath, (map) => {
      const rows = map.sources as Source[];
      rows.find((row) => row.path === name)!.sha256 = digest(
        readFileSync(join(root, name)),
      );
    });
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_FROZEN_MAP_CHANGED",
    );
  });
  it("rejects caller-rehash of runner override", () => {
    const { root } = fixture();
    changed(root, "workers/runner.mjs");
    changedJson(root, manifestPath, (map) => {
      const rows = map.reviewedRuntimeOverrides as { reviewedSha256: string }[];
      rows[0]!.reviewedSha256 = digest(
        readFileSync(join(root, "workers/runner.mjs")),
      );
    });
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_FROZEN_MAP_CHANGED",
    );
  });
  it("rejects caller-rehash of task configuration profile", () => {
    const { root } = fixture();
    changed(root, "supabase/config.toml");
    changedJson(root, profilePath, (map) => {
      map.reviewedSha256 = digest(
        readFileSync(join(root, "supabase/config.toml")),
      );
    });
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_FROZEN_MAP_CHANGED",
    );
  });
  for (const [key, value] of [
    ["project_id", "osrmyjgmpdspdcwqjwuv"],
    ["project_id", "putduk-mining-unreviewed-other"],
    ["api_port", 63421],
    ["db_port", 63422],
    ["scope", "PRODUCTION"],
  ] as const) {
    it(`rejects execution-profile substitution ${key}=${value}`, () => {
      const { root } = fixture();
      changedJson(root, profilePath, (map) => {
        map[key] = value;
      });
      expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
        "BACKEND_HTTP_LOCAL_FROZEN_MAP_CHANGED",
      );
    });
  }
  it("rejects canonical configuration as actual task configuration", () => {
    const { root, baseline } = fixture();
    const row = baseline.sources.find(
      (source) => source.path === "supabase/config.toml",
    )!;
    expect(row.sha256).not.toBe(digest(readFileSync(join(root, row.path))));
    writeFileSync(join(root, row.path), frozenConfig());
    expect(digest(readFileSync(join(root, row.path)))).toBe(row.sha256);
    expect(() => assertBackendHttpLocalCandidateSources(root)).toThrow(
      "BACKEND_HTTP_LOCAL_SOURCE_CHANGED",
    );
  });
  it("rejects changed configuration even with environment skip and caller hash arguments", () => {
    const { root } = fixture();
    changed(root, "supabase/config.toml");
    const previous = process.env.PUTDUK_SKIP_SOURCE_GUARD;
    process.env.PUTDUK_SKIP_SOURCE_GUARD = "1";
    try {
      const call = assertBackendHttpLocalCandidateSources as unknown as (
        ...args: unknown[]
      ) => unknown;
      expect(() =>
        call(root, {
          configSha256: digest(
            readFileSync(join(root, "supabase/config.toml")),
          ),
        }),
      ).toThrow("BACKEND_HTTP_LOCAL_SOURCE_CHANGED");
    } finally {
      if (previous === undefined) delete process.env.PUTDUK_SKIP_SOURCE_GUARD;
      else process.env.PUTDUK_SKIP_SOURCE_GUARD = previous;
    }
  });
});
