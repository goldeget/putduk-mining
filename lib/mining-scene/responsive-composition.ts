import {
  APPROVED_SCENE_ASSET_PATHS,
  isApprovedMasterSha256,
  isApprovedSceneMasterImage,
  isApprovedResponsiveComposition,
  type ApprovedResponsiveSource,
  type ApprovedSceneMaster,
  type ScenePoint,
} from "./types";

export type SceneImageComposition = {
  width: number;
  height: number;
  anchor: ScenePoint;
  extractionTarget: ScenePoint;
};

function point(value: ScenePoint) {
  return (
    Number.isFinite(value.x + value.y) &&
    value.x >= 0 &&
    value.x <= 1 &&
    value.y >= 0 &&
    value.y <= 1
  );
}

/** Resolve the image the browser actually selected, never a viewport guess. */
export function resolveResponsiveComposition({
  currentSrc,
  origin,
  master,
  sources,
  anchor,
  extractionTarget,
}: {
  currentSrc: string;
  origin: string;
  master: ApprovedSceneMaster;
  sources: readonly ApprovedResponsiveSource[];
  anchor: ScenePoint | null;
  extractionTarget: ScenePoint | null;
}): SceneImageComposition | null {
  try {
    const url = new URL(currentSrc, origin);
    if (url.origin !== origin || url.search || url.hash) return null;
    if (
      !(APPROVED_SCENE_ASSET_PATHS as readonly string[]).includes(url.pathname)
    )
      return null;
    const source = sources.find((item) => item.assetPath === url.pathname);
    if (!source && master.assetPath !== url.pathname) return null;
    if (source && !isApprovedResponsiveComposition(source)) return null;
    const composition = source?.composition;
    const selected = source ?? master;
    const selectedAnchor = composition?.anchor ?? anchor;
    const selectedTarget = composition?.extractionTarget ?? extractionTarget;
    const sha256 = composition?.masterSha256 ?? master.sha256;
    if (
      !selectedAnchor ||
      !selectedTarget ||
      !point(selectedAnchor) ||
      !point(selectedTarget) ||
      !isApprovedMasterSha256(sha256) ||
      !isApprovedSceneMasterImage({
        sha256,
        assetPath: selected.assetPath,
        width: selected.width,
        height: selected.height,
        altKo: master.altKo,
      })
    )
      return null;
    return {
      width: selected.width,
      height: selected.height,
      anchor: { ...selectedAnchor },
      extractionTarget: { ...selectedTarget },
    };
  } catch {
    return null;
  }
}
