import { readFileSync } from "node:fs";
import { parse } from "postcss";
import { describe, expect, it } from "vitest";

const css = parse(
  readFileSync(new URL("../app/admin-workspace.css", import.meta.url), "utf8"),
);
function tokens(selector: string) {
  const values: Record<string, string> = {};
  css.walkRules(selector, (rule) => {
    rule.walkDecls((decl) => {
      values[decl.prop] = decl.value;
    });
  });
  return values;
}
function luminance(hex: string) {
  const raw = hex.slice(1);
  const full =
    raw.length === 3 ? [...raw].map((value) => value + value).join("") : raw;
  const linear = [0, 2, 4]
    .map((index) => parseInt(full.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high! + 0.05) / (low! + 0.05);
}
describe("administrator palette readability", () => {
  for (const theme of ["dark", "light"] as const)
    it(`${theme} keeps text and control boundaries readable on their actual surfaces`, () => {
      const palette = {
        ...tokens(":root"),
        ...(theme === "light" ? tokens('html[data-theme="light"]') : {}),
      };
      for (const name of [
        "--admin-text",
        "--admin-muted",
        "--admin-subtle",
        "--admin-accent",
      ]) {
        expect(
          contrast(palette[name]!, palette["--admin-surface"]!),
          name,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrast(palette["--admin-accent"]!, palette["--admin-accent-ink"]!),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(palette["--admin-line-strong"]!, palette["--admin-sunken"]!),
      ).toBeGreaterThanOrEqual(3);
    });
});
