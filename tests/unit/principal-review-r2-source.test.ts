import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertReviewedPrincipalCandidateSources } from "../../scripts/principal-review-r2-source.mjs";

const manifestPath = "tests/e2e/fixtures/principal-review-r2-ci-source.json";
const successorManifestPath =
  "tests/e2e/fixtures/principal-backend-engine-187-source.json";
const successor = JSON.parse(readFileSync(successorManifestPath, "utf8")) as {
  migration_count: number;
  sources: { path: string; kind: string; sha256: string }[];
};
const canonicalConfig = execFileSync(
  "git",
  ["--no-optional-locks", "show", "HEAD:supabase/config.toml"],
  { cwd: resolve(".") },
);
const previous = [
  "principal-review-r2-source.json",
  "principal-integrated-source.json",
  "principal-local-recovery-source.json",
  "principal-local-recovery-source-v3.json",
  "principal-local-recovery-source-v4.json",
].map((name) => `tests/e2e/fixtures/${name}`);
const base = resolve("test-results/review-r2-source-guards");
mkdirSync(base, { recursive: true });
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const rel = relative(base, root);
    if (
      !rel ||
      isAbsolute(rel) ||
      rel === ".." ||
      rel.startsWith("../") ||
      rel.startsWith("..\\")
    )
      throw new Error("OWNED_FIXTURE_SCOPE_REJECTED");
    rmSync(root, { recursive: true, force: true });
  }
});
function firstAdditionalMigration() {
  const row = successor.sources[0];
  if (!row) throw new Error("REVIEW_R2_SUCCESSOR_TEST_FIXTURE_EMPTY");
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
  const sources = [...map.sources, ...successor.sources];
  const root = mkdtempSync(join(base, "candidate-"));
  roots.push(root);
  for (const name of [
    manifestPath,
    successorManifestPath,
    ...previous,
    ...sources.map((row) => row.path),
  ]) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    if (name === "supabase/config.toml") writeFileSync(target, canonicalConfig);
    else copyFileSync(name, target);
  }
  return {
    root,
    map: { ...map, migration_count: successor.migration_count, sources },
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
        "1dc13d2b2c71524d37bc1c6bdde4bba4d4f988b707b1959d4597430b621eb9f3",
    });
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
  it("rejects a missing baseline migration instead of treating 187 as a minimum", () => {
    const { root, map } = fixture();
    rmSync(
      join(root, map.sources.find((row) => row.kind === "migration")!.path),
    );
    expect(() => assertReviewedPrincipalCandidateSources(root)).toThrow(
      "REVIEW_R2_MIGRATION_INVENTORY_CHANGED",
    );
  }, 20_000);
  it("rejects an unapproved replacement even when the migration count remains 187", () => {
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
});
