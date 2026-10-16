import { describe, expect, it } from "vitest";

import { APPROVED_PRODUCT_PRESENTATIONS } from "@/lib/mining-scene/product-presentation";
import { resolveScene } from "@/lib/mining-scene/resolve-scene";
import { SEMICONDUCTOR_MEMORY_APPROVED_SCENE } from "@/lib/mining-scene/scene-registry";
import { projectStageInput } from "@/lib/mining-scene/stage-input";
import type { ProductSceneProfile } from "@/lib/mining-scene/types";

describe("reviewed product master variant seam", () => {
  it("selects the existing reviewed HBM variant before projecting away product identity", () => {
    const product = APPROVED_PRODUCT_PRESENTATIONS["000660"];
    const scene = resolveScene(
      { code: "000660", category: "KR_STOCK" },
      {
        productCode: "000660",
        sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
        sceneFamilyVersion: 1,
        profile: product.profile,
      },
    );
    expect(scene.visualStatus).toBe("MASTER_READY");
    expect(scene.scene).toBe(SEMICONDUCTOR_MEMORY_APPROVED_SCENE);
    expect(scene.presentation!.profile.masterVariant).toBe(
      "semiconductor-memory-v1",
    );
    const stage = projectStageInput(scene);
    expect(stage.master).toEqual(scene.scene!.master);
    expect(stage).not.toHaveProperty("productCode");
    expect(stage).not.toHaveProperty("productId");
    expect(stage).not.toHaveProperty("masterVariant");
  });

  it.each(["NVDA", "AAPL", "MSFT"])(
    "does not borrow HBM variant for %s even with a matching family",
    (code) => {
      const scene = resolveScene(
        { code, category: "US_STOCK" },
        {
          productCode: code,
          sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
          sceneFamilyVersion: 1,
          profile: APPROVED_PRODUCT_PRESENTATIONS["000660"].profile,
        },
      );
      expect(scene.visualStatus).toBe("MASTER_VARIANT_UNAVAILABLE");
      expect(scene.scene).toBeNull();
      expect(scene.productionAssetActive).toBe(false);
      expect(projectStageInput(scene).master).toBeNull();
    },
  );

  it.each(["unreviewed-gpu-v1", "https://example.com/master.webp"])(
    "rejects unreviewed variant %s without family-default fallback",
    (variant) => {
      const scene = resolveScene(
        { code: "000660", category: "KR_STOCK" },
        {
          productCode: "000660",
          sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
          sceneFamilyVersion: 1,
          profile: {
            ...APPROVED_PRODUCT_PRESENTATIONS["000660"].profile,
            masterVariant: variant,
          } as ProductSceneProfile,
        },
      );
      expect(scene.visualStatus).toBe("MASTER_VARIANT_UNAVAILABLE");
      expect(scene.scene).toBeNull();
    },
  );

  it("cannot use an accepted variant with a different family", () => {
    const scene = resolveScene(
      { code: "000660", category: "KR_STOCK" },
      {
        productCode: "000660",
        sceneFamilyKey: "SEMICONDUCTOR_COMPUTE",
        sceneFamilyVersion: 1,
        profile: APPROVED_PRODUCT_PRESENTATIONS["000660"].profile,
      },
    );
    expect(scene.visualStatus).toBe("MASTER_VARIANT_UNAVAILABLE");
    expect(scene.scene).toBeNull();
  });
});
