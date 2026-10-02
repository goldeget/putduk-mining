import type {
  AmbientPreset,
  ParticleEmphasis,
  PendingSceneDefinition,
  SceneDefinition,
  SceneFamilyKey,
  ScenePoint,
} from "@/lib/mining-scene/types";

/**
 * 패밀리별 Scene 정의.
 * MiningLiveStage 는 이 표를 스위치하지 않는다.
 * 승인 마스터가 없으므로 모든 행은 VISUAL_MASTER_REQUIRED 다.
 * pack 완료(APPROVED)로 선언하지 않는다.
 */

export type SceneEconomicPolicy = "NONE" | "DECISION_REQUIRED";

export type SceneRegistryRow<K extends SceneFamilyKey = SceneFamilyKey> = {
  readonly familyKey: K;
  readonly version: 1;
  readonly economicPolicy: K extends "ETF_BASKET" ? "DECISION_REQUIRED" : "NONE";
  readonly definition: SceneDefinition & { readonly familyKey: K };
};

export type SceneRegistry = {
  readonly [K in SceneFamilyKey]: SceneRegistryRow<K>;
};

function unitPoint(point: ScenePoint): ScenePoint {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.x > 1 ||
    point.y < 0 ||
    point.y > 1
  ) {
    throw new Error("SCENE_POINT_OUT_OF_RANGE");
  }
  return { x: point.x, y: point.y };
}

function pendingScene<K extends SceneFamilyKey>(
  familyKey: K,
  anchor: ScenePoint,
  extractionTarget: ScenePoint,
  particle: ParticleEmphasis,
  ambient: AmbientPreset,
): PendingSceneDefinition & { readonly familyKey: K } {
  return {
    familyKey,
    version: 1,
    packStatus: "VISUAL_MASTER_REQUIRED",
    master: null,
    responsiveSources: [],
    productionAssetActive: false,
    anchor: unitPoint(anchor),
    extractionTarget: unitPoint(extractionTarget),
    particle,
    ambient,
    reducedMotion: "static",
    performance: {
      maxParticles: 0,
      renderer: "none",
      webgl: false,
      timerAdvancesValue: false,
    },
  };
}

function row<K extends SceneFamilyKey>(
  familyKey: K,
  economicPolicy: K extends "ETF_BASKET" ? "DECISION_REQUIRED" : "NONE",
  anchor: ScenePoint,
  extractionTarget: ScenePoint,
  particle: ParticleEmphasis,
  ambient: AmbientPreset,
): SceneRegistryRow<K> {
  return {
    familyKey,
    version: 1,
    economicPolicy,
    definition: pendingScene(
      familyKey,
      anchor,
      extractionTarget,
      particle,
      ambient,
    ),
  };
}

export const SCENE_REGISTRY: SceneRegistry = {
  SEMICONDUCTOR_MEMORY: row(
    "SEMICONDUCTOR_MEMORY",
    "NONE",
    { x: 0.5, y: 0.46 },
    { x: 0.5, y: 0.62 },
    "steady",
    "cool",
  ),
  SEMICONDUCTOR_FOUNDRY: row(
    "SEMICONDUCTOR_FOUNDRY",
    "NONE",
    { x: 0.48, y: 0.5 },
    { x: 0.52, y: 0.7 },
    "none",
    "still",
  ),
  SEMICONDUCTOR_COMPUTE: row(
    "SEMICONDUCTOR_COMPUTE",
    "NONE",
    { x: 0.5, y: 0.42 },
    { x: 0.5, y: 0.66 },
    "sparse",
    "cool",
  ),
  AI_GPU_COMPUTE: row(
    "AI_GPU_COMPUTE",
    "NONE",
    { x: 0.62, y: 0.48 },
    { x: 0.58, y: 0.64 },
    "steady",
    "cool",
  ),
  PRECIOUS_GOLD: row(
    "PRECIOUS_GOLD",
    "NONE",
    { x: 0.5, y: 0.58 },
    { x: 0.5, y: 0.74 },
    "sparse",
    "warm",
  ),
  PRECIOUS_SILVER: row(
    "PRECIOUS_SILVER",
    "NONE",
    { x: 0.46, y: 0.56 },
    { x: 0.5, y: 0.72 },
    "sparse",
    "cool",
  ),
  BLOCKCHAIN_HASH: row(
    "BLOCKCHAIN_HASH",
    "NONE",
    { x: 0.4, y: 0.5 },
    { x: 0.44, y: 0.68 },
    "steady",
    "neutral",
  ),
  CRYPTO_NETWORK: row(
    "CRYPTO_NETWORK",
    "NONE",
    { x: 0.56, y: 0.44 },
    { x: 0.5, y: 0.66 },
    "sparse",
    "cool",
  ),
  AUTO_MOBILITY: row(
    "AUTO_MOBILITY",
    "NONE",
    { x: 0.5, y: 0.6 },
    { x: 0.5, y: 0.78 },
    "none",
    "still",
  ),
  ENERGY_OIL: row(
    "ENERGY_OIL",
    "NONE",
    { x: 0.48, y: 0.62 },
    { x: 0.5, y: 0.8 },
    "none",
    "still",
  ),
  FINANCE_CAPITAL: row(
    "FINANCE_CAPITAL",
    "NONE",
    { x: 0.5, y: 0.4 },
    { x: 0.5, y: 0.6 },
    "none",
    "still",
  ),
  BIO_HEALTH: row(
    "BIO_HEALTH",
    "NONE",
    { x: 0.52, y: 0.48 },
    { x: 0.5, y: 0.7 },
    "none",
    "still",
  ),
  CONSUMER_RETAIL: row(
    "CONSUMER_RETAIL",
    "NONE",
    { x: 0.5, y: 0.52 },
    { x: 0.5, y: 0.7 },
    "none",
    "warm",
  ),
  ETF_BASKET: row(
    "ETF_BASKET",
    "DECISION_REQUIRED",
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    "none",
    "still",
  ),
};

export function getSceneRow<K extends SceneFamilyKey>(
  familyKey: K,
): SceneRegistryRow<K> {
  return SCENE_REGISTRY[familyKey];
}
