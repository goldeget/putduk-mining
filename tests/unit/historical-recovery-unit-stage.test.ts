import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as historicalStage from "../../scripts/historical-recovery-unit-stage.mjs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  readHistoricalRecoverySource,
  readHistoricalRecoveryFixtureSource,
  verifyHistoricalRecoveryBytes,
  stageHistoricalRecoveryTestSource,
  prepareBackend197UnitFixtures,
} from "../../scripts/historical-recovery-unit-stage.mjs";
import { stageBackend197UnitFixtureSource } from "../../scripts/backend-successor-197-unit-fixture.mjs";
import { tmpdir } from "node:os";
const root = resolve(".");
const preloadTrace = vi.hoisted(() => ({
  enabled: false,
  reads: [] as string[],
  git: [] as string[],
  writes: [] as string[],
  creates: [] as string[],
  tamperManifest: "",
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const pathModule = await import("node:path");
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      const path = pathModule.resolve(String(args[0]));
      if (preloadTrace.enabled) preloadTrace.reads.push(path);
      const bytes = actual.readFileSync(...args);
      if (path === preloadTrace.tamperManifest)
        return typeof bytes === "string"
          ? bytes + "\nchanged-after-preload"
          : Buffer.concat([bytes, Buffer.from("\nchanged-after-preload")]);
      return bytes;
    }) as typeof actual.readFileSync,
    statSync: ((...args: Parameters<typeof actual.statSync>) => {
      const stat = actual.statSync(...args);
      if (
        !stat ||
        pathModule.resolve(String(args[0])) !== preloadTrace.tamperManifest
      )
        return stat;
      return new Proxy(stat, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver);
          return key === "mtimeNs" && typeof value === "bigint"
            ? value + 1n
            : value;
        },
      });
    }) as typeof actual.statSync,
    mkdirSync: ((...args: Parameters<typeof actual.mkdirSync>) => {
      if (preloadTrace.enabled) preloadTrace.creates.push(String(args[0]));
      return Reflect.apply(actual.mkdirSync, actual, args);
    }) as typeof actual.mkdirSync,
    mkdtempSync: ((...args: Parameters<typeof actual.mkdtempSync>) => {
      if (preloadTrace.enabled) preloadTrace.creates.push(String(args[0]));
      return Reflect.apply(actual.mkdtempSync, actual, args);
    }) as typeof actual.mkdtempSync,
    writeFileSync: ((...args: Parameters<typeof actual.writeFileSync>) => {
      if (preloadTrace.enabled) preloadTrace.writes.push(String(args[0]));
      return Reflect.apply(actual.writeFileSync, actual, args);
    }) as typeof actual.writeFileSync,
  };
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: ((...args: Parameters<typeof actual.execFileSync>) => {
      if (preloadTrace.enabled)
        preloadTrace.git.push(JSON.stringify(args.slice(0, 2)));
      return actual.execFileSync(...args);
    }) as typeof actual.execFileSync,
  };
});
const preload193 = Reflect.get(
  historicalStage,
  "preloadHistorical193UnitFixtureSources",
);
// Real cold preload belongs to module evaluation, matching the target behavior.
// With the old helper no API is called; the tests fail at explicit assertions.
preloadTrace.enabled = true;
if (typeof preload193 === "function") preload193(root);
preloadTrace.enabled = false;
const coldPreloadReads = [...preloadTrace.reads];
const coldPreloadGit = [...preloadTrace.git];
const coldPreloadCreates = [...preloadTrace.creates];
const coldPreloadWrites = [...preloadTrace.writes];
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const preserved = (path: string) =>
  execFileSync("git", [
    "--no-optional-locks",
    "show",
    `630ca8ac2cfda90e39cdf6e04b0df906986cb275:${path}`,
  ]);
