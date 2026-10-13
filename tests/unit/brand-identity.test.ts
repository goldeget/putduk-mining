import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandMark } from "@/components/brand/brand-mark";
import { MenuBrandSymbol } from "@/components/product/menu-brand-symbol";
import { MiningBrandSymbol } from "@/components/product/mining-brand-symbol";
import { WalletBrandSymbol } from "@/components/product/wallet-brand-symbol";
import { PutdukIcon } from "@/components/icons/putduk-icon";
import { PUTDUK_SYMBOL_PATH } from "@/components/brand/putduk-symbol";

describe("canonical native PUTDUK identity", () => {
  it("separates current identity authority from the unchanged historical collection", async () => {
    const historic = JSON.parse(
      await readFile(
        path.join(process.cwd(), "public/brand/assets.manifest.json"),
        "utf8",
      ),
    );
    const current = JSON.parse(
      await readFile(
        path.join(process.cwd(), "public/brand/identity.manifest.json"),
        "utf8",
      ),
    );
    expect(historic.assetVersion).toBe("2026.10.06-v18");
    expect(current.assetVersion).toBe("2026.10.13-sprout-p-v1");
    expect(
      current.assets.every((asset: { path: string }) =>
        asset.path.startsWith("/brand/identity/20261013/"),
      ),
    ).toBe(true);
    expect(
      historic.assets.some((asset: { path: string }) =>
        asset.path.startsWith("/brand/identity/"),
      ),
    ).toBe(false);
    expect(current.adminPublicCopies).toHaveLength(4);
  });

  it("keeps accessible names and decorative instances without duplicate SVG IDs", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(BrandMark, { title: "퍼뜩 채굴" }),
        createElement(BrandMark, { title: "PUTDUK AI" }),
        createElement(BrandMark, { title: "" }),
      ),
    );
    expect(html).toContain('aria-label="퍼뜩 채굴"');
    expect(html).toContain('aria-label="PUTDUK AI"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/\sid=/);
    expect(html).not.toContain("url(#");
  });

  it("uses the same original silhouette in menu, mining and wallet placements", () => {
    for (const html of [
      renderToStaticMarkup(createElement(MenuBrandSymbol, {})),
      renderToStaticMarkup(createElement(MiningBrandSymbol, {})),
      renderToStaticMarkup(createElement(WalletBrandSymbol, {})),
    ]) {
      expect(html).toContain(`d="${PUTDUK_SYMBOL_PATH}"`);
      expect(html).toContain('data-putduk-brand="canonical"');
      expect(html).toContain(
        'data-putduk-brand-version="2026.10.13-sprout-p-v1"',
      );
    }
  });

  it("keeps the AI navigation glyph in the same identity without changing its control label", () => {
    const html = renderToStaticMarkup(
      createElement(PutdukIcon, { name: "ai", size: 24, label: "퍼뜩 AI" }),
    );
    expect(html).toContain(`d="${PUTDUK_SYMBOL_PATH}"`);
    expect(html).toContain('transform="scale(.375)"');
    expect(html).toContain("퍼뜩 AI");
  });

  it("delivers real correctly sized PWA PNGs and a three-resolution ICO", async () => {
    for (const theme of ["dark", "light"]) {
      for (const size of [192, 512]) {
        const png = await readFile(
          path.join(
            process.cwd(),
            `public/brand/identity/20261013/pwa/putduk-pwa-${theme}-${size}.png`,
          ),
        );
        expect(png.subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        );
        expect(png.readUInt32BE(16)).toBe(size);
        expect(png.readUInt32BE(20)).toBe(size);
      }
    }
    const ico = await readFile(
      path.join(
        process.cwd(),
        "public/brand/identity/20261013/favicon/favicon.ico",
      ),
    );
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
  });

  it("uses a new AI entry asset while preserving the old reviewed face originals", async () => {
    for (const file of ["putduk-ai-mascot.tsx", "putduk-ai-chat.tsx"]) {
      const source = await readFile(
        path.join(process.cwd(), "components/product", file),
        "utf8",
      );
      expect(source).toContain(
        "/brand/identity/20261013/logo/putduk-ai-symbol.svg",
      );
      expect(source).not.toContain("/brand/mascot/putduk-ai-help-face-");
    }
    const master = await readFile(
      path.join(
        process.cwd(),
        "docs/design/generated-masters/ai-help-face-2026-10-03/putduk-ai-help-face-master-v1.png",
      ),
    );
    expect(master.length).toBeGreaterThan(0);
  });
});
