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
 * 생산 배정은 000660 하나다. V3 시각 원본이 그 상품의 메모리 장면이기 때문이다.
 * 다른 코드의 sceneFamilyKey 는 null 이고, 비슷한 family 로 채우지 않는다.
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

function profile(displayNameKo: string): ProductSceneProfile {
  return {
    displayNameKo,
    accentToken: "--brand-primary",
    particleEmphasis: "none",
    decorativeObjects: [],
    ambientPreset: "still",
    htmlCopyKo: SAFE_SCENE_COPY,
    a11yLabelKo: SAFE_SCENE_COPY,
    masterVariant: null,
  };
}

function unassigned<K extends CatalogProductCode>(
  productCode: K,
  displayNameKo: string,
): CatalogProductPresentation & {
  readonly productCode: K;
  readonly sceneFamilyKey: null;
  readonly sceneFamilyVersion: null;
} {
  return {
    productCode,
    sceneFamilyKey: null,
    sceneFamilyVersion: null,
    profile: profile(displayNameKo),
  };
}

export const APPROVED_PRODUCT_PRESENTATIONS = {
  "005930": unassigned("005930", "삼성전자 테마"),
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
      masterVariant: null,
    },
  },
  AAPL: unassigned("AAPL", "애플 테마"),
  MSFT: unassigned("MSFT", "마이크로소프트 테마"),
  NVDA: unassigned("NVDA", "엔비디아 테마"),
  XAU: unassigned("XAU", "골드 테마"),
  XAG: unassigned("XAG", "실버 테마"),
  BTC: unassigned("BTC", "비트코인 테마"),
  ETH: unassigned("ETH", "이더리움 테마"),
  BNB: unassigned("BNB", "BNB 테마"),
  XRP: unassigned("XRP", "XRP 테마"),
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
