import type {
  AccentToken,
  AmbientPreset,
  ApprovedResponsiveSource,
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
  "responsiveSources",
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
  readonly responsiveSources: readonly ApprovedResponsiveSource[];
  readonly productionAssetActive: boolean;
  readonly decoration: "none" | "canvas-2d";
};

type EconomicIdentityKey =
  | "amount"
  | "balance"
  | "capacity"
  | "earned"
  | "eligiblePrincipal"
  | "fundingTier"
  | "pending"
  | "productCode"
  | "productId"
  | "productName"
  | "rate"
  | "reward"
  | "sessionId"
  | "speed"
  | "used"
  | "verified"
  | "worldCode"
  | "worldName"
  | "yield";

type StageLeak = Extract<EconomicIdentityKey, keyof StageSceneInput>;

/** 스테이지 입력에 상품 코드나 경제 필드가 생기면 컴파일이 깨진다. */
export const STAGE_INPUT_HAS_NO_ECONOMIC_IDENTITY: [StageLeak] extends [never]
  ? true
  : never = true;

export function projectStageInput(resolved: ResolvedScene): StageSceneInput {
  const scene = resolved.scene;
  const performance = scene?.performance;
  const master = scene?.master;
  const decoration =
    scene?.performance.renderer === "canvas-2d" ? "canvas-2d" : "none";
  return {
    familyKey: scene?.familyKey ?? null,
    version: scene?.version ?? null,
    visualStatus: resolved.visualStatus,
    anchor: scene ? { x: scene.anchor.x, y: scene.anchor.y } : null,
    extractionTarget: scene
      ? { x: scene.extractionTarget.x, y: scene.extractionTarget.y }
      : null,
    particle: scene?.particle ?? null,
    ambient: scene?.ambient ?? null,
    reducedMotion: "static",
    performance: performance
      ? {
          maxParticles: performance.maxParticles,
          renderer: performance.renderer,
          webgl: performance.webgl,
          timerAdvancesValue: performance.timerAdvancesValue,
          ...(performance.maxFps !== undefined
            ? { maxFps: performance.maxFps }
            : {}),
          ...(performance.maxDpr !== undefined
            ? { maxDpr: performance.maxDpr }
            : {}),
        }
      : null,
    userCopyKo: resolved.userCopyKo,
    a11yLabelKo: resolved.a11yLabelKo,
    accentToken: resolved.presentation?.profile.accentToken ?? null,
    particleEmphasis: resolved.presentation?.profile.particleEmphasis ?? null,
    master: master
      ? {
          sha256: master.sha256,
          assetPath: master.assetPath,
          width: master.width,
          height: master.height,
          altKo: master.altKo,
        }
      : null,
    responsiveSources:
      scene?.responsiveSources.map((source) => ({
        media: source.media,
        assetPath: source.assetPath,
        width: source.width,
        height: source.height,
        mimeType: source.mimeType,
      })) ?? [],
    productionAssetActive: resolved.productionAssetActive,
    decoration,
  };
}
