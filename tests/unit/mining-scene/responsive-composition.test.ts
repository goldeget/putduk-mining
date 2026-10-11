import { describe, expect, it } from "vitest";

import { resolveCatalogProduct } from "@/lib/mining-scene/resolve-scene";
import { projectStageInput } from "@/lib/mining-scene/stage-input";
import { resolveResponsiveComposition } from "@/lib/mining-scene/responsive-composition";
import { sceneAnchorPosition } from "@/components/mining-live/scene-decoration";

const origin = "https://mining.putduk.test";

describe("reviewed responsive composition follows the actual selected image", () => {
  it("keeps GPU portrait and landscape geometry distinct in both themes", () => {
    const scene = projectStageInput(
      resolveCatalogProduct({ code: "NVDA", category: "US_STOCK" }),
    );
    expect(scene.master).not.toBeNull();
    const themes = [
      { master: scene.master!, sources: scene.responsiveSources },
      {
        master: scene.master!.lightVariant!.master,
        sources: scene.master!.lightVariant!.responsiveSources,
      },
    ];
    for (const { master, sources } of themes) {
      for (const source of sources) {
        const result = resolveResponsiveComposition({
          currentSrc: `${origin}${source.assetPath}`,
          origin,
          master,
          sources,
          anchor: scene.anchor,
          extractionTarget: scene.extractionTarget,
        });
        expect(result).toEqual({
          width: source.width,
          height: source.height,
          anchor: source.composition!.anchor,
          extractionTarget: source.composition!.extractionTarget,
        });
      }
      expect(
        new Set(sources.map((source) => source.composition!.anchor.x)).size,
      ).toBe(2);
    }
  });

  it("rejects foreign URLs, query variants, unregistered paths and corrupt compositions", () => {
    const scene = projectStageInput(
      resolveCatalogProduct({ code: "NVDA", category: "US_STOCK" }),
    );
    const source = scene.responsiveSources[0]!;
    const input = {
      origin,
      master: scene.master!,
      sources: scene.responsiveSources,
      anchor: scene.anchor,
      extractionTarget: scene.extractionTarget,
    };
    for (const currentSrc of [
      `https://untrusted.test${source.assetPath}`,
      `${origin}${source.assetPath}?version=fake`,
      `${origin}${source.assetPath}#fake`,
      `${origin}/brand/scenes/unregistered.webp`,
    ])
      expect(resolveResponsiveComposition({ ...input, currentSrc })).toBeNull();
    const corrupt = {
      ...source,
      composition: { ...source.composition!, anchor: { x: 0.9, y: 0.9 } },
    };
    expect(
      resolveResponsiveComposition({
        ...input,
        currentSrc: `${origin}${source.assetPath}`,
        sources: [corrupt],
      }),
    ).toBeNull();
  });

  it("preserves the existing memory composition without introducing a product fallback", () => {
    const scene = projectStageInput(
      resolveCatalogProduct({ code: "000660", category: "KR_STOCK" }),
    );
    const source = scene.responsiveSources[0]!;
    const result = resolveResponsiveComposition({
      currentSrc: `${origin}${source.assetPath}`,
      origin,
      master: scene.master!,
      sources: scene.responsiveSources,
      anchor: scene.anchor,
      extractionTarget: scene.extractionTarget,
    });
    expect(result?.anchor).toEqual(scene.anchor);
    expect(
      resolveCatalogProduct({ code: "AAPL", category: "US_STOCK" })
        .productionAssetActive,
    ).toBe(false);
  });

  it("registers local effects to the actual CSS cover alignment", () => {
    expect(
      sceneAnchorPosition(
        400,
        600,
        1000,
        600,
        { x: 0.73, y: 0.5 },
        { x: 0.64, y: 0.68 },
      ),
    ).toEqual({ x: 346, y: 300 });
    expect(
      sceneAnchorPosition(400, 600, 1000, 600, { x: 0.73, y: 0.5 }),
    ).toEqual({ x: 430, y: 300 });
  });
});
