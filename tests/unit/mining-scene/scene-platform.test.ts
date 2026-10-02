import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { readSceneFromDisplayProfile } from "@/lib/mining-scene/display-profile-boundary";
import { findEconomicFieldPaths } from "@/lib/mining-scene/economic-field-guard";
import {
  APPROVED_PRODUCT_PRESENTATIONS,
  CATALOG_V1_PRODUCTS,
  presentationForCode,
} from "@/lib/mining-scene/product-presentation";
import { resolveCatalogProduct, resolveScene } from "@/lib/mining-scene/resolve-scene";
import { SAFE_SCENE_COPY } from "@/lib/mining-scene/safe-scene-copy";
import { SCENE_REGISTRY } from "@/lib/mining-scene/scene-registry";
import { SK_HYNIX_V3_REFERENCE } from "@/lib/mining-scene/sk-hynix-v3-reference";
import {
  projectStageInput,
  STAGE_INPUT_HAS_NO_ECONOMIC_IDENTITY,
  STAGE_SCENE_INPUT_KEYS,
} from "@/lib/mining-scene/stage-input";
import {
  APPROVED_SCENE_MASTER_SHA256,
  isApprovedMasterSha256,
  PRODUCT_CATEGORIES,
  SCENE_FAMILY_KEYS,
  tryActivateProductionMaster,
  type MiningProductIdentity,
  type ProductSceneProfile,
} from "@/lib/mining-scene/types";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const ASSIGNED_PRODUCT_CODE = "000660";
const ASSIGNED_FAMILY = "SEMICONDUCTOR_MEMORY" as const;

function identity(
  code: string,
  category: MiningProductIdentity["category"],
): MiningProductIdentity {
  return { code, category };
}

function profile(
  patch: Partial<ProductSceneProfile> = {},
): ProductSceneProfile {
  return {
    displayNameKo: "픽스처 테마",
    accentToken: "--brand-primary",
    particleEmphasis: "none",
    decorativeObjects: ["spark"],
    ambientPreset: "still",
    htmlCopyKo: "픽스처 채굴 테마예요.",
    a11yLabelKo: "픽스처 채굴 테마",
    masterVariant: null,
    ...patch,
  };
}

function sortedKeys(value: object) {
  return Object.keys(value).sort();
}

describe("catalog scene resolution", () => {
  test("keeps mining product codes, including leading zeroes", () => {
    expect(presentationForCode("005930")?.productCode).toBe("005930");
    expect(presentationForCode("000660")?.productCode).toBe("000660");
    expect(presentationForCode("5930")).toBeNull();
    expect(presentationForCode("660")).toBeNull();
    expect(Object.keys(APPROVED_PRODUCT_PRESENTATIONS).sort()).toEqual(
      CATALOG_V1_PRODUCTS.map((item) => item.code).sort(),
    );
  });

  test("keeps catalog identity and assigns a family only to 000660", () => {
    for (const product of CATALOG_V1_PRODUCTS) {
      const resolved = resolveCatalogProduct(product);
      expect(resolved.identity).toEqual({
        code: product.code,
        category: product.category,
      });
      expect(resolved.productionAssetActive).toBe(false);
      expect(resolved.userCopyKo).toBe(SAFE_SCENE_COPY);
      expect(resolved.userCopyKo).not.toContain("VISUAL_MASTER_REQUIRED");
      if (product.code === ASSIGNED_PRODUCT_CODE) {
        expect(resolved.presentation?.sceneFamilyKey).toBe(ASSIGNED_FAMILY);
        expect(resolved.scene?.familyKey).toBe(ASSIGNED_FAMILY);
        expect(resolved.visualStatus).toBe("VISUAL_MASTER_REQUIRED");
        expect(resolved.scene?.packStatus).toBe("VISUAL_MASTER_REQUIRED");
      } else {
        expect(resolved.presentation?.sceneFamilyKey).toBeNull();
        expect(resolved.scene).toBeNull();
        expect(resolved.visualStatus).toBe("FAMILY_UNASSIGNED");
      }
    }
  });

  test("does not classify a product by category or display name", () => {
    const resolved = resolveCatalogProduct(identity("XAU", "CRYPTO"));
    expect(resolved.presentation?.sceneFamilyKey).toBeNull();
    expect(resolved.scene).toBeNull();
    expect(resolved.identity.category).toBe("CRYPTO");
    expect(resolved.scene).not.toBe(SCENE_REGISTRY.PRECIOUS_GOLD.definition);

    const disguised = resolveScene(identity("FIXGOLD1", "GOLD"), {
      productCode: "FIXGOLD1",
      sceneFamilyKey: "PRECIOUS_GOLD",
      sceneFamilyVersion: 1,
      profile: profile({ displayNameKo: "엔비디아 테마" }),
    });
    expect(disguised.scene?.familyKey).toBe("PRECIOUS_GOLD");
    expect(disguised.presentation?.profile.displayNameKo).toBe("엔비디아 테마");
    expect(resolveCatalogProduct(identity("NVDA", "US_STOCK")).scene).toBeNull();
  });

  test("keeps gold and bitcoin copy away from ownership and quoted returns", () => {
    const gold = resolveCatalogProduct(identity("XAU", "GOLD"));
    const bitcoin = resolveCatalogProduct(identity("BTC", "CRYPTO"));
    expect(gold.userCopyKo).toBe(SAFE_SCENE_COPY);
    expect(bitcoin.userCopyKo).toBe(SAFE_SCENE_COPY);
    expect(gold.presentation?.sceneFamilyKey).toBeNull();
    expect(bitcoin.presentation?.sceneFamilyKey).toBeNull();
    expect(`${gold.userCopyKo} ${bitcoin.userCopyKo}`).not.toMatch(
      /보유|수익|연동|잔액/,
    );
  });
});

