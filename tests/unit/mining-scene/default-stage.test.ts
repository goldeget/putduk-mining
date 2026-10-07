import { afterEach, describe, expect, test, vi } from "vitest";

import { resolveDefaultStageInput } from "@/lib/mining-scene/default-stage";
import { findEconomicFieldPaths } from "@/lib/mining-scene/economic-field-guard";
import { resolveCatalogProduct } from "@/lib/mining-scene/resolve-scene";
import { DEFAULT_STAGE_BACKDROP } from "@/lib/mining-scene/scene-registry";
import { STAGE_SCENE_INPUT_KEYS } from "@/lib/mining-scene/stage-input";
import { APPROVED_SCENE_MASTER_SHA256 } from "@/lib/mining-scene/types";

const registryOverride = vi.hoisted(() => ({ backdrop: null as unknown }));

vi.mock("@/lib/mining-scene/scene-registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/mining-scene/scene-registry")>();
  return {
    ...actual,
    get DEFAULT_STAGE_BACKDROP() {
      return registryOverride.backdrop ?? actual.DEFAULT_STAGE_BACKDROP;
    },
  };
});

const registeredBackdrop = DEFAULT_STAGE_BACKDROP;

afterEach(() => {
  registryOverride.backdrop = null;
});

function replaceDefinition(patch: Record<string, unknown>) {
  registryOverride.backdrop = {
    ...registeredBackdrop,
    definition: { ...registeredBackdrop.definition, ...patch },
  };
}

function expectClosedBackdrop() {
  const stage = resolveDefaultStageInput();
  expect(stage.visualStatus).toBe("VISUAL_MASTER_REQUIRED");
  expect(stage.familyKey).toBeNull();
  expect(stage.master).toBeNull();
  expect(stage.responsiveSources).toEqual([]);
  expect(stage.productionAssetActive).toBe(false);
  expect(stage.decoration).toBe("none");
}

