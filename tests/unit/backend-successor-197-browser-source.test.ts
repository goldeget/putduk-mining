import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { canonical, local } = vi.hoisted(() => ({
  canonical: vi.fn(),
  local: vi.fn(),
}));
vi.mock("../../scripts/backend-successor-197-source.mjs", () => ({
  assertBackend197CanonicalSources: canonical,
  assertBackend197LocalSources: local,
}));
import {
  assertBackend197BrowserCanonicalSources as check,
  assertBackend197BrowserLocalSources as checkLocal,
} from "../../scripts/backend-successor-197-browser-source.mjs";
const scratch = realpathSync(tmpdir()),
  prefix = "putduk-browser197-unit-",
  roots: string[] = [];
const files = [
  "scripts/ci-authenticated-shards.mjs",
  "scripts/ci-authenticated-shards.d.mts",
  "tests/unit/ci-authenticated-execution-197.test.ts",
  "tests/e2e/authenticated/helpers/principal-canonical-193-fixture.ts",
  "tests/unit/backend-http-193-consumer.test.ts",
  "playwright.backend-browser-197.config.ts",
  "scripts/backend-successor-197-browser-source.d.mts",
  "vitest.config.ts",
  "scripts/backend-successor-197-unit-fixture.mjs",
  "scripts/backend-successor-197-unit-fixture.d.mts",
  "tests/unit/backend-successor-197-unit-fixture.test.ts",
  "tests/unit/backend-successor-197-browser-source.test.ts",
];
function fixture() {
  const root = realpathSync(mkdtempSync(resolve(scratch, prefix)));
  roots.push(root);
  for (const p of files) {
    mkdirSync(dirname(resolve(root, p)), { recursive: true });
    copyFileSync(resolve(p), resolve(root, p));
  }
  return root;
}
beforeEach(() => {
  vi.resetAllMocks();
  canonical.mockReturnValue({ scope: "CANONICAL_CI", migrationSources: 197 });
  local.mockReturnValue({ scope: "LOCAL_QA", migrationSources: 197 });
});
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(root) !== scratch || !basename(root).startsWith(prefix))
      throw Error("UNIT_ROOT_SCOPE");
    rmSync(root, { recursive: true, force: true });
  }
});
describe("197 browser transport supplements the unchanged 514 source boundary", () => {
  it("requires the canonical guard before accepting pinned transport", () => {
    const root = fixture();
    expect(check(root)).toMatchObject({
      scope: "CANONICAL_CI",
      migrationSources: 197,
      browserConsumerSources: 12,
    });
    expect(canonical).toHaveBeenCalledWith(root);
    expect(local).not.toHaveBeenCalled();
  });
  it("keeps local validation a separate export", () => {
    const root = fixture();
    expect(checkLocal(root).scope).toBe("LOCAL_QA");
    expect(local).toHaveBeenCalledWith(root);
    expect(canonical).not.toHaveBeenCalled();
  });
  it("propagates canonical failure without falling back to local", () => {
    canonical.mockImplementation(() => {
      throw Error("BACKEND197_SOURCE_CHANGED");
    });
    expect(() => check(fixture())).toThrow("BACKEND197_SOURCE_CHANGED");
    expect(local).not.toHaveBeenCalled();
  });
  it.each(files)("rejects changed transport %s", (p) => {
    const root = fixture();
    writeFileSync(resolve(root, p), "changed");
    expect(() => check(root)).toThrow("BROWSER_SOURCE_CHANGED");
  });
  it("rejects a missing consumer", () => {
    const root = fixture();
    rmSync(resolve(root, files[0]!));
    expect(() => check(root)).toThrow("BROWSER_SOURCE_MISSING");
  });
  it("rejects an escaping consumer link", () => {
    const root = fixture(),
      outside = fixture();
    rmSync(resolve(root, "scripts"), { recursive: true });
    symlinkSync(
      resolve(outside, "scripts"),
      resolve(root, "scripts"),
      "junction",
    );
    expect(() => check(root)).toThrow("BROWSER_PATH_REJECTED");
  });
  it("rejects caller-selected pins or scope", () => {
    expect(() => Reflect.apply(check, null, [fixture(), {}])).toThrow(
      "CALLER_OPTIONS_REJECTED",
    );
    expect(canonical).not.toHaveBeenCalled();
  });
});