describe("scene selection without a renderer branch", () => {
  test("maps a new fixture product onto an existing family scene", () => {
    const stageSource = readFileSync(
      join(root, "components/mining-live/mining-live-stage.tsx"),
      "utf8",
    );
    const fixture = resolveScene(identity("FIXMEM01", "KR_STOCK"), {
      productCode: "FIXMEM01",
      sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
      sceneFamilyVersion: 1,
      profile: profile({
        displayNameKo: "픽스처 메모리",
        particleEmphasis: "none",
        htmlCopyKo: "픽스처 메모리 채굴 테마예요.",
        a11yLabelKo: "픽스처 메모리 채굴 테마",
      }),
    });
    const catalog = resolveCatalogProduct(identity("005930", "KR_STOCK"));

    const assigned = resolveCatalogProduct(identity(ASSIGNED_PRODUCT_CODE, "KR_STOCK"));

    expect(fixture.scene).toBe(SCENE_REGISTRY.SEMICONDUCTOR_MEMORY.definition);
    expect(fixture.scene).toBe(assigned.scene);
    expect(catalog.scene).toBeNull();
    expect(catalog.presentation?.sceneFamilyKey).toBeNull();
    expect(stageSource).not.toContain("FIXMEM01");
    expect(stageSource).not.toContain("SEMICONDUCTOR_MEMORY");
  });

  test("shares one family scene across two fixture products only", () => {
    const first = resolveScene(identity("FIXMEM01", "KR_STOCK"), {
      productCode: "FIXMEM01",
      sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
      sceneFamilyVersion: 1,
      profile: profile({ particleEmphasis: "none" }),
    });
    const second = resolveScene(identity("FIXMEM02", "US_STOCK"), {
      productCode: "FIXMEM02",
      sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
      sceneFamilyVersion: 1,
      profile: profile({ particleEmphasis: "steady" }),
    });
    const samsung = resolveCatalogProduct(identity("005930", "KR_STOCK"));
    const hynix = resolveCatalogProduct(identity("000660", "KR_STOCK"));

    expect(first.scene).toBe(second.scene);
    expect(first.scene).toBe(SCENE_REGISTRY.SEMICONDUCTOR_MEMORY.definition);
    expect(hynix.scene).toBe(SCENE_REGISTRY.SEMICONDUCTOR_MEMORY.definition);
    expect(samsung.scene).toBeNull();
    expect(samsung.scene).not.toBe(hynix.scene);
    expect(first.presentation?.profile.particleEmphasis).toBe("none");
    expect(second.presentation?.profile.particleEmphasis).toBe("steady");

    for (const code of ["ETH", "BNB", "XRP", "BTC", "NVDA", "XAU", "XAG"] as const) {
      const resolved = resolveCatalogProduct(
        CATALOG_V1_PRODUCTS.find((item) => item.code === code)!,
      );
      expect(resolved.presentation?.sceneFamilyKey).toBeNull();
      expect(resolved.scene).toBeNull();
    }
  });

  test("keeps the same scene object when only the product profile changes", () => {
    const assigned = APPROVED_PRODUCT_PRESENTATIONS[ASSIGNED_PRODUCT_CODE];
    const original = resolveScene(identity(ASSIGNED_PRODUCT_CODE, "KR_STOCK"), {
      productCode: assigned.productCode,
      sceneFamilyKey: assigned.sceneFamilyKey ?? "",
      sceneFamilyVersion: assigned.sceneFamilyVersion ?? 0,
      profile: assigned.profile,
    });
    const changed = resolveScene(identity(ASSIGNED_PRODUCT_CODE, "KR_STOCK"), {
      productCode: assigned.productCode,
      sceneFamilyKey: assigned.sceneFamilyKey ?? "",
      sceneFamilyVersion: assigned.sceneFamilyVersion ?? 0,
      profile: {
        ...assigned.profile,
        particleEmphasis: "none",
      },
    });

    expect(changed.scene).toBe(original.scene);
    expect(changed.scene?.particle).toBe(original.scene?.particle);
    expect(original.presentation?.profile.particleEmphasis).toBe("steady");
    expect(changed.presentation?.profile.particleEmphasis).toBe("none");
    expect(changed.presentation).not.toBe(original.presentation);
  });

  test("rejects an unknown family without borrowing another scene", () => {
    const unsupported = resolveScene(identity("FIXBAD01", "US_STOCK"), {
      productCode: "FIXBAD01",
      sceneFamilyKey: "SCENE_1",
      sceneFamilyVersion: 1,
      profile: profile({ displayNameKo: "SK하이닉스 테마" }),
    });
    const wrongVersion = resolveScene(identity("FIXBAD02", "KR_STOCK"), {
      productCode: "FIXBAD02",
      sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
      sceneFamilyVersion: 2,
      profile: profile(),
    });

    expect(unsupported.visualStatus).toBe("UNSUPPORTED_FAMILY");
    expect(unsupported.scene).toBeNull();
    expect(unsupported.productionAssetActive).toBe(false);
    expect(unsupported.userCopyKo).toBe(SAFE_SCENE_COPY);
    expect(unsupported.userCopyKo).not.toContain("VISUAL_MASTER_REQUIRED");
    expect(wrongVersion.scene).toBeNull();
    expect(wrongVersion.scene).not.toBe(
      SCENE_REGISTRY.SEMICONDUCTOR_MEMORY.definition,
    );
    expect(projectStageInput(unsupported).familyKey).toBeNull();
    expect(projectStageInput(unsupported).master).toBeNull();
    expect(projectStageInput(unsupported).decoration).toBe("none");
  });
});

