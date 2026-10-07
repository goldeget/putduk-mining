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
  readonly maxFps?: number;
  readonly maxDpr?: number;
  readonly renderer: "none" | "canvas-2d";
  readonly webgl: false;
  readonly timerAdvancesValue: false;
};

/**
 * 승인된 마스터 해시 허용 목록.
 * 비어 있으면 APPROVED 팩을 만들 수 없다.
 * SK하이닉스 V3 참조 해시는 여기에 넣지 않는다.
 */
export const APPROVED_SCENE_MASTER_SHA256 = [
  "5d398a3155635d46a6d0b1f639c25d349ddf21607a16a4e6f948655744b8a6dd",
  "113fdbc5c41772145f98f3357f27754fa1bd20602a5261c133becc0fa1126d52",
  "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
  "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
  "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
  "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
] as const;

export type ApprovedSceneMasterSha256 =
  (typeof APPROVED_SCENE_MASTER_SHA256)[number];

/** 퍼블릭 상대 경로 허용 목록. 외부 URL 은 받지 않는다. */
export const APPROVED_SCENE_ASSET_PATHS = [
  "/brand/scenes/semiconductor-memory/semiconductor-memory-640-v1.avif",
  "/brand/scenes/semiconductor-memory/semiconductor-memory-640-v1.webp",
  "/brand/scenes/semiconductor-memory/semiconductor-memory-960-v1.avif",
  "/brand/scenes/semiconductor-memory/semiconductor-memory-960-v1.webp",
  "/brand/scenes/semiconductor-memory/semiconductor-memory-1280-v1.avif",
  "/brand/scenes/semiconductor-memory/semiconductor-memory-1280-v1.webp",
  "/brand/scenes/semiconductor-memory/semiconductor-memory-1539-v1.avif",
  "/brand/scenes/semiconductor-memory/semiconductor-memory-1539-v1.webp",
  "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-640-v1.avif",
  "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-640-v1.webp",
  "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-960-v1.avif",
  "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-960-v1.webp",
  "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1280-v1.avif",
  "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1280-v1.webp",
  "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1536-v1.avif",
  "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-1536-v1.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-480.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-480.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-640.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-640.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-960.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-960.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-1024.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-1024.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-640.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-640.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-960.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-960.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1280.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1280.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1672.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-1672.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-480.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-480.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-640.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-640.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-960.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-960.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-1024.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-1024.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-640.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-640.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-960.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-960.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1280.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1280.webp",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1672.avif",
  "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-1672.webp",
] as const;

export type ApprovedSceneAssetPath =
  (typeof APPROVED_SCENE_ASSET_PATHS)[number];

export const APPROVED_MASTER_VARIANTS = [
  "semiconductor-memory-v1",
  "product-nvda-gpu-v1",
] as const;

export type ApprovedMasterVariant = (typeof APPROVED_MASTER_VARIANTS)[number];

export type ApprovedSceneMasterImage = {
  readonly sha256: ApprovedSceneMasterSha256;
  readonly assetPath: ApprovedSceneAssetPath;
  readonly width: number;
  readonly height: number;
  readonly altKo: string;
};

export type ApprovedSceneMaster = ApprovedSceneMasterImage & {
  /** Presentation-only companion; neither a product binding nor runtime state. */
  readonly lightVariant?: {
    readonly master: ApprovedSceneMasterImage;
    readonly responsiveSources: readonly ApprovedResponsiveSource[];
  };
};

