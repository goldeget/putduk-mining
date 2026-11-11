import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  WORKROOM_ICON_SVG,
  WORKROOM_MARK,
  WORKROOM_METADATA_ICONS,
  WORKROOM_PWA_ICONS,
} from "@/components/workroom/brand";
import { WorkroomMark } from "@/components/workroom/workroom-mark";
import manifest from "@/app/manifest";

const root = new URL("../../", import.meta.url);
const bytes = (file: string) => readFileSync(new URL(file, root));
const assetManifest = JSON.parse(
  bytes("public/workroom-icons.manifest.json").toString("utf8"),
) as {
  sourceSvgSha256: string;
  geometry: typeof WORKROOM_MARK;
  files: {
    name: string;
    bytes: number;
    sha256: string;
    type: string;
    width?: number;
    height?: number;
    opaque?: boolean;
  }[];
};

describe("one canonical active WORKROOM identity", () => {
  it("uses identical W geometry, stroke and tile in inline44 and Apple180 marks", () => {
    for (const size of [44, 180]) {
      const markup = renderToStaticMarkup(
        createElement(WorkroomMark, { size }),
      );
      expect(markup).toContain(`viewBox="${WORKROOM_MARK.viewBox}"`);
      expect(markup).toContain(`width="${size}" height="${size}"`);
      expect(markup).toContain(
        `<rect width="44" height="44" rx="${WORKROOM_MARK.radius}" fill="${WORKROOM_MARK.background}"`,
      );
      expect(markup).toContain(`d="${WORKROOM_MARK.path}"`);
      expect(markup).toContain(
        `stroke="${WORKROOM_MARK.stroke}" stroke-width="${WORKROOM_MARK.strokeWidth}"`,
      );
      expect(markup).not.toContain("var(");
    }
  });
  it("preserves all generated hashes and identical member/admin raster and vector files", () => {
    const svg = Buffer.from(WORKROOM_ICON_SVG + "\n");
    expect(bytes("public/workroom-icon.svg").equals(svg)).toBe(true);
    expect(assetManifest.geometry).toEqual(WORKROOM_MARK);
    expect(createHash("sha256").update(svg).digest("hex")).toBe(
      assetManifest.sourceSvgSha256,
    );
    expect(assetManifest.files).toHaveLength(7);
    for (const file of assetManifest.files) {
      const data = bytes(`public/${file.name}`);
      expect(data.length, file.name).toBe(file.bytes);
      expect(createHash("sha256").update(data).digest("hex"), file.name).toBe(
        file.sha256,
      );
      expect(
        bytes(`apps/admin/public/${file.name}`).equals(data),
        file.name,
      ).toBe(true);
      if (file.type === "image/png") {
        expect(
          data
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        ).toBe(true);
        expect(data.readUInt32BE(16)).toBe(file.width);
        expect(data.readUInt32BE(20)).toBe(file.height);
        if (file.opaque) expect(data[25]).toBe(2);
      }
    }
  });
  it("has valid multi-size ICO images and installable192/512 plus maskable512 metadata", () => {
    const ico = bytes("public/workroom-favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    for (const [i, size] of [16, 32, 48].entries()) {
      const at = 6 + i * 16,
        length = ico.readUInt32LE(at + 8),
        offset = ico.readUInt32LE(at + 12);
      expect(ico[at]).toBe(size);
      expect(ico[at + 1]).toBe(size);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      expect(ico.readUInt32BE(offset + 16)).toBe(size);
      expect(ico.readUInt32BE(offset + 20)).toBe(size);
    }
    expect(manifest().icons).toEqual(WORKROOM_PWA_ICONS);
    expect(WORKROOM_PWA_ICONS.map((icon) => icon.sizes)).toEqual([
      "192x192",
      "512x512",
      "512x512",
    ]);
    expect(WORKROOM_PWA_ICONS[2]?.purpose).toBe("maskable");
    expect(WORKROOM_METADATA_ICONS.apple[0]?.sizes).toBe("180x180");
    for (const icon of WORKROOM_PWA_ICONS)
      expect(bytes("public" + icon.src).length).toBeGreaterThan(100);
  });
});
