import type {
  AccentToken,
  AmbientPreset,
  ApprovedSceneMaster,
  ParticleEmphasis,
  ResolvedScene,
  SceneFamilyKey,
  ScenePerformance,
  ScenePoint,
  SceneVisualStatus,
} from "@/lib/mining-scene/types";

/**
 * 공통 렌더러 입력.
 * 상품 코드와 패밀리별 컴포넌트 분기를 넣지 않는다.
 * 새 패밀리는 같은 키 집합으로 투영된다.
 */
export const STAGE_SCENE_INPUT_KEYS = [
  "familyKey",
  "version",
  "visualStatus",
  "anchor",
  "extractionTarget",
  "particle",
  "ambient",
  "reducedMotion",
  "performance",
  "userCopyKo",
  "a11yLabelKo",
  "accentToken",
  "particleEmphasis",
  "master",
  "productionAssetActive",
  "decoration",
] as const;

export type StageSceneInputKey = (typeof STAGE_SCENE_INPUT_KEYS)[number];

export type StageSceneInput = {
  readonly familyKey: SceneFamilyKey | null;
  readonly version: number | null;
  readonly visualStatus: SceneVisualStatus;
  readonly anchor: ScenePoint | null;
  readonly extractionTarget: ScenePoint | null;
  readonly particle: ParticleEmphasis | null;
  readonly ambient: AmbientPreset | null;
  readonly reducedMotion: "static";
  readonly performance: ScenePerformance | null;
  readonly userCopyKo: string;
  readonly a11yLabelKo: string;
  readonly accentToken: AccentToken | null;
  readonly particleEmphasis: ParticleEmphasis | null;
  readonly master: ApprovedSceneMaster | null;
  readonly productionAssetActive: boolean;
  readonly decoration: "none" | "canvas-2d";
};

type EconomicIdentityKey =
  "amount" | "balance" | "pending" | "productCode" | "verified" | "yield";

type StageLeak = Extract<EconomicIdentityKey, keyof StageSceneInput>;

/** 스테이지 입력에 상품 코드나 경제 필드가 생기면 컴파일이 깨진다. */
export const STAGE_INPUT_HAS_NO_ECONOMIC_IDENTITY: [StageLeak] extends [never]
  ? true
  : never = true;

export function projectStageInput(resolved: ResolvedScene): StageSceneInput {
  const scene = resolved.scene;
  const decoration =
    scene?.performance.renderer === "canvas-2d" ? "canvas-2d" : "none";
  return {
    familyKey: scene?.familyKey ?? null,
    version: scene?.version ?? null,
    visualStatus: resolved.visualStatus,
    anchor: scene?.anchor ?? null,
    extractionTarget: scene?.extractionTarget ?? null,
    particle: scene?.particle ?? null,
    ambient: scene?.ambient ?? null,
    reducedMotion: "static",
    performance: scene?.performance ?? null,
    userCopyKo: resolved.userCopyKo,
    a11yLabelKo: resolved.a11yLabelKo,
    accentToken: resolved.presentation?.profile.accentToken ?? null,
    particleEmphasis: resolved.presentation?.profile.particleEmphasis ?? null,
    master: scene?.master ?? null,
    productionAssetActive: resolved.productionAssetActive,
    decoration,
  };
}
