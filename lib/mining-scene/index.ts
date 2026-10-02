export {
  APPROVED_PRODUCT_PRESENTATIONS,
  CATALOG_V1_PRODUCTS,
  presentationForCode,
} from "@/lib/mining-scene/product-presentation";
export type {
  CatalogProductCode,
  CatalogProductPresentation,
} from "@/lib/mining-scene/product-presentation";

export {
  DISPLAY_PROFILE_SCENE_REJECTION,
  readSceneFromDisplayProfile,
} from "@/lib/mining-scene/display-profile-boundary";
export { findEconomicFieldPaths } from "@/lib/mining-scene/economic-field-guard";
export { resolveCatalogProduct, resolveScene } from "@/lib/mining-scene/resolve-scene";
export { getSceneRow, SCENE_REGISTRY } from "@/lib/mining-scene/scene-registry";
export type {
  SceneEconomicPolicy,
  SceneRegistry,
  SceneRegistryRow,
} from "@/lib/mining-scene/scene-registry";
export { SAFE_SCENE_COPY } from "@/lib/mining-scene/safe-scene-copy";
export { SK_HYNIX_V3_REFERENCE } from "@/lib/mining-scene/sk-hynix-v3-reference";
export {
  projectStageInput,
  STAGE_INPUT_HAS_NO_ECONOMIC_IDENTITY,
  STAGE_SCENE_INPUT_KEYS,
} from "@/lib/mining-scene/stage-input";
export type { StageSceneInput, StageSceneInputKey } from "@/lib/mining-scene/stage-input";
export {
  ACCENT_TOKENS,
  APPROVED_MASTER_VARIANTS,
  APPROVED_SCENE_ASSET_PATHS,
  APPROVED_SCENE_MASTER_SHA256,
  DECORATIVE_OBJECTS,
  isApprovedMasterSha256,
  isSceneFamilyKey,
  PRODUCT_CATEGORIES,
  SCENE_FAMILY_KEYS,
  tryActivateProductionMaster,
} from "@/lib/mining-scene/types";
export type {
  AccentToken,
  AmbientPreset,
  ApprovedMasterVariant,
  ApprovedSceneAssetPath,
  ApprovedSceneDefinition,
  ApprovedSceneMaster,
  ApprovedSceneMasterSha256,
  DecorativeObject,
  MiningProductIdentity,
  ParticleEmphasis,
  PendingSceneDefinition,
  ProductCategory,
  ProductPresentation,
  ProductSceneProfile,
  ResolvedScene,
  SceneBindingInput,
  SceneDefinition,
  SceneFamilyKey,
  ScenePerformance,
  ScenePoint,
  SceneVisualStatus,
} from "@/lib/mining-scene/types";
