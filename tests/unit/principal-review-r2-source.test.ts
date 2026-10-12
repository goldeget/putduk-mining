import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  lstatSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { assertReviewedPrincipalCandidateSources } from "../../scripts/principal-review-r2-source.mjs";

const manifestPath = "tests/e2e/fixtures/principal-review-r2-ci-source.json";
const successorManifestPath =
  "tests/e2e/fixtures/principal-backend-engine-187-source.json";
const backendFirstManifestPath =
  "tests/e2e/fixtures/principal-backend-first-188-source.json";
const contentBackendManifestPath =
  "tests/e2e/fixtures/principal-backend-first-191-source.json";
const contentBackend = JSON.parse(
  readFileSync(contentBackendManifestPath, "utf8"),
) as {
  migration_count: number;
  reviewedRuntimeOverrides: {
    path: string;
    previousSha256: string;
    reviewedSha256: string;
  }[];
  sources: { path: string; kind: string; sha256: string }[];
};
const successor = JSON.parse(readFileSync(successorManifestPath, "utf8")) as {
  migration_count: number;
  sources: { path: string; kind: string; sha256: string }[];
};
const backendFirst = JSON.parse(
  readFileSync(backendFirstManifestPath, "utf8"),
) as {
  migration_count: number;
  sources: { path: string; kind: string; sha256: string }[];
};
const canonicalConfig = execFileSync(
  "git",
  ["--no-optional-locks", "show", "e220356be85a56e21e3469023b19b0c2fd4aebba:supabase/config.toml"],
  { cwd: resolve(".") },
);
// Only relocated historical fixtures use these independently frozen Worker bytes.
const historicalRunner = execFileSync(
  "git",
  [
    "--no-optional-locks",
    "show",
    "e220356be85a56e21e3469023b19b0c2fd4aebba:workers/runner.mjs",
  ],
  { cwd: resolve(".") },
);
const previous = [
  "principal-review-r2-source.json",
  "principal-integrated-source.json",
  "principal-local-recovery-source.json",
  "principal-local-recovery-source-v3.json",
  "principal-local-recovery-source-v4.json",
].map((name) => `tests/e2e/fixtures/${name}`);
// Owned relocated fixtures must stay outside TypeScript project source discovery.
const base = realpathSync(tmpdir());
const fixturePrefix = "putduk-review-r2-source-guards-";
const projectRoot = realpathSync(resolve("."));
const tempRelativeToProject = relative(projectRoot, base);
if (
  !tempRelativeToProject ||
  (!isAbsolute(tempRelativeToProject) &&
    tempRelativeToProject !== ".." &&
    !tempRelativeToProject.startsWith("../") &&
    !tempRelativeToProject.startsWith("..\\"))
)
  throw new Error("OWNED_FIXTURE_TEMP_INSIDE_PROJECT");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const actualRoot = realpathSync(root);
    const rel = relative(base, actualRoot);
    if (
      actualRoot !== resolve(root) ||
      lstatSync(root).isSymbolicLink() ||
      dirname(actualRoot) !== base ||
      !rel ||
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\") ||
      !/^putduk-review-r2-source-guards-[A-Za-z0-9]+$/.test(rel)
    )
      throw new Error("OWNED_FIXTURE_SCOPE_REJECTED");
    rmSync(actualRoot, { recursive: true, force: true });
  }
});
function firstAdditionalMigration() {
  const row = successor.sources[0];
  if (!row) throw new Error("REVIEW_R2_SUCCESSOR_TEST_FIXTURE_EMPTY");
  return row;
}
function backendFirstMigration() {
  const row = backendFirst.sources[0];
  if (!row) throw new Error("REVIEW_R2_BACKEND_FIRST_TEST_FIXTURE_EMPTY");
  return row;
}
function fixture() {
  const map = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    migration_count: number;
    sources: { path: string; kind: string; sha256: string }[];
  };
  const configSource = map.sources.find(
    (row) => row.path === "supabase/config.toml",
  )!;
  // Task-local ports are intentionally uncommitted. Negative fixtures use the
  // canonical Git bytes only after the immutable baseline hash verifies them.
  // The production guard still checks the actual file; it has no fallback.
  if (
    createHash("sha256").update(canonicalConfig).digest("hex") !==
    configSource.sha256
  )
    throw new Error("REVIEW_R2_CANONICAL_TEST_CONFIG_CHANGED");
  const runnerSource = map.sources.find(
    (row) => row.path === "workers/runner.mjs",
  );
  if (
    !runnerSource ||
    createHash("sha256").update(historicalRunner).digest("hex") !==
      runnerSource.sha256
  )
    throw new Error("REVIEW_R2_HISTORICAL_TEST_RUNNER_CHANGED");
  const sources = [
    ...map.sources,
    ...successor.sources,
    ...backendFirst.sources,
    ...contentBackend.sources,
  ];
  const root = realpathSync(mkdtempSync(join(base, fixturePrefix)));
  roots.push(root);
  for (const name of [
    manifestPath,
    successorManifestPath,
    backendFirstManifestPath,
    contentBackendManifestPath,
    ...previous,
    ...sources.map((row) => row.path),
  ]) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    if (name === "supabase/config.toml") writeFileSync(target, canonicalConfig);
    else if (name === "workers/runner.mjs")
      writeFileSync(target, historicalRunner);
    else copyFileSync(name, target);
  }
  return {
    root,
    map: { ...map, migration_count: contentBackend.migration_count, sources },
  };
}
describe("independently reviewed successor source boundary", () => {
  it("accepts exact reviewed bytes in a relocated candidate", () => {
    const { root, map } = fixture();
    expect(assertReviewedPrincipalCandidateSources(root)).toMatchObject({
      migrationSources: map.migration_count,
      runtimeSources: 29,
      projectId: "putduk-mining-ci-r2-20261009",
      apiPort: 63421,
      baselineManifestSha256:
        "338ea5ab29065a5962d40047e3c2e4fd76825fd8ce453ac299b9152d08396bc1",
      manifestSha256:
        "899bf27e5def9a2c48af491eaa1d2115134f0efbd40581f919c6155e5bb86adb",
      previousManifestSha256:
        "9c2ea55a0c06f07c3570f25ff80341e6ff67b37623ec497fde3062646882d616",
    });
    const reviewed = assertReviewedPrincipalCandidateSources(root);
    expect(reviewed.migrationVersions).toHaveLength(191);
    expect(reviewed.migrationVersions.at(-1)).toBe("20261011035000");
  }, 20_000);
  for (const kind of ["migration", "runtime"]) {
    it(`rejects a changed ${kind} while keeping the manifest intact`, () => {
      const { root, map } = fixture();
      writeFileSync(
        join(root, map.sources.find((row) => row.kind === kind)!.path),
        "unreviewed change",
      );
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
        "REVIEW_R2_SOURCE_CHANGED",
      );
    }, 20_000);
  }
  it("rejects caller-rewritten hashes rather than trusting a replacement map", () => {
    const { root, map } = fixture();
    writeFileSync(
      join(root, manifestPath),
      JSON.stringify({ ...map, sources: [] }),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
  for (const name of previous) {
    it(`keeps ${name.split("/").at(-1)} independently frozen`, () => {
      const { root } = fixture();
      writeFileSync(join(root, name), "changed historical source binding");
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
        "REVIEW_R2_PREVIOUS_FROZEN_MAP_CHANGED",
      );
    }, 20_000);
  }
  it("rejects a caller-rehashed successor instead of trusting new source bytes", () => {
    const { root } = fixture();
    const path = firstAdditionalMigration().path;
    const replacement = "unreviewed replacement with caller-supplied digest";
    writeFileSync(join(root, path), replacement);
    const rewritten = {
      ...successor,
      sources: successor.sources.map((row) =>
        row.path === path
          ? {
              ...row,
              sha256: createHash("sha256").update(replacement).digest("hex"),
            }
          : row,
      ),
    };
    writeFileSync(join(root, successorManifestPath), JSON.stringify(rewritten));
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_SUCCESSOR_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
  for (const row of successor.sources) {
    it(`rejects a mutated reviewed successor ${row.path.split("/").at(-1)}`, () => {
      const { root } = fixture();
      writeFileSync(join(root, row.path), "unreviewed successor SQL mutation");
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
        "REVIEW_R2_SOURCE_CHANGED",
      );
    }, 20_000);
    it(`rejects a missing reviewed successor ${row.path.split("/").at(-1)}`, () => {
      const { root } = fixture();
      rmSync(join(root, row.path));
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
        "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
      );
    }, 20_000);
  }
  it("rejects a missing baseline migration instead of treating 191 as a minimum", () => {
    const { root, map } = fixture();
    rmSync(
      join(root, map.sources.find((row) => row.kind === "migration")!.path),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
    );
  }, 20_000);
  it("rejects an unapproved replacement even when the migration count remains 191", () => {
    const { root } = fixture();
    const approved = join(root, firstAdditionalMigration().path);
    const bytes = readFileSync(approved);
    rmSync(approved);
    writeFileSync(
      join(
        root,
        "supabase/migrations/20990101000000_unapproved_replacement.sql",
      ),
      bytes,
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
    );
  }, 20_000);
  it("rejects a new unreviewed migration even when all mapped bytes match", () => {
    const { root } = fixture();
    writeFileSync(
      join(root, "supabase/migrations/20990101000000_unreviewed.sql"),
      "select 1;",
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
    );
  }, 20_000);
  it("rejects a mutated backend-first migration while all manifests stay intact", () => {
    const { root } = fixture();
    writeFileSync(join(root, backendFirstMigration().path), "select 1;");
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_SOURCE_CHANGED",
    );
  }, 20_000);
  it("rejects a missing backend-first migration", () => {
    const { root } = fixture();
    rmSync(join(root, backendFirstMigration().path));
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
    );
  }, 20_000);
  it("rejects a caller-rehashed backend-first manifest", () => {
    const { root } = fixture();
    const replacement = "unreviewed ETF replacement";
    writeFileSync(join(root, backendFirstMigration().path), replacement);
    writeFileSync(
      join(root, backendFirstManifestPath),
      JSON.stringify({
        ...backendFirst,
        sources: [
          {
            ...backendFirstMigration(),
            sha256: createHash("sha256").update(replacement).digest("hex"),
          },
        ],
      }),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_BACKEND_FIRST_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
  it("rejects replacing backend-first metadata with the previous generation", () => {
    const { root } = fixture();
    copyFileSync(
      join(root, successorManifestPath),
      join(root, backendFirstManifestPath),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_BACKEND_FIRST_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
  it("rejects a missing backend-first manifest", () => {
    const { root } = fixture();
    rmSync(join(root, backendFirstManifestPath));
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow();
  }, 20_000);
  it("rejects replacing the ETF migration at the same exact count of 191", () => {
    const { root } = fixture();
    const approved = join(root, backendFirstMigration().path);
    const bytes = readFileSync(approved);
    rmSync(approved);
    writeFileSync(
      join(root, "supabase/migrations/20990101000000_unapproved_etf.sql"),
      bytes,
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
    );
  }, 20_000);
  it("rejects task-local configuration bytes even with the reviewed 191 manifests", () => {
    const { root } = fixture();
    writeFileSync(
      join(root, "supabase/config.toml"),
      'project_id = "putduk-mining-backend-patch-20261011"\n[api]\nport = 65421\n',
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_SOURCE_CHANGED",
    );
  }, 20_000);
  for (const row of contentBackend.sources) {
    it(`rejects mutated 191 source ${row.path.split("/").at(-1)}`, () => {
      const { root } = fixture();
      writeFileSync(join(root, row.path), "unreviewed content SQL replacement");
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
        "REVIEW_R2_SOURCE_CHANGED",
      );
    }, 20_000);
    it(`rejects missing 191 source ${row.path.split("/").at(-1)}`, () => {
      const { root } = fixture();
      rmSync(join(root, row.path));
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
        "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
      );
    }, 20_000);
  }
  it("rejects caller-rehashed 191 SQL and manifest", () => {
    const { root } = fixture();
    const row = contentBackend.sources[0]!;
    const replacement = "unreviewed caller-rehashed FAQ policy";
    writeFileSync(join(root, row.path), replacement);
    writeFileSync(
      join(root, contentBackendManifestPath),
      JSON.stringify({
        ...contentBackend,
        sources: contentBackend.sources.map((source) =>
          source.path === row.path
            ? {
                ...source,
                sha256: createHash("sha256").update(replacement).digest("hex"),
              }
            : source,
        ),
      }),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_CONTENT_BACKEND_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
  it("rejects 191 metadata replaced by the frozen 188 predecessor", () => {
    const { root } = fixture();
    copyFileSync(
      join(root, backendFirstManifestPath),
      join(root, contentBackendManifestPath),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_CONTENT_BACKEND_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
  it("rejects an absent 191 manifest", () => {
    const { root } = fixture();
    rmSync(join(root, contentBackendManifestPath));
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow();
  }, 20_000);
  it("rejects same-count 191 source path replacement", () => {
    const { root } = fixture();
    const path = join(root, contentBackend.sources[2]!.path);
    const bytes = readFileSync(path);
    rmSync(path);
    writeFileSync(
      join(
        root,
        "supabase/migrations/20990101000000_counterfeit_faq_reader.sql",
      ),
      bytes,
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
    );
  }, 20_000);
  it("rejects altered 191 source head, project and predecessor metadata", () => {
    const { root } = fixture();
    writeFileSync(
      join(root, contentBackendManifestPath),
      JSON.stringify({
        ...contentBackend,
        reviewedSourceHead: "0".repeat(40),
        previousManifestSha256: "0".repeat(64),
        project_id: "other-project",
        migration_count: 192,
      }),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_CONTENT_BACKEND_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
  it("rejects permissive configuration even when project and port are unchanged", () => {
    const { root } = fixture();
    writeFileSync(
      join(root, "supabase/config.toml"),
      Buffer.concat([
        canonicalConfig,
        Buffer.from("\n# unreviewed permission change\n"),
      ]),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_SOURCE_CHANGED",
    );
  }, 20_000);
  for (const row of contentBackend.reviewedRuntimeOverrides) {
    it(`rejects a mutated reviewed runtime override ${row.path}`, () => {
      const { root } = fixture();
      writeFileSync(join(root, row.path), "unreviewed runtime override");
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
        "REVIEW_R2_SOURCE_CHANGED",
      );
    }, 20_000);
    it(`rejects a missing reviewed runtime override ${row.path}`, () => {
      const { root } = fixture();
      rmSync(join(root, row.path));
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow();
    }, 20_000);
    it(`rejects old bytes replacing the reviewed runtime override ${row.path}`, () => {
      const { root } = fixture();
      const old = execFileSync("git", [
        "--no-optional-locks",
        "show",
        `e220356be85a56e21e3469023b19b0c2fd4aebba:${row.path}`,
      ]);
      expect(createHash("sha256").update(old).digest("hex")).toBe(
        row.previousSha256,
      );
      writeFileSync(join(root, row.path), old);
      expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
        "REVIEW_R2_SOURCE_CHANGED",
      );
    }, 20_000);
  }
  it("rejects a caller-rehashed runtime override manifest", () => {
    const { root } = fixture();
    const row = contentBackend.reviewedRuntimeOverrides[0]!;
    const text = "caller-authorized runtime change";
    writeFileSync(join(root, row.path), text);
    writeFileSync(
      join(root, contentBackendManifestPath),
      JSON.stringify({
        ...contentBackend,
        reviewedRuntimeOverrides: contentBackend.reviewedRuntimeOverrides.map(
          (source) =>
            source.path === row.path
              ? {
                  ...source,
                  reviewedSha256: createHash("sha256")
                    .update(text)
                    .digest("hex"),
                }
              : source,
        ),
      }),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_CONTENT_BACKEND_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
  it("rejects an unreviewed third runtime replacement", () => {
    const { root } = fixture();
    writeFileSync(join(root, "workers/runner.mjs"), "unreviewed Worker source");
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_SOURCE_CHANGED",
    );
  }, 20_000);
  it("rejects a counterfeit original digest for a reviewed runtime override", () => {
    const { root } = fixture();
    writeFileSync(
      join(root, contentBackendManifestPath),
      JSON.stringify({
        ...contentBackend,
        reviewedRuntimeOverrides: contentBackend.reviewedRuntimeOverrides.map(
          (row) => ({ ...row, previousSha256: "0".repeat(64) }),
        ),
      }),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_CONTENT_BACKEND_FROZEN_MAP_CHANGED",
    );
  }, 20_000);
});
