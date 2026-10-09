import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { APPROVED_PRODUCT_PRESENTATIONS } from "@/lib/mining-scene/product-presentation";
import {
  resolveCatalogProduct,
  resolveScene,
} from "@/lib/mining-scene/resolve-scene";
import {
  NVDA_GPU_APPROVED_SCENE,
  SCENE_REGISTRY,
} from "@/lib/mining-scene/scene-registry";
import {
  isApprovedResponsiveComposition,
  isApprovedSceneMasterImage,
  type ApprovedResponsiveSource,
} from "@/lib/mining-scene/types";
import {
  productNvdaMetadataFailures,
  productNvdaEncodedDimensions,
  verifyProductNvdaAssets,
} from "../../../scripts/verify-product-nvda-assets.mjs";

const sources = [
  ...NVDA_GPU_APPROVED_SCENE.responsiveSources,
  ...NVDA_GPU_APPROVED_SCENE.master.lightVariant.responsiveSources,
];
const manifest = JSON.parse(
  readFileSync("public/brand/assets.manifest.json", "utf8"),
);
const asset = () => ({
  ...manifest.assets.find(
    (value: { path: string }) =>
      value.path === NVDA_GPU_APPROVED_SCENE.master.assetPath,
  ),
});

describe("independent reviewed NVDA GPU variant", () => {
  it("uses its own four GPU masters without activating a shared family default", () => {
    const result = resolveCatalogProduct({
      code: "NVDA",
      category: "US_STOCK",
    });
    expect(result.scene).toBe(NVDA_GPU_APPROVED_SCENE);
    expect(result.visualStatus).toBe("MASTER_READY");
    expect(SCENE_REGISTRY.AI_GPU_COMPUTE.definition.packStatus).toBe(
      "VISUAL_MASTER_REQUIRED",
    );
    expect(SCENE_REGISTRY.AI_GPU_COMPUTE.definition.master).toBeNull();
    expect(
      new Set(sources.map((source) => source.composition.masterSha256)).size,
    ).toBe(4);
    expect(sources).toHaveLength(32);
    expect(sources.every(isApprovedResponsiveComposition)).toBe(true);
  });

  it.each(["AAPL", "MSFT", "UNKNOWN_GPU"])(
    "does not lend the NVDA variant to %s",
    (code) => {
      const result = resolveScene(
        { code, category: "US_STOCK" },
        {
          productCode: code,
          sceneFamilyKey: "AI_GPU_COMPUTE",
          sceneFamilyVersion: 1,
          profile: APPROVED_PRODUCT_PRESENTATIONS.NVDA.profile,
        },
      );
      expect(result.scene).toBeNull();
      expect(result.productionAssetActive).toBe(false);
      expect(result.visualStatus).toBe("MASTER_VARIANT_UNAVAILABLE");
    },
  );

  it("rejects the right code in a wrong category", () => {
    expect(
      resolveCatalogProduct({ code: "NVDA", category: "KR_STOCK" }).scene,
    ).toBeNull();
    expect(
      resolveCatalogProduct({ code: "NVDA", category: "CRYPTO" }).scene,
    ).toBeNull();
  });

  it("binds every source to its own orientation, hash, dimensions and geometry", () => {
    const portrait = sources[0]!;
    const landscape = sources[8]!;
    expect(portrait.media).toBe("(max-width: 699px)");
    expect(landscape.media).toBe("");
    expect(portrait.composition.anchor.x).toBe(0.5);
    expect(landscape.composition.anchor.x).toBe(0.73);
    expect(
      isApprovedResponsiveComposition({
        ...portrait,
        composition: landscape.composition,
      }),
    ).toBe(false);
    expect(
      isApprovedResponsiveComposition({
        ...portrait,
        height: portrait.height + 1,
      }),
    ).toBe(false);
    const without = { ...portrait } as ApprovedResponsiveSource;
    delete (without as { composition?: unknown }).composition;
    expect(isApprovedResponsiveComposition(without)).toBe(false);
    const altered = {
      ...portrait,
      composition: { ...portrait.composition, anchor: { x: 0.73, y: 0.5 } },
    };
    expect(isApprovedResponsiveComposition(altered)).toBe(false);
    expect(
      isApprovedSceneMasterImage({
        ...NVDA_GPU_APPROVED_SCENE.master,
        sha256: NVDA_GPU_APPROVED_SCENE.master.lightVariant.master.sha256,
      }),
    ).toBe(false);
  });

  it("rejects runtime metadata pollution and wrong source provenance", () => {
    expect(productNvdaMetadataFailures(asset())).toEqual([]);
    expect(
      productNvdaMetadataFailures({
        ...asset(),
        sourceSha256: sources[0]!.composition.masterSha256,
      }),
    ).not.toEqual([]);
    expect(
      productNvdaMetadataFailures({ ...asset(), economicMultiplier: "1.10" }),
    ).not.toEqual([]);
    expect(
      productNvdaMetadataFailures({
        ...asset(),
        path: "/brand/scenes/product-nvda-gpu-v1/unreviewed.webp",
      }),
    ).not.toEqual([]);
  });

  it("preserves all262 pre-GPU metadata records and every previous runtime byte", () => {
    const exactPaths = new Set(sources.map((source) => source.assetPath));
    const prior = manifest.assets.filter(
      (value: { path: string }) =>
        !exactPaths.has(value.path as (typeof sources)[number]["assetPath"]),
    );
    expect(prior).toHaveLength(262);
    expect(
      createHash("sha256").update(JSON.stringify(prior)).digest("hex"),
    ).toBe("446b7ceb3a2e24bef68070712af2f719f26ed457c671212472cacc4d1ff13d62");
    for (const previous of prior) {
      const bytes = readFileSync(`public${previous.path}`);
      expect(bytes.length).toBe(previous.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        previous.sha256,
      );
    }
  });

  it("checks all original bytes and actual encoded dimensions independently", async () => {
    expect(await verifyProductNvdaAssets(process.cwd())).toEqual([]);
    const runtime = asset();
    const bytes = readFileSync(`public${runtime.path}`);
    expect(productNvdaEncodedDimensions(bytes, runtime.mimeType)).toEqual({
      width: runtime.width,
      height: runtime.height,
    });
    expect(
      productNvdaEncodedDimensions(bytes.subarray(0, 10), runtime.mimeType),
    ).toBeNull();
  });
});
