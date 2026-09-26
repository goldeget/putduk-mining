import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

type ManifestAsset = {
  path: string;
  mimeType: string;
  alt: string;
  width?: number;
  height?: number;
  purpose?: string;
  theme?: string;
};

type AssetManifest = {
  schemaVersion: number;
  assetVersion: string;
  sourcePolicy: string;
  assets: ManifestAsset[];
};

async function loadManifest() {
  const source = await readFile(
    path.join(process.cwd(), "public", "brand", "assets.manifest.json"),
    "utf8",
  );
  return JSON.parse(source) as AssetManifest;
}

describe("PUTDUK brand asset contract", () => {
  it("keeps generated pixels separate from production copy", async () => {
    const manifest = await loadManifest();

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.assetVersion).toBe("2026.09.27-v1");
    expect(manifest.sourcePolicy).toContain(
      "generated pixels contain no production copy",
    );
    expect(manifest.sourcePolicy).toContain(
      "public files are optimized derivatives",
    );
    expect(manifest.assets.every((asset) => asset.alt.trim().length > 0)).toBe(
      true,
    );
  });

  it("contains six responsive neutral rank families", async () => {
    const manifest = await loadManifest();

    for (let index = 1; index <= 6; index += 1) {
      const rank = `rank-${String(index).padStart(2, "0")}`;
      for (const size of [128, 256, 512]) {
        expect(
          manifest.assets.some(
            (asset) =>
              asset.path === `/ranks/${rank}/planet-${size}-v1.avif` &&
              asset.width === size &&
              asset.height === size,
          ),
        ).toBe(true);
      }
    }
  });

  it("ships dark, light and maskable PWA assets", async () => {
    const manifest = await loadManifest();
    const pwa = manifest.assets.filter((asset) => asset.path.includes("/pwa/"));

    expect(
      pwa.some((asset) => asset.theme === "dark" && asset.width === 512),
    ).toBe(true);
    expect(
      pwa.some((asset) => asset.theme === "light" && asset.width === 512),
    ).toBe(true);
    expect(
      pwa.some((asset) => asset.purpose === "maskable" && asset.width === 512),
    ).toBe(true);
  });
});
