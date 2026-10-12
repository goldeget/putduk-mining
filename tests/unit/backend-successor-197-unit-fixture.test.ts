import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  stageBackend197UnitFixtureSource,
  backend197UnitConfigPair,
  backend197UnitFixturePlugin,
} from "../../scripts/backend-successor-197-unit-fixture.mjs";
const original = readFileSync(
  "tests/unit/backend-successor-197-source.test.ts",
  "utf8",
);
const config = readFileSync("supabase/config.toml", "utf8");
const digest = (x: string) => createHash("sha256").update(x).digest("hex");
describe("exact 197 fixture staging keeps original assertions and both closed configs", () => {
  it("changes only setup before the original cleanup and assertion body", () => {
    const staged = stageBackend197UnitFixtureSource(original);
    expect(staged.slice(staged.indexOf("afterEach(() =>"))).toBe(
      original.slice(original.indexOf("afterEach(() =>")),
    );
    expect(staged).toContain("beforeEach(() => stagedFixture.prepare())");
    expect(staged).not.toContain("testTimeout");
  });
  it("rejects changed historical source", () =>
    expect(() => stageBackend197UnitFixtureSource(original + "\n")).toThrow(
      "ORIGINAL_CHANGED",
    ));
  it("makes the same exact pair from local or canonical checkout", () => {
    const pair = backend197UnitConfigPair(config);
    expect(backend197UnitConfigPair(pair.local)).toEqual(pair);
    expect(backend197UnitConfigPair(pair.canonical)).toEqual(pair);
    expect(digest(pair.local)).toBe(
      "10d9f6c49fb454daccca63f534bb75b1e0decd6be3184b51c492b02a2ee863a7",
    );
    expect(digest(pair.canonical)).toBe(
      "942e6721ffb77110895f3146b3ab53a285503120a2f0c90d50e8a5b28be8e1ac",
    );
  });
  it("rejects arbitrary local configuration", () =>
    expect(() => backend197UnitConfigPair(config + "\n")).toThrow(
      "CONFIG_CHANGED",
    ));
  it("never transforms an unrelated test", () =>
    expect(
      backend197UnitFixturePlugin().transform("test code", "/other/test.ts"),
    ).toBeUndefined());
});