describe("historical recovery test-only staging", () => {
  it("preloads the exact 193 roster without creating a fixture", () => {
    expect(
      preload193,
      "193 immutable byte preload must exist before hook registration",
    ).toBeTypeOf("function");
    const expected = new Set<string>([
      "tests/e2e/fixtures/principal-review-r2-ci-source.json",
      "tests/e2e/fixtures/principal-backend-engine-187-source.json",
      "tests/e2e/fixtures/principal-backend-first-188-source.json",
      "tests/e2e/fixtures/principal-backend-first-191-source.json",
      "tests/e2e/fixtures/backend-http-local-193-source.json",
      "tests/e2e/fixtures/backend-http-local-execution-profile.json",
      "tests/e2e/fixtures/principal-review-r2-source.json",
      "tests/e2e/fixtures/principal-integrated-source.json",
      "tests/e2e/fixtures/principal-local-recovery-source.json",
      "tests/e2e/fixtures/principal-local-recovery-source-v3.json",
      "tests/e2e/fixtures/principal-local-recovery-source-v4.json",
    ]);
    for (const path of [...expected].slice(0, 5)) {
      const map = JSON.parse(readFileSync(path, "utf8"));
      for (const row of [
        ...map.sources,
        ...(path.endsWith("backend-http-local-193-source.json")
          ? map.additionalRuntimeSources
          : []),
      ])
        expected.add(row.path);
    }
    expect(expected.size).toBe(234);
    expected.delete("supabase/config.toml");
    expect([...new Set(coldPreloadReads)].sort()).toEqual(
      [...expected].map((path) => resolve(root, path)).sort(),
    );
    expect(coldPreloadGit.length).toBeGreaterThan(0);
    expect(coldPreloadCreates).toEqual([]);
    expect(coldPreloadWrites).toEqual([]);
  });
  it("serves preloaded immutable product bytes without another file or Git read", () => {
    expect(preload193).toBeTypeOf("function");
    preloadTrace.reads = [];
    preloadTrace.git = [];
    preloadTrace.enabled = true;
    let bytes: Buffer;
    try {
      bytes = readHistoricalRecoveryFixtureSource(root, "app/globals.css", 193);
    } finally {
      preloadTrace.enabled = false;
    }
    expect(bytes!.length).toBeGreaterThan(0);
    expect(preloadTrace.reads).toEqual([]);
    expect(preloadTrace.git).toEqual([]);
    const expected = digest(bytes!);
    bytes!.writeUInt8(bytes!.readUInt8(0) ^ 1, 0);
    preloadTrace.enabled = true;
    let reread: Buffer;
    try {
      reread = readHistoricalRecoveryFixtureSource(
        root,
        "app/globals.css",
        193,
      );
    } finally {
      preloadTrace.enabled = false;
    }
    expect(digest(reread!)).toBe(expected);
    expect(preloadTrace.reads).toEqual([]);
    expect(preloadTrace.git).toEqual([]);
  });
  it("still rejects manifest changes after preload without changing any source file", () => {
    expect(preload193).toBeTypeOf("function");
    preloadTrace.tamperManifest = resolve(
      root,
      "tests/e2e/fixtures/backend-http-local-193-source.json",
    );
    try {
      expect(() =>
        readHistoricalRecoveryFixtureSource(
          root,
          "tests/e2e/fixtures/backend-http-local-193-source.json",
          193,
        ),
      ).toThrow("MANIFEST_CHANGED");
    } finally {
      preloadTrace.tamperManifest = "";
    }
    expect(() =>
      readHistoricalRecoveryFixtureSource(
        root,
        "tests/e2e/fixtures/backend-http-local-193-source.json",
        193,
      ),
    ).not.toThrow();
  });
  it("preloads before the original 193 hook and preserves assertions and cleanup", () => {
    const original = preserved(
      "tests/unit/backend-http-local-source.test.ts",
    ).toString("utf8");
    const staged = stageHistoricalRecoveryTestSource(
      original,
      "backend-http-local-source.test.ts",
    );
    const preloadAt = staged.indexOf(
      "preloadHistorical193UnitFixtureSources(checkout);",
    );
    const configAt = staged.indexOf("localTestConfig();", preloadAt);
    const hookAt = staged.indexOf(
      "beforeEach(() => { preparedLocalFixture = constructHistoricalLocalFixture(); });",
    );
    expect(
      preloadAt,
      "193 cold bytes must be prepared at module evaluation",
    ).toBeGreaterThanOrEqual(0);
    expect(configAt).toBeGreaterThan(preloadAt);
    expect(hookAt).toBeGreaterThan(configAt);
    expect(staged.slice(staged.indexOf("describe("))).toBe(
      original.slice(original.indexOf("describe(")),
    );
    const cleanup = original.slice(
      original.indexOf("afterEach(() => {"),
      original.indexOf("\nfunction fixture()"),
    );
    expect(staged).toContain(cleanup);
    expect(
      staged.match(/(?:hookTimeout|testTimeout|\.skip\(|\.retry\()/g),
    ).toEqual(
      original.match(/(?:hookTimeout|testTimeout|\.skip\(|\.retry\()/g),
    );
  });
  it("rejects a fixture scratch/prefix outside the frozen test scope before writing", () => {
    expect(() =>
      prepareBackend197UnitFixtures(root, root, "putduk-backend197-unit-", []),
    ).toThrow("FIXTURE_SCOPE_REJECTED");
    expect(() =>
      prepareBackend197UnitFixtures(root, tmpdir(), "../outside", []),
    ).toThrow("FIXTURE_SCOPE_REJECTED");
  });
  it("loads exact historical globals while keeping current UI bytes separate", () => {
    const historical = readHistoricalRecoverySource(
      root,
      "app/globals.css",
      197,
    );
    expect(digest(historical)).toBe(
      "b043c74c8b2690923b25efb995d59b2e4cc16d7f3eeaad164c299951832f47ab",
    );
    expect(digest(readFileSync("app/globals.css"))).not.toBe(
      digest(historical),
    );
  });
  it("rejects a wrong blob, a recomputed caller digest and current modified UI bytes", () => {
    const wrong = Buffer.from("caller-provided replacement");
    expect(digest(wrong)).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      verifyHistoricalRecoveryBytes("app/globals.css", wrong, 197),
    ).toThrow("BLOB_CHANGED");
    expect(() =>
      verifyHistoricalRecoveryBytes(
        "app/globals.css",
        readFileSync("app/globals.css"),
        197,
      ),
    ).toThrow("BLOB_CHANGED");
    expect(() =>
      verifyHistoricalRecoveryBytes(
        "app/globals.css",
        preserved("lib/ai/usage.ts"),
        197,
      ),
    ).toThrow("BLOB_CHANGED");
  });
  it.each([
    "../outside",
    "C:/outside",
    "app\\globals.css",
    "/outside",
    "app/../outside",
  ])("rejects path escape %s", (path) => {
    expect(() => readHistoricalRecoverySource(root, path, 197)).toThrow(
      "PATH_REJECTED",
    );
  });
  it("rejects arbitrary roots and unmapped product paths", () => {
    expect(() =>
      readHistoricalRecoverySource(resolve(".."), "app/globals.css", 197),
    ).toThrow("ROOT_REJECTED");
    expect(() =>
      readHistoricalRecoverySource(root, "package.json", 191),
    ).toThrow("UNMAPPED_SOURCE");
  });
  it.each([
    "principal-review-r2-source.test.ts",
    "principal-e2e-source.test.ts",
    "backend-http-canonical-source.test.ts",
    "backend-http-local-source.test.ts",
    "backend-http-195-source.test.ts",
    "backend-successor-197-source.test.ts",
  ])("stages only exact original %s and rejects extra bytes", (name) => {
    const original = preserved("tests/unit/" + name).toString("utf8");
    const input =
      name === "backend-successor-197-source.test.ts"
        ? stageBackend197UnitFixtureSource(original)
        : original;
    expect(stageHistoricalRecoveryTestSource(input, name)).toContain(
      "historical-recovery-unit-stage.mjs",
    );
    expect(() =>
      stageHistoricalRecoveryTestSource(input + "\n// changed", name),
    ).toThrow("TEST_SOURCE_CHANGED");
  });
});

describe("principal-v4 current UI separation", () => {
  it.each([
    [
      "app/(product)/wallet/withdraw/page.tsx",
      "feadc26536a19f5173b9fad961fcb93002783fa62fc11c14af92c83251eb3215",
    ],
    [
      "components/product/principal-crypto-withdrawal-form.tsx",
      "b71e00a8c2f156c99804b0d68064c535dfc0ca82286bd6d8e208f9486785dab1",
    ],
    [
      "components/product/principal-withdrawal-form.tsx",
      "6be8818f2afb11fac9e751e4c4f244634c5061f831cda1f5f3994621ab5ef5df",
    ],
  ])(
    "copies only the exact original %s and rejects its current UI bytes",
    (path, expected) => {
      const original = readHistoricalRecoveryFixtureSource(root, path, 191);
      expect(digest(original)).toBe(expected);
      expect(original.equals(preserved(path))).toBe(true);
      expect(digest(readFileSync(path))).not.toBe(expected);
      expect(verifyHistoricalRecoveryBytes(path, original, 191)).toBe(true);
      expect(() =>
        verifyHistoricalRecoveryBytes(path, readFileSync(path), 191),
      ).toThrow("BLOB_CHANGED");
      expect(() =>
        verifyHistoricalRecoveryBytes(
          path,
          Buffer.from("caller rewritten source"),
          191,
        ),
      ).toThrow("BLOB_CHANGED");
    },
  );
  it("keeps all190 v4 pins and the complete original principal test assertions and timeouts", () => {
    const bytes = readFileSync(
      "tests/e2e/fixtures/principal-local-recovery-source-v4.json",
    );
    expect(digest(bytes)).toBe(
      "6d4af5c25f3a4fe45f3c60a860838c9f1d2857fa36cd51e1b287e6e5e09e53ce",
    );
    const map = JSON.parse(bytes.toString("utf8")) as {
      sources: { path: string; sha256: string }[];
    };
    expect(map.sources).toHaveLength(190);
    for (const row of map.sources) {
      const historical = readHistoricalRecoveryFixtureSource(
        root,
        row.path,
        191,
      );
      expect(digest(historical)).toBe(row.sha256);
    }
    const original = preserved(
      "tests/unit/principal-e2e-source.test.ts",
    ).toString("utf8");
    const staged = stageHistoricalRecoveryTestSource(
      original,
      "principal-e2e-source.test.ts",
    );
    const imported =
      'import { readHistoricalRecoveryFixtureSource } from "../../scripts/historical-recovery-unit-stage.mjs";\n';
    expect(
      staged
        .slice(imported.length)
        .replace(
          'writeFileSync(target, readHistoricalRecoveryFixtureSource(resolve("."), path, 191));',
          "writeFileSync(target, readFileSync(path));",
        ),
    ).toBe(original);
    expect(() =>
      stageHistoricalRecoveryTestSource(
        original.replace("runtimeSources: 15", "runtimeSources: 14"),
        "principal-e2e-source.test.ts",
      ),
    ).toThrow("TEST_SOURCE_CHANGED");
  });
});