export type ApprovedResponsiveSource = {
  readonly media: string;
  readonly assetPath: ApprovedSceneAssetPath;
  readonly width: number;
  readonly height: number;
  readonly mimeType: "image/avif" | "image/webp";
  /** Exact reviewed source geometry; this never advances runtime value. */
  readonly composition?: {
    readonly masterSha256: ApprovedSceneMasterSha256;
    readonly anchor: ScenePoint;
    readonly extractionTarget: ScenePoint;
  };
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
  | "MASTER_VARIANT_UNAVAILABLE"
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

export function isApprovedMasterVariant(
  value: unknown,
): value is ApprovedMasterVariant {
  return (
    typeof value === "string" &&
    (APPROVED_MASTER_VARIANTS as readonly string[]).includes(value)
  );
}

export const APPROVED_GPU_COMPOSITION_BINDINGS = [
  {
    sha256: "0cf2635fdd6637757c5a56d90c27cb2b9e7b6c925a66da332f36e268f4fd300d",
    prefix:
      "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-portrait-",
    width: 1024,
    height: 1536,
    anchor: {
      x: 0.5,
      y: 0.5,
    },
    extractionTarget: {
      x: 0.5,
      y: 0.75,
    },
  },
  {
    sha256: "b20cc60947fdddf7d8f02733658d9f0fabdce786ea5f9614ce1694e44d1fe3f1",
    prefix:
      "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-dark-landscape-",
    width: 1672,
    height: 941,
    anchor: {
      x: 0.73,
      y: 0.5,
    },
    extractionTarget: {
      x: 0.73,
      y: 0.78,
    },
  },
  {
    sha256: "56638dce5ebe61b38c21da4249e3474e5a62a7d17f32cb885d945c8ee41a1115",
    prefix:
      "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-portrait-",
    width: 1024,
    height: 1536,
    anchor: {
      x: 0.5,
      y: 0.5,
    },
    extractionTarget: {
      x: 0.5,
      y: 0.75,
    },
  },
  {
    sha256: "abfc46f87a1822c5e705b527432da85d638bd500379f7a6fccf282e66392c736",
    prefix:
      "/brand/scenes/product-nvda-gpu-v1/product-nvda-gpu-v1-light-landscape-",
    width: 1672,
    height: 941,
    anchor: {
      x: 0.73,
      y: 0.5,
    },
    extractionTarget: {
      x: 0.73,
      y: 0.78,
    },
  },
] as const;

/** Bind each reviewed hash to its own exact responsive paths and dimensions. */
export function isApprovedSceneMasterImage(
  master: ApprovedSceneMasterImage,
): boolean {
  if (
    !isApprovedMasterSha256(master.sha256) ||
    !(APPROVED_SCENE_ASSET_PATHS as readonly string[]).includes(
      master.assetPath,
    )
  )
    return false;
  const gpu = APPROVED_GPU_COMPOSITION_BINDINGS.find(
    (binding) => binding.sha256 === master.sha256,
  );
  if (gpu) {
    if (!master.assetPath.startsWith(gpu.prefix)) return false;
    const width = Number(
      master.assetPath.slice(gpu.prefix.length).split(".")[0],
    );
    return (
      Number.isSafeInteger(width) &&
      master.width === width &&
      master.height === Math.round((width * gpu.height) / gpu.width)
    );
  }
  const light = master.sha256 === APPROVED_SCENE_MASTER_SHA256[1];
  const prefix = light
    ? "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-"
    : "/brand/scenes/semiconductor-memory/semiconductor-memory-";
  if (!master.assetPath.startsWith(prefix)) return false;
  const width = Number(master.assetPath.slice(prefix.length).split("-v1.")[0]);
  return (
    Number.isSafeInteger(width) &&
    master.width === width &&
    master.height === Math.round(width * (light ? 1024 / 1536 : 1022 / 1539))
  );
}

/** 허용 목록 밖의 해시는 프로덕션 마스터가 되지 않는다. */
export function tryActivateProductionMaster(sha256: string): null {
  return isApprovedMasterSha256(sha256) ? null : null;
}

/** A responsive GPU image must carry only its own hash-locked source geometry. */
export function isApprovedResponsiveComposition(
  source: ApprovedResponsiveSource,
): boolean {
  const binding = APPROVED_GPU_COMPOSITION_BINDINGS.find((candidate) =>
    source.assetPath.startsWith(candidate.prefix),
  );
  if (!binding) return source.composition === undefined;
  const composition = source.composition;
  return (
    composition !== undefined &&
    composition.masterSha256 === binding.sha256 &&
    composition.anchor.x === binding.anchor.x &&
    composition.anchor.y === binding.anchor.y &&
    composition.extractionTarget.x === binding.extractionTarget.x &&
    composition.extractionTarget.y === binding.extractionTarget.y &&
    isApprovedSceneMasterImage({
      sha256: binding.sha256,
      assetPath: source.assetPath,
      width: source.width,
      height: source.height,
      altKo: "GPU 장면",
    })
  );
}
