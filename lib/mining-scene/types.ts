/**
 * Scene 플랫폼 타입.
 * 상품 정본은 mining_products 다. 여기 타입은 presentation 전용이다.
 * 금액, 수익률, 잔액, 정산 값은 이 모듈에 두지 않는다.
 */

export const SCENE_FAMILY_KEYS = [
  "SEMICONDUCTOR_MEMORY",
  "SEMICONDUCTOR_FOUNDRY",
  "SEMICONDUCTOR_COMPUTE",
  "AI_GPU_COMPUTE",
  "PRECIOUS_GOLD",
  "PRECIOUS_SILVER",
  "BLOCKCHAIN_HASH",
  "CRYPTO_NETWORK",
  "AUTO_MOBILITY",
  "ENERGY_OIL",
  "FINANCE_CAPITAL",
  "BIO_HEALTH",
  "CONSUMER_RETAIL",
  "ETF_BASKET",
] as const;

export type SceneFamilyKey = (typeof SCENE_FAMILY_KEYS)[number];

const SCENE_FAMILY_KEY_SET: ReadonlySet<string> = new Set(SCENE_FAMILY_KEYS);

export function isSceneFamilyKey(value: string): value is SceneFamilyKey {
  return SCENE_FAMILY_KEY_SET.has(value);
}

/** mining_products.category 와 같은 닫힌 집합. ETF 는 넣지 않는다. */
export const PRODUCT_CATEGORIES = [
  "KR_STOCK",
  "US_STOCK",
  "GOLD",
  "SILVER",
  "CRYPTO",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** 호출부가 넘기는 상품 정체성. 이름이나 회사명으로 장면을 고르지 않는다. */
export type MiningProductIdentity = {
  readonly code: string;
  readonly category: ProductCategory;
};

export const ACCENT_TOKENS = [
  "--world-korea",
  "--world-usa",
  "--world-gold",
  "--world-silver",
  "--world-crypto",
  "--brand-primary",
] as const;

export type AccentToken = (typeof ACCENT_TOKENS)[number];

export const DECORATIVE_OBJECTS = ["spark", "halo", "ring"] as const;

export type DecorativeObject = (typeof DECORATIVE_OBJECTS)[number];

export type ParticleEmphasis = "none" | "sparse" | "steady";

export type AmbientPreset = "still" | "warm" | "cool" | "neutral";

/** 화면 구도의 0..1 비율. 가격이나 금액이 아니다. */
export type ScenePoint = {
  readonly x: number;
  readonly y: number;
};

export type ScenePerformance = {
  readonly maxParticles: number;
  readonly renderer: "none" | "canvas-2d";
  readonly webgl: false;
  readonly timerAdvancesValue: false;
};

/**
 * 승인된 마스터 해시 허용 목록.
 * 비어 있으면 APPROVED 팩을 만들 수 없다.
 * SK하이닉스 V3 참조 해시는 여기에 넣지 않는다.
 */
export const APPROVED_SCENE_MASTER_SHA256 = [] as const;

export type ApprovedSceneMasterSha256 =
  (typeof APPROVED_SCENE_MASTER_SHA256)[number];

/** 퍼블릭 상대 경로 허용 목록. 외부 URL 은 받지 않는다. */
export const APPROVED_SCENE_ASSET_PATHS = [] as const;

export type ApprovedSceneAssetPath =
  (typeof APPROVED_SCENE_ASSET_PATHS)[number];

export const APPROVED_MASTER_VARIANTS = [] as const;

export type ApprovedMasterVariant = (typeof APPROVED_MASTER_VARIANTS)[number];

export type ApprovedSceneMaster = {
  readonly sha256: ApprovedSceneMasterSha256;
  readonly assetPath: ApprovedSceneAssetPath;
  readonly width: number;
  readonly height: number;
  readonly altKo: string;
};

export type ApprovedResponsiveSource = {
  readonly media: string;
  readonly assetPath: ApprovedSceneAssetPath;
  readonly width: number;
};

type SceneDefinitionBase = {
  readonly version: 1;
  readonly anchor: ScenePoint;
  readonly extractionTarget: ScenePoint;
  readonly particle: ParticleEmphasis;
  readonly ambient: AmbientPreset;
  readonly reducedMotion: "static";
  readonly performance: ScenePerformance;
};

export type PendingSceneDefinition = SceneDefinitionBase & {
  readonly familyKey: SceneFamilyKey;
  readonly packStatus: "VISUAL_MASTER_REQUIRED";
  readonly master: null;
  readonly responsiveSources: readonly [];
  readonly productionAssetActive: false;
};

export type ApprovedSceneDefinition = SceneDefinitionBase & {
  readonly familyKey: SceneFamilyKey;
  readonly packStatus: "APPROVED";
  readonly master: ApprovedSceneMaster;
  readonly responsiveSources: readonly ApprovedResponsiveSource[];
  readonly productionAssetActive: true;
};

export type SceneDefinition = PendingSceneDefinition | ApprovedSceneDefinition;

export type ProductSceneProfile = {
  readonly displayNameKo: string;
  readonly accentToken: AccentToken;
  readonly particleEmphasis: ParticleEmphasis;
  readonly decorativeObjects: readonly DecorativeObject[];
  readonly ambientPreset: AmbientPreset;
  readonly htmlCopyKo: string;
  readonly a11yLabelKo: string;
  readonly masterVariant: ApprovedMasterVariant | null;
};

export type ProductPresentation = {
  readonly productCode: string;
  readonly sceneFamilyKey: SceneFamilyKey | null;
  readonly sceneFamilyVersion: 1 | null;
  readonly profile: ProductSceneProfile;
};

export type SceneBindingInput = {
  readonly productCode: string;
  readonly sceneFamilyKey: string;
  readonly sceneFamilyVersion: number;
  readonly profile: ProductSceneProfile;
};

export type SceneVisualStatus =
  | "MASTER_READY"
  | "VISUAL_MASTER_REQUIRED"
  | "FAMILY_UNASSIGNED"
  | "UNSUPPORTED_FAMILY"
  | "PRESENTATION_MISSING"
  | "PRESENTATION_MISMATCH";

export type ResolvedScene = {
  readonly identity: MiningProductIdentity;
  readonly presentation: ProductPresentation | null;
  readonly scene: SceneDefinition | null;
  readonly visualStatus: SceneVisualStatus;
  readonly productionAssetActive: boolean;
  readonly userCopyKo: string;
  readonly a11yLabelKo: string;
};

export function isApprovedMasterSha256(
  value: string,
): value is ApprovedSceneMasterSha256 {
  return (APPROVED_SCENE_MASTER_SHA256 as readonly string[]).includes(value);
}

/** 허용 목록 밖의 해시는 프로덕션 마스터가 되지 않는다. */
export function tryActivateProductionMaster(sha256: string): null {
  return isApprovedMasterSha256(sha256) ? null : null;
}
