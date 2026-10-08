import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  join,
  dirname,
  basename,
  resolve,
  relative,
  isAbsolute,
} from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertPrincipalCandidateSources } from "../../scripts/principal-e2e-source.mjs";

const legacyManifestPath =
  "tests/e2e/fixtures/principal-integrated-source.json";
const manifestPath = "tests/e2e/fixtures/principal-local-recovery-source.json";
const fixtureBase = resolve("test-results/principal-source-guards");
mkdirSync(fixtureBase, { recursive: true });
const source = readFileSync(manifestPath);
const manifest = JSON.parse(source.toString("utf8")) as {
  migration_count: number;
  sources: { path: string; kind: string }[];
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const owned = relative(fixtureBase, resolve(root));
    if (
      !owned ||
      isAbsolute(owned) ||
      owned === ".." ||
      owned.startsWith("..\\") ||
      owned.startsWith("../")
    )
      throw new Error("TEST_FIXTURE_CLEANUP_SCOPE_REJECTED");
    rmSync(root, { recursive: true, force: true });
  }
});
function copyCandidate() {
  const root = mkdtempSync(join(fixtureBase, "source-"));
  roots.push(root);
  for (const path of [
    manifestPath,
    legacyManifestPath,
    ...manifest.sources.map((row) => row.path),
  ]) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path));
  }
  return root;
}
describe("portable principal candidate guard", () => {
  it("verifies all runtime and migration bytes after moving to another checkout", () => {
    expect(assertPrincipalCandidateSources(copyCandidate())).toMatchObject({
      runtimeSources: 15,
      migrationSources: manifest.migration_count,
    });
  });
  for (const kind of ["runtime", "migration"]) {
    it(`rejects a changed ${kind} original even if the manifest is unchanged`, () => {
      const root = copyCandidate();
      const row = manifest.sources.find((row) => row.kind === kind)!;
      writeFileSync(join(root, row.path), "changed original");
      expect(() => assertPrincipalCandidateSources(root)).toThrow(
        "PRINCIPAL_E2E_SOURCE_CHANGED",
      );
    });
  }
  it("rejects altered principal presentation CSS with unchanged monetary sources", () => {
    const root = copyCandidate();
    const css = "components/product/principal-recovery.module.css";
    writeFileSync(join(root, css), "changed presentation original");
    expect(() => assertPrincipalCandidateSources(root)).toThrow(
      "PRINCIPAL_E2E_SOURCE_CHANGED",
    );
  });
  it("rejects a caller-rewritten manifest rather than accepting its new hashes", () => {
    const root = copyCandidate();
    writeFileSync(
      join(root, manifestPath),
      JSON.stringify({ ...manifest, sources: [] }),
    );
    expect(() => assertPrincipalCandidateSources(root)).toThrow(
      "PRINCIPAL_E2E_FROZEN_MAP_CHANGED",
    );
  });
  it("preserves the historical frozen manifest as independent evidence", () => {
    const root = copyCandidate();
    writeFileSync(
      join(root, legacyManifestPath),
      "changed historical manifest",
    );
    expect(() => assertPrincipalCandidateSources(root)).toThrow(
      "PRINCIPAL_E2E_LEGACY_MAP_CHANGED",
    );
  });
  it("rejects an additional migration omitted from the frozen source inventory", () => {
    const root = copyCandidate();
    writeFileSync(
      join(root, "supabase/migrations/20990101000000_unreviewed.sql"),
      "select 1;",
    );
    expect(() => assertPrincipalCandidateSources(root)).toThrow(
      "PRINCIPAL_E2E_MIGRATION_INVENTORY_CHANGED",
    );
  });
  it("rejects byte-identical source outside the checkout through a symlink", () => {
    const root = copyCandidate();
    const row = manifest.sources.find((row) => row.kind === "runtime")!;
    const external = mkdtempSync(join(fixtureBase, "external-"));
    roots.push(external);
    const file = join(external, "original");
    writeFileSync(file, readFileSync(row.path));
    rmSync(join(root, row.path));
    if (process.platform === "win32") {
      const parent = dirname(join(root, row.path));
      rmdirSync(parent);
      const outsideDirectory = join(external, "linked-directory");
      mkdirSync(outsideDirectory);
      writeFileSync(
        join(outsideDirectory, basename(row.path)),
        readFileSync(row.path),
      );
      symlinkSync(outsideDirectory, parent, "junction");
    } else {
      symlinkSync(file, join(root, row.path));
    }
    expect(() => assertPrincipalCandidateSources(root)).toThrow(
      "PRINCIPAL_E2E_SOURCE_SCOPE_REJECTED",
    );
  });
});
