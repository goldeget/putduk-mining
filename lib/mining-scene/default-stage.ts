import { DEFAULT_STAGE_BACKDROP } from "@/lib/mining-scene/scene-registry";
import type { StageSceneInput } from "@/lib/mining-scene/stage-input";
import {
  APPROVED_SCENE_ASSET_PATHS,
  isApprovedMasterSha256,
  isApprovedSceneMasterImage,
  type ApprovedResponsiveSource,
  type ApprovedSceneMaster,
  type ScenePoint,
} from "@/lib/mining-scene/types";

const ASSET_PATH_SET: ReadonlySet<string> = new Set(APPROVED_SCENE_ASSET_PATHS);
const RESPONSIVE_MEDIA = /^\((?:min|max)-width: [1-9][0-9]{1,4}px\)$/;

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 8192;
}

function validPoint(point: ScenePoint): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

function approvedMaster(master: ApprovedSceneMaster | null): boolean {
  return (
    master !== null &&
    isApprovedMasterSha256(master.sha256) &&
    isApprovedSceneMasterImage(master) &&
    ASSET_PATH_SET.has(master.assetPath) &&
    validDimension(master.width) &&
    validDimension(master.height)
  );
}

function approvedResponsiveSource(source: ApprovedResponsiveSource): boolean {
  return (
    (source.media === "" || RESPONSIVE_MEDIA.test(source.media)) &&
    ASSET_PATH_SET.has(source.assetPath) &&
    validDimension(source.width) &&
    validDimension(source.height) &&
    ((source.mimeType === "image/avif" && source.assetPath.endsWith(".avif")) ||
      (source.mimeType === "image/webp" && source.assetPath.endsWith(".webp")))
  );
}

function closedBackdrop(): StageSceneInput {
  return {
    familyKey: null,
    version: null,
    visualStatus: "VISUAL_MASTER_REQUIRED",
    anchor: null,
    extractionTarget: null,
    particle: null,
    ambient: null,
    reducedMotion: "static",
    performance: null,
    userCopyKo: "채굴 현황",
    a11yLabelKo: "현재 채굴 현황",
    accentToken: null,
    particleEmphasis: null,
    master: null,
    responsiveSources: [],
    productionAssetActive: false,
    decoration: "none",
  };
}

/**
 * 2026-10-03에 위임된 기본 배경의 시각 채택만 반영한다.
 * 이 위임을 경제 정책이나 상품 선택의 승인으로 사용하지 않는다.
 * 인자를 받지 않으므로 session/world/product 이름에서 상품을 추정하지 않는다.
 * 상품별 장면은 기존 resolver의 명시 binding을 계속 사용한다.
 */
export function resolveDefaultStageInput(): StageSceneInput {
  const backdrop = DEFAULT_STAGE_BACKDROP;
  const scene = backdrop.definition;
  if (
    scene.packStatus !== "APPROVED" ||
    scene.productionAssetActive !== true ||
    !approvedMaster(scene.master) ||
    (scene.master.lightVariant !== undefined &&
      (!approvedMaster(scene.master.lightVariant.master) ||
        !scene.master.lightVariant.responsiveSources.every(
          (source) =>
            approvedResponsiveSource(source) &&
            isApprovedSceneMasterImage({
              ...scene.master.lightVariant.master,
              assetPath: source.assetPath,
              width: source.width,
              height: source.height,
            }),
        ))) ||
    !scene.responsiveSources.every(approvedResponsiveSource) ||
    !validPoint(scene.anchor) ||
    !validPoint(scene.extractionTarget) ||
    scene.performance.webgl !== false ||
    scene.performance.timerAdvancesValue !== false
  ) {
    return closedBackdrop();
  }

  // Registered visual fields only: no product/family identity or domain snapshot.
  return {
    familyKey: null,
    version: scene.version,
    visualStatus: "MASTER_READY",
    anchor: { x: scene.anchor.x, y: scene.anchor.y },
    extractionTarget: {
      x: scene.extractionTarget.x,
      y: scene.extractionTarget.y,
    },
    particle: scene.particle,
    ambient: scene.ambient,
    reducedMotion: "static",
    performance: {
      maxParticles: scene.performance.maxParticles,
      renderer: scene.performance.renderer,
      webgl: false,
      timerAdvancesValue: false,
      ...(scene.performance.maxFps !== undefined
        ? { maxFps: scene.performance.maxFps }
        : {}),
      ...(scene.performance.maxDpr !== undefined
        ? { maxDpr: scene.performance.maxDpr }
        : {}),
    },
    userCopyKo: backdrop.userCopyKo,
    a11yLabelKo: backdrop.a11yLabelKo,
    accentToken: backdrop.accentToken,
    particleEmphasis: scene.particle,
    master: scene.master
      ? {
          sha256: scene.master.sha256,
          assetPath: scene.master.assetPath,
          width: scene.master.width,
          height: scene.master.height,
          altKo: scene.master.altKo,
          ...(scene.master.lightVariant
            ? {
                lightVariant: {
                  master: {
                    sha256: scene.master.lightVariant.master.sha256,
                    assetPath: scene.master.lightVariant.master.assetPath,
                    width: scene.master.lightVariant.master.width,
                    height: scene.master.lightVariant.master.height,
                    altKo: scene.master.lightVariant.master.altKo,
                  },
                  responsiveSources:
                    scene.master.lightVariant.responsiveSources.map(
                      (source) => ({
                        media: source.media,
                        assetPath: source.assetPath,
                        width: source.width,
                        height: source.height,
                        mimeType: source.mimeType,
                      }),
                    ),
                },
              }
            : {}),
        }
      : null,
    responsiveSources: scene.responsiveSources.map((source) => ({
      media: source.media,
      assetPath: source.assetPath,
      width: source.width,
      height: source.height,
      mimeType: source.mimeType,
    })),
    productionAssetActive: true,
    decoration:
      scene.performance.renderer === "canvas-2d" ? "canvas-2d" : "none",
  };
}
