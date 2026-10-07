import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { assertPrincipalCandidateSources } from "../../scripts/principal-e2e-source.mjs";

const manifestPath = "tests/e2e/fixtures/principal-integrated-source.json";
const source = readFileSync(manifestPath);
const manifest = JSON.parse(source.toString("utf8")) as {
  sources: { path: string; kind: string }[];
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function copyCandidate() {
  const root = mkdtempSync(join(tmpdir(), "putduk-mining-principal-source-"));
  roots.push(root);
  for (const path of [
    manifestPath,
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
      runtimeSources: 14,
      migrationSources: 32,
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
  it("rejects byte-identical source outside the checkout through a symlink", () => {
    const root = copyCandidate();
    const row = manifest.sources.find((row) => row.kind === "runtime")!;
    const external = mkdtempSync(
      join(tmpdir(), "putduk-mining-principal-external-"),
    );
    roots.push(external);
    const file = join(external, "original");
    writeFileSync(file, readFileSync(row.path));
    rmSync(join(root, row.path));
    symlinkSync(file, join(root, row.path));
    expect(() => assertPrincipalCandidateSources(root)).toThrow(
      "PRINCIPAL_E2E_SOURCE_SCOPE_REJECTED",
    );
  });
});