describe("presentation boundary", () => {
  test("separates product identity from presentation metadata", () => {
    const resolved = resolveCatalogProduct(identity("005930", "KR_STOCK"));
    expect(resolved.identity).toEqual({
      code: "005930",
      category: "KR_STOCK",
    });
    expect(resolved.identity).not.toHaveProperty("sceneFamilyKey");
    expect(resolved.identity).not.toHaveProperty("displayNameKo");
    expect(resolved.presentation).not.toHaveProperty("category");
    expect(resolved.presentation?.productCode).toBe(resolved.identity.code);
    expect(resolved.presentation?.sceneFamilyKey).toBeNull();
    expect(resolved.scene).toBeNull();

    const mismatch = resolveScene(identity("005930", "KR_STOCK"), {
      productCode: "000660",
      sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
      sceneFamilyVersion: 1,
      profile: profile(),
    });
    expect(mismatch.visualStatus).toBe("PRESENTATION_MISMATCH");
    expect(mismatch.scene).toBeNull();
    expect(mismatch.presentation).toBeNull();
  });

  test("ignores display_profile JSON and injected urls or scripts", () => {
    expect(
      readSceneFromDisplayProfile({
        sceneFamilyKey: "PRECIOUS_GOLD",
        x: 12,
        y: 40,
        script: "doSettle()",
        url: "https://example.com/master.png",
        difficulty: "neutral",
        risk: "display_only",
      }),
    ).toBeNull();

    const poisoned = resolveScene(identity("XAU", "GOLD"), {
      productCode: "XAU",
      sceneFamilyKey: "PRECIOUS_GOLD",
      sceneFamilyVersion: 1,
      profile: {
        ...profile(),
        balance: 5000,
      } as ProductSceneProfile,
      assetUrl: "https://example.com/master.png",
      script: "doSettle()",
      masterSha256: SK_HYNIX_V3_REFERENCE.backgroundSha256,
    } as never);
    const encoded = JSON.stringify(poisoned);

    expect(poisoned.productionAssetActive).toBe(false);
    expect(poisoned.scene?.master).toBeNull();
    expect(encoded).not.toContain("doSettle");
    expect(encoded).not.toContain("https://");
    expect(encoded).not.toContain(SK_HYNIX_V3_REFERENCE.backgroundSha256);
    expect(encoded).not.toContain("balance");
    expect(tryActivateProductionMaster(SK_HYNIX_V3_REFERENCE.backgroundSha256)).toBeNull();
    expect(
      isApprovedMasterSha256(SK_HYNIX_V3_REFERENCE.backgroundSha256),
    ).toBe(false);
  });
});

