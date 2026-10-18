import { PRODUCT_PROCESS_PACKS } from "./product-scene-assets";
import { SAFE_SCENE_COPY } from "@/lib/mining-scene/safe-scene-copy";
import type {
  ProductCategory,
  ProductSceneProfile,
  SceneFamilyKey,
} from "@/lib/mining-scene/types";

/**
 * 카탈로그 v1 상품 코드.
 * 정본 신원은 mining_products 행이다.
 * 앞자리 0 은 문자열로 유지한다.
 *
 * display_profile 은 difficulty/risk 표시값뿐이라 scene family 를 주지 않는다.
 * 기존 000660/NVDA 독립 검토 마스터와 후속 사용자 위임 9종의 개별 원본을 사용한다.
 * 시각 팩 등록은 상품 실행 승인과 무관하며 알 수 없는 코드는 추정 배정하지 않는다.
 */
export const CATALOG_V1_PRODUCTS = [
  { code: "005930", category: "KR_STOCK" },
  { code: "000660", category: "KR_STOCK" },
  { code: "AAPL", category: "US_STOCK" },
  { code: "MSFT", category: "US_STOCK" },
  { code: "NVDA", category: "US_STOCK" },
  { code: "XAU", category: "GOLD" },
  { code: "XAG", category: "SILVER" },
  { code: "BTC", category: "CRYPTO" },
  { code: "ETH", category: "CRYPTO" },
  { code: "BNB", category: "CRYPTO" },
  { code: "XRP", category: "CRYPTO" },
] as const satisfies readonly {
  readonly code: string;
  readonly category: ProductCategory;
}[];

export type CatalogProductCode = (typeof CATALOG_V1_PRODUCTS)[number]["code"];

export type CatalogProductPresentation = {
  readonly productCode: CatalogProductCode;
  readonly sceneFamilyKey: SceneFamilyKey | null;
  readonly sceneFamilyVersion: 1 | null;
  readonly profile: ProductSceneProfile;
};

function processPresentation<K extends keyof typeof PRODUCT_PROCESS_PACKS>(
  code: K,
): CatalogProductPresentation & { readonly productCode: K } {
  const pack = PRODUCT_PROCESS_PACKS[code];
  return {
    productCode: code,
    sceneFamilyKey: pack.familyKey,
    sceneFamilyVersion: 1,
    profile: {
      displayNameKo: pack.displayNameKo,
      accentToken:
        pack.category === "KR_STOCK"
          ? "--world-korea"
          : pack.category === "US_STOCK"
            ? "--world-usa"
            : pack.category === "GOLD"
              ? "--world-gold"
              : pack.category === "SILVER"
                ? "--world-silver"
                : "--world-crypto",
      particleEmphasis: "steady",
      decorativeObjects: [],
      ambientPreset: "neutral",
      htmlCopyKo: SAFE_SCENE_COPY,
      a11yLabelKo: SAFE_SCENE_COPY,
      masterVariant: pack.variant,
    },
  };
}

export const APPROVED_PRODUCT_PRESENTATIONS = {
  "005930": processPresentation("005930"),
  "000660": {
    productCode: "000660",
    sceneFamilyKey: "SEMICONDUCTOR_MEMORY",
    sceneFamilyVersion: 1,
    profile: {
      displayNameKo: "SK하이닉스 테마",
      accentToken: "--world-korea",
      particleEmphasis: "steady",
      decorativeObjects: ["halo"],
      ambientPreset: "cool",
      htmlCopyKo: SAFE_SCENE_COPY,
      a11yLabelKo: SAFE_SCENE_COPY,
      masterVariant: "semiconductor-memory-v1",
    },
  },
  AAPL: processPresentation("AAPL"),
  MSFT: processPresentation("MSFT"),
  NVDA: {
    productCode: "NVDA",
    sceneFamilyKey: "AI_GPU_COMPUTE",
    sceneFamilyVersion: 1,
    profile: {
      displayNameKo: "엔비디아 테마",
      accentToken: "--world-usa",
      particleEmphasis: "steady",
      decorativeObjects: ["halo"],
      ambientPreset: "cool",
      htmlCopyKo: SAFE_SCENE_COPY,
      a11yLabelKo: SAFE_SCENE_COPY,
      masterVariant: "product-nvda-gpu-v1",
    },
  },
  XAU: processPresentation("XAU"),
  XAG: processPresentation("XAG"),
  BTC: processPresentation("BTC"),
  ETH: processPresentation("ETH"),
  BNB: processPresentation("BNB"),
  XRP: processPresentation("XRP"),
} as const satisfies {
  readonly [K in CatalogProductCode]: CatalogProductPresentation & {
    readonly productCode: K;
  };
};

export function presentationForCode(
  code: string,
): CatalogProductPresentation | null {
  if (
    !Object.prototype.hasOwnProperty.call(APPROVED_PRODUCT_PRESENTATIONS, code)
  ) {
    return null;
  }
  return APPROVED_PRODUCT_PRESENTATIONS[code as CatalogProductCode];
}
