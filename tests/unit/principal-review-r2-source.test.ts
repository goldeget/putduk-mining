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
function fixture() {
  const map = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    migration_count: number;
    sources: { path: string; kind: string }[];
  };
  const root = mkdtempSync(join(base, "candidate-"));
  roots.push(root);
  for (const name of [
    manifestPath,
    ...previous,
    ...map.sources.map((row) => row.path),
  ]) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(name, target);
  }
  return { root, map };
}
describe("independently reviewed successor source boundary", () => {
  it("accepts exact reviewed bytes in a relocated candidate", () => {
    const { root, map } = fixture();
    expect(assertReviewedPrincipalCandidateSources(root)).toMatchObject({
      migrationSources: map.migration_count,
      runtimeSources: 29,
      projectId: "putduk-mining-ci-r2-20261009",
      apiPort: 63421,
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
