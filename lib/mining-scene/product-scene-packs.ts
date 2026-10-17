import {
  PRODUCT_PROCESS_PACKS,
  type ProductProcessVariant,
} from "./product-scene-assets";
import type {
  ApprovedSceneDefinition,
  ProductCategory,
  SceneFamilyKey,
} from "./types";
type Pack = (typeof PRODUCT_PROCESS_PACKS)[keyof typeof PRODUCT_PROCESS_PACKS];
function definition(pack: Pack): ApprovedSceneDefinition {
  return {
    familyKey: pack.familyKey,
    version: 1,
    packStatus: "APPROVED",
    master: pack.master,
    responsiveSources: pack.responsiveSources,
    productionAssetActive: true,
    anchor: pack.anchor,
    extractionTarget: pack.extractionTarget,
    particle: "steady",
    ambient: "neutral",
    reducedMotion: "static",
    performance: {
      maxParticles: 8,
      maxFps: 30,
      maxDpr: 1.5,
      renderer: "canvas-2d",
      webgl: false,
      timerAdvancesValue: false,
    },
    process: pack.process,
  };
}
/** Local visual-use delegation only. A registered visual pack is not a live mining-session binding. */
type ProductProcessRow = {
  readonly productCodes: readonly string[];
  readonly category: ProductCategory;
  readonly familyKey: SceneFamilyKey;
  readonly familyVersion: 1;
  readonly definition: ApprovedSceneDefinition;
};
function row(pack: Pack): ProductProcessRow {
  return {
    productCodes: [pack.code],
    category: pack.category,
    familyKey: pack.familyKey,
    familyVersion: 1,
    definition: definition(pack),
  };
}
export const PRODUCT_PROCESS_VARIANT_ROWS = {
  [PRODUCT_PROCESS_PACKS["005930"].variant]: row(
    PRODUCT_PROCESS_PACKS["005930"],
  ),
  [PRODUCT_PROCESS_PACKS["AAPL"].variant]: row(PRODUCT_PROCESS_PACKS["AAPL"]),
  [PRODUCT_PROCESS_PACKS["MSFT"].variant]: row(PRODUCT_PROCESS_PACKS["MSFT"]),
  [PRODUCT_PROCESS_PACKS["XAU"].variant]: row(PRODUCT_PROCESS_PACKS["XAU"]),
  [PRODUCT_PROCESS_PACKS["XAG"].variant]: row(PRODUCT_PROCESS_PACKS["XAG"]),
  [PRODUCT_PROCESS_PACKS["BTC"].variant]: row(PRODUCT_PROCESS_PACKS["BTC"]),
  [PRODUCT_PROCESS_PACKS["ETH"].variant]: row(PRODUCT_PROCESS_PACKS["ETH"]),
  [PRODUCT_PROCESS_PACKS["BNB"].variant]: row(PRODUCT_PROCESS_PACKS["BNB"]),
  [PRODUCT_PROCESS_PACKS["XRP"].variant]: row(PRODUCT_PROCESS_PACKS["XRP"]),
} satisfies Record<ProductProcessVariant, ProductProcessRow>;
