import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  WorldThemeArtwork,
  resolveWorldThemeArtwork,
} from "@/components/product/world-theme-artwork";

const worlds = [
  ["KOREA", "korea"],
  ["USA", "usa"],
  ["GOLD", "gold"],
  ["SILVER", "silver"],
  ["CRYPTO", "digital"],
] as const;

describe("server world theme artwork", () => {
  it.each(worlds)(
    "uses distinct existing artwork for %s",
    async (code, key) => {
      expect(resolveWorldThemeArtwork(code)).toBe(key);
      const html = renderToStaticMarkup(
        createElement(WorldThemeArtwork, { worldCode: code }),
      );
      expect(html).toContain(`data-world-theme-artwork="${key}"`);
      expect(html).toContain(
        `/brand/scenes/world-collection/${key}-320-v1.webp`,
      );
      expect(html).toContain(`${key}-640-v1.avif 640w`);
      expect(html).toContain('alt=""');
      expect(html).toContain('width="320" height="213"');
      expect(html).toContain('loading="lazy"');
      const manifest = JSON.parse(
        await readFile(
          path.join(process.cwd(), "public/brand/world-assets.manifest.json"),
          "utf8",
        ),
      );
      const world = manifest.worlds.find(
        (entry: { key: string }) => entry.key === key,
      );
      expect(
        world.assets.some(
          (entry: { path: string }) =>
            entry.path === `/brand/scenes/world-collection/${key}-320-v1.webp`,
        ),
      ).toBe(true);
    },
  );

  it.each([
    "UNKNOWN",
    "korea",
    "KR_STOCK",
    "__proto__",
    "constructor",
    "",
    null,
    undefined,
  ])("does not assign unknown code %s to a valid world", (code) => {
    expect(resolveWorldThemeArtwork(code)).toBeNull();
    if (typeof code === "string") {
      expect(
        renderToStaticMarkup(
          createElement(WorldThemeArtwork, { worldCode: code }),
        ),
      ).toBe("");
    }
  });

  it("keeps the page's existing icon fallback and server-owned labels/session logic", async () => {
    const source = await readFile(
      path.join(process.cwd(), "app/(product)/mining/page.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /resolveWorldThemeArtwork\(world.code\)[\s\S]*?<WorldThemeArtwork worldCode=\{world.code\} \/>[\s\S]*?<PutdukIcon name="products" size=\{28\} \/>/,
    );
    expect(source).toContain("{world.display_name_ko}");
    expect(source).toContain("session.world_code === world.code &&");
    expect(source).toContain("isConfirmedMiningRunning(session.status)");
  });
});