describe("registered default mining backdrop", () => {
  test("binds the light companion to its reviewed image family and exact dimensions", () => {
    const variant = registeredBackdrop.definition.master.lightVariant;
    replaceDefinition({
      master: {
        ...registeredBackdrop.definition.master,
        lightVariant: {
          ...variant,
          master: {
            ...variant.master,
            sha256: APPROVED_SCENE_MASTER_SHA256[0],
          },
        },
      },
    });
    expectClosedBackdrop();
    replaceDefinition({
      master: {
        ...registeredBackdrop.definition.master,
        lightVariant: {
          ...variant,
          master: { ...variant.master, width: 1535 },
        },
      },
    });
    expectClosedBackdrop();
  });

  test("projects only reviewed decorative fields from a light companion", () => {
    const variant = registeredBackdrop.definition.master.lightVariant;
    replaceDefinition({
      master: {
        ...registeredBackdrop.definition.master,
        lightVariant: {
          master: {
            ...variant.master,
            productCode: "unapproved",
            amount: "999999",
          },
          responsiveSources: variant.responsiveSources.map((source) => ({
            ...source,
            reward: "999999",
          })),
        },
      },
    });
    expect(resolveDefaultStageInput().visualStatus).toBe("MASTER_READY");
    expect(findEconomicFieldPaths(resolveDefaultStageInput())).toEqual([]);
  });
  test("uses the approved registry art with a neutral renderer identity", () => {
    const stage = resolveDefaultStageInput();

    expect(stage.visualStatus).toBe("MASTER_READY");
    expect(stage.productionAssetActive).toBe(true);
    expect(stage.familyKey).toBeNull();
    expect(stage.master).toEqual(registeredBackdrop.definition.master);
    expect(stage.master).not.toBe(registeredBackdrop.definition.master);
    expect(stage.master?.sha256).toBe(APPROVED_SCENE_MASTER_SHA256[0]);
    expect(stage.responsiveSources).toEqual(
      registeredBackdrop.definition.responsiveSources,
    );
    expect(stage.responsiveSources).not.toBe(
      registeredBackdrop.definition.responsiveSources,
    );
    expect(stage.anchor).toEqual(registeredBackdrop.definition.anchor);
    expect(stage.performance).toEqual(
      registeredBackdrop.definition.performance,
    );
    expect(stage.reducedMotion).toBe("static");
    expect(Object.keys(stage).sort()).toEqual(
      [...STAGE_SCENE_INPUT_KEYS].sort(),
    );
  });

  test("accepts no snapshot and never reads world or product hints", () => {
    const snapshot = new Proxy(
      {},
      {
        get() {
          throw new Error("SNAPSHOT_IDENTITY_READ");
        },
      },
    );
    expect(resolveDefaultStageInput.length).toBe(0);
    expect(
      Reflect.apply(resolveDefaultStageInput, undefined, [snapshot]),
    ).toEqual(resolveDefaultStageInput());
  });

  test("does not assign the default art to unrelated catalog products", () => {
    for (const identity of [
      { code: "005930", category: "KR_STOCK" },
      { code: "AAPL", category: "US_STOCK" },
      { code: "XAU", category: "GOLD" },
      { code: "BTC", category: "CRYPTO" },
    ] as const) {
      const product = resolveCatalogProduct(identity);
      expect(product.scene).toBeNull();
      expect(product.productionAssetActive).toBe(false);
      expect(product.presentation?.sceneFamilyKey).toBeNull();
    }
    expect(resolveDefaultStageInput().productionAssetActive).toBe(true);
  });

  test("projects no economic fields or selected product/session identities", () => {
    replaceDefinition({
      productCode: "000660",
      productId: "unapproved-selected-product",
      worldCode: "KOREA",
      amount: "5000",
      master: {
        ...registeredBackdrop.definition.master,
        balance: "5000",
      },
      performance: {
        ...registeredBackdrop.definition.performance,
        reward: "9999",
      },
    });
    const stage = resolveDefaultStageInput();
    expect(findEconomicFieldPaths(stage)).toEqual([]);
    const encoded = JSON.stringify(stage);
    expect(encoded).not.toMatch(
      /productCode|productId|worldCode|sessionId|unapproved-selected-product|amount|balance|reward/,
    );
  });

  test("closes an unapproved master hash instead of displaying borrowed art", () => {
    replaceDefinition({
      master: {
        ...registeredBackdrop.definition.master,
        sha256: "0".repeat(64),
      },
    });
    expectClosedBackdrop();
  });

  test("closes an external master path even when its hash is approved", () => {
    replaceDefinition({
      master: {
        ...registeredBackdrop.definition.master,
        assetPath: "https://example.com/borrowed-art.avif",
      },
    });
    expectClosedBackdrop();
  });

  test.each([
    { packStatus: "VISUAL_MASTER_REQUIRED" },
    { productionAssetActive: false },
    { master: null },
    { anchor: { x: Number.NaN, y: 0.5 } },
    { extractionTarget: { x: 0.5, y: 1.1 } },
    {
      performance: {
        maxParticles: 0,
        renderer: "none",
        webgl: true,
        timerAdvancesValue: false,
      },
    },
    {
      performance: {
        maxParticles: 0,
        renderer: "none",
        webgl: false,
        timerAdvancesValue: true,
      },
    },
  ])("closes an inactive or invalid registered definition: %j", (patch) => {
    replaceDefinition(patch);
    expectClosedBackdrop();
  });

  test.each([
    {
      media: "(max-width: 767px)",
      assetPath: "/unregistered.avif",
      width: 768,
      height: 510,
      mimeType: "image/avif",
    },
    {
      media: "url(https://example.com/borrowed-art)",
      assetPath: registeredBackdrop.definition.master?.assetPath,
      width: 768,
      height: 510,
      mimeType: "image/webp",
    },
    {
      media: "(max-width: 767px)",
      assetPath: registeredBackdrop.definition.master?.assetPath,
      width: Number.POSITIVE_INFINITY,
      height: 510,
      mimeType: "image/webp",
    },
    {
      media: "(max-width: 767px)",
      assetPath: registeredBackdrop.definition.master?.assetPath,
      width: 768,
      height: 0,
      mimeType: "image/webp",
    },
    {
      media: "(max-width: 767px)",
      assetPath: registeredBackdrop.definition.master?.assetPath,
      width: 768,
      height: 510,
      mimeType: "image/avif",
    },
  ])("closes invalid responsive source registration: %j", (source) => {
    replaceDefinition({ responsiveSources: [source] });
    expectClosedBackdrop();
  });
});