describe("registry contract", () => {
  test("has no money, yield, or balance fields", () => {
    expect(findEconomicFieldPaths(SCENE_REGISTRY)).toEqual([]);
    expect(findEconomicFieldPaths(APPROVED_PRODUCT_PRESENTATIONS)).toEqual([]);
    expect(findEconomicFieldPaths(SK_HYNIX_V3_REFERENCE)).toEqual([]);
    expect(findEconomicFieldPaths(projectStageInput(
      resolveCatalogProduct(identity("XAU", "GOLD")),
    ))).toEqual([]);
    expect(JSON.stringify(SCENE_REGISTRY)).not.toMatch(
      /balance|yield|pending|verified|수익률|잔액/i,
    );
  });

  test("does not activate an unapproved family or the SK hynix reference as a production asset", () => {
    expect(APPROVED_SCENE_MASTER_SHA256).toEqual([]);
    expect(SK_HYNIX_V3_REFERENCE.activatesProductionScene).toBe(false);
    expect(SK_HYNIX_V3_REFERENCE.productionAssetApproval).toBe("NOT_APPROVED");
    expect(SCENE_REGISTRY.ETF_BASKET.economicPolicy).toBe("DECISION_REQUIRED");
    expect(JSON.stringify(PRODUCT_CATEGORIES)).not.toContain("ETF");

    for (const familyKey of SCENE_FAMILY_KEYS) {
      const row = SCENE_REGISTRY[familyKey];
      expect(row.definition.packStatus).toBe("VISUAL_MASTER_REQUIRED");
      expect(row.definition.master).toBeNull();
      expect(row.definition.productionAssetActive).toBe(false);
      expect(row.definition.responsiveSources).toEqual([]);
      expect(row.definition.performance.webgl).toBe(false);
      expect(row.definition.performance.timerAdvancesValue).toBe(false);
      expect(row.definition.performance.renderer).toBe("none");
    }

    const assigned = Object.values(APPROVED_PRODUCT_PRESENTATIONS).filter(
      (item) => item.sceneFamilyKey !== null,
    );
    expect(assigned.map((item) => item.productCode)).toEqual([
      ASSIGNED_PRODUCT_CODE,
    ]);
    expect(assigned.map((item) => item.sceneFamilyKey)).toEqual([
      ASSIGNED_FAMILY,
    ]);
  });

  test("keeps the SK hynix V3 hash contract stable and out of the family registry", () => {
    expect(SK_HYNIX_V3_REFERENCE).toEqual({
      referenceApproval: "REFERENCE_APPROVED",
      productionAssetApproval: "NOT_APPROVED",
      activatesProductionScene: false,
      htmlByteLength: 493313,
      htmlSha256:
        "2f33d6b021f642e043e9068f353c3d279540d9c370b2478ef3173f2d9535ecd7",
      embeddedJpegCount: 1,
      embeddedJpegByteLength: 355879,
      embeddedJpegWidth: 1024,
      embeddedJpegHeight: 680,
      backgroundSha256:
        "9c0ae9234b747d71e7ea81bfb43190cad7fd4ac1358c1b673bdc4ed13c3a881c",
    });

    const referenceSource = readFileSync(
      join(root, "lib/mining-scene/sk-hynix-v3-reference.ts"),
      "utf8",
    );
    const registrySource = readFileSync(
      join(root, "lib/mining-scene/scene-registry.ts"),
      "utf8",
    );
    expect(referenceSource).not.toContain("scene-registry");
    expect(referenceSource).not.toContain("SEMICONDUCTOR_MEMORY");
    expect(referenceSource).not.toContain("ETF_BASKET");
    expect(registrySource).not.toContain("sk-hynix-v3-reference");
    expect(registrySource).not.toContain(SK_HYNIX_V3_REFERENCE.htmlSha256);
    expect(registrySource).not.toContain(SK_HYNIX_V3_REFERENCE.backgroundSha256);

    const manifest = readFileSync(
      join(root, "public/brand/assets.manifest.json"),
      "utf8",
    );
    expect(manifest).not.toContain(SK_HYNIX_V3_REFERENCE.htmlSha256);
    expect(manifest).not.toContain(SK_HYNIX_V3_REFERENCE.backgroundSha256);
  });

  test("projects every family through one stage input shape", () => {
    const expectedKeys = [...STAGE_SCENE_INPUT_KEYS].sort();
    const shapes = new Set<string>();

    for (const familyKey of SCENE_FAMILY_KEYS) {
      const resolved = resolveScene(identity("PROBE01", "KR_STOCK"), {
        productCode: "PROBE01",
        sceneFamilyKey: familyKey,
        sceneFamilyVersion: 1,
        profile: profile({ htmlCopyKo: "장면 그림을 준비하고 있어요." }),
      });
      const projected = projectStageInput(resolved);
      shapes.add(sortedKeys(projected).join(","));
      expect(sortedKeys(projected)).toEqual(expectedKeys);
      expect(projected).not.toHaveProperty("productCode");
      expect(projected).not.toHaveProperty("balance");
      expect(projected.familyKey).toBe(familyKey);
      expect(projected.master).toBeNull();
      expect(projected.productionAssetActive).toBe(false);
      expect(projected.decoration).toBe("none");
      expect(projected.reducedMotion).toBe("static");
    }

    expect(shapes.size).toBe(1);
    expect(STAGE_INPUT_HAS_NO_ECONOMIC_IDENTITY).toBe(true);
  });

  test("keeps the core renderer free of product and family branches", () => {
    const stageSource = readFileSync(
      join(root, "components/mining-live/mining-live-stage.tsx"),
      "utf8",
    );
    const decorationSource = readFileSync(
      join(root, "components/mining-live/scene-decoration.tsx"),
      "utf8",
    );
    const styleSource = readFileSync(
      join(root, "components/mining-live/mining-live-stage.module.css"),
      "utf8",
    );
    const resolverSource = readFileSync(
      join(root, "lib/mining-scene/resolve-scene.ts"),
      "utf8",
    );
    const combined = `${stageSource}\n${decorationSource}`;

    expect(stageSource).not.toMatch(/product\s*===/);
    expect(stageSource).not.toMatch(/familyKey\s*===/);
    expect(stageSource).not.toMatch(/switch\s*\(/);
    expect(stageSource).not.toContain("APPROVED_PRODUCT_PRESENTATIONS");
    expect(stageSource).not.toContain("SCENE_REGISTRY");
    expect(stageSource).not.toMatch(/>\s*VISUAL_MASTER_REQUIRED\s*</);
    for (const familyKey of SCENE_FAMILY_KEYS) {
      expect(stageSource).not.toContain(familyKey);
    }
    for (const code of CATALOG_V1_PRODUCTS.map((item) => item.code)) {
      expect(stageSource).not.toContain(code);
    }

    expect(combined).not.toMatch(/Math\.random|doSettle|setInterval|requestAnimationFrame/);
    expect(combined).not.toMatch(/getContext\(\s*["']webgl/);
    expect(combined).not.toMatch(/\bthree\b|openai|dall-e|generative/i);
    expect(styleSource).not.toMatch(/gradient|@keyframes|animation\s*:/i);
    expect(resolverSource).not.toContain("display_profile");
    expect(resolverSource).not.toMatch(/삼성|하이닉스|엔비디아|NVIDIA/);

    const sceneDir = readdirSync(join(root, "lib/mining-scene"));
    expect(sceneDir.filter((name) => name.endsWith(".sql"))).toEqual([]);
    expect(sceneDir.some((name) => name.startsWith("CHANGE_REQUEST"))).toBe(
      false,
    );
  });
});
