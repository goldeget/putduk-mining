import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
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
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const preserved = (path: string) =>
  execFileSync("git", [
    "--no-optional-locks",
    "show",
    `630ca8ac2cfda90e39cdf6e04b0df906986cb275:${path}`,
  ]);
describe("historical recovery test-only staging", () => {
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
