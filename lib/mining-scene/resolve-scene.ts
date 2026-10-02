import { presentationForCode } from "@/lib/mining-scene/product-presentation";
import { SAFE_SCENE_COPY } from "@/lib/mining-scene/safe-scene-copy";
import { getSceneRow } from "@/lib/mining-scene/scene-registry";
import {
  ACCENT_TOKENS,
  DECORATIVE_OBJECTS,
  isSceneFamilyKey,
  type AccentToken,
  type AmbientPreset,
  type DecorativeObject,
  type MiningProductIdentity,
  type ParticleEmphasis,
  type ProductPresentation,
  type ProductSceneProfile,
  type ResolvedScene,
  type SceneBindingInput,
  type SceneDefinition,
  type SceneVisualStatus,
} from "@/lib/mining-scene/types";

const ACCENT_TOKEN_SET: ReadonlySet<string> = new Set(ACCENT_TOKENS);
const DECORATIVE_OBJECT_SET: ReadonlySet<string> = new Set(DECORATIVE_OBJECTS);
const PARTICLE_EMPHASIS = new Set<ParticleEmphasis>([
  "none",
  "sparse",
  "steady",
]);
const AMBIENT_PRESETS = new Set<AmbientPreset>([
  "still",
  "warm",
  "cool",
  "neutral",
]);

const UNSAFE_COPY =
  /https?:|\/\/|<|>|javascript:|VISUAL_MASTER_REQUIRED|DECISION_REQUIRED|수익률|잔액/i;

function safeCopy(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || UNSAFE_COPY.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function isSafeProfile(profile: ProductSceneProfile): boolean {
  if (!profile || typeof profile !== "object") {
    return false;
  }
  if (
    typeof profile.displayNameKo !== "string" ||
    typeof profile.htmlCopyKo !== "string" ||
    typeof profile.a11yLabelKo !== "string"
  ) {
    return false;
  }
  if (!ACCENT_TOKEN_SET.has(profile.accentToken)) {
    return false;
  }
  if (!PARTICLE_EMPHASIS.has(profile.particleEmphasis)) {
    return false;
  }
  if (!AMBIENT_PRESETS.has(profile.ambientPreset)) {
    return false;
  }
  if (profile.masterVariant !== null) {
    return false;
  }
  if (!Array.isArray(profile.decorativeObjects)) {
    return false;
  }
  if (
    profile.decorativeObjects.some((item) => !DECORATIVE_OBJECT_SET.has(item))
  ) {
    return false;
  }
  return (
    safeCopy(profile.displayNameKo, "") === profile.displayNameKo &&
    safeCopy(profile.htmlCopyKo, "") === profile.htmlCopyKo &&
    safeCopy(profile.a11yLabelKo, "") === profile.a11yLabelKo
  );
}

function fallbackProfile(profile: ProductSceneProfile): ProductSceneProfile {
  const decorativeObjects = Array.isArray(profile?.decorativeObjects)
    ? profile.decorativeObjects.filter((item): item is DecorativeObject =>
        DECORATIVE_OBJECT_SET.has(item),
      )
    : [];
  const accentToken = ACCENT_TOKEN_SET.has(profile?.accentToken)
    ? (profile.accentToken as AccentToken)
    : "--brand-primary";
  const particleEmphasis = PARTICLE_EMPHASIS.has(profile?.particleEmphasis)
    ? profile.particleEmphasis
    : "none";
  const ambientPreset = AMBIENT_PRESETS.has(profile?.ambientPreset)
    ? profile.ambientPreset
    : "still";
  return {
    displayNameKo: safeCopy(profile?.displayNameKo ?? "", "채굴 테마"),
    accentToken,
    particleEmphasis,
    decorativeObjects,
    ambientPreset,
    htmlCopyKo: safeCopy(profile?.htmlCopyKo ?? "", SAFE_SCENE_COPY),
    a11yLabelKo: safeCopy(profile?.a11yLabelKo ?? "", "채굴 테마"),
    masterVariant: null,
  };
}

/** 알려진 필드만 복사한다. JSON 에 섞인 금액·URL·스크립트는 떨어낸다. */
function projectProfile(profile: ProductSceneProfile): ProductSceneProfile {
  const source = isSafeProfile(profile) ? profile : fallbackProfile(profile);
  return {
    displayNameKo: source.displayNameKo,
    accentToken: source.accentToken,
    particleEmphasis: source.particleEmphasis,
    decorativeObjects: [...source.decorativeObjects],
    ambientPreset: source.ambientPreset,
    htmlCopyKo: source.htmlCopyKo,
    a11yLabelKo: source.a11yLabelKo,
    masterVariant: null,
  };
}

function closed(
  identity: MiningProductIdentity,
  visualStatus: SceneVisualStatus,
  copy: string,
): ResolvedScene {
  return {
    identity,
    presentation: null,
    scene: null,
    visualStatus,
    productionAssetActive: false,
    userCopyKo: copy,
    a11yLabelKo: copy,
  };
}

function activationOf(scene: SceneDefinition): boolean {
  return scene.productionAssetActive === true && scene.master !== null;
}

/**
 * 패밀리 선택은 binding.sceneFamilyKey 만 본다.
 * 상품 이름, 회사명, 카테고리, 상품 JSON 은 사용하지 않는다.
 */
export function resolveScene(
  identity: MiningProductIdentity,
  binding: SceneBindingInput | null,
): ResolvedScene {
  if (!binding) {
    return closed(identity, "PRESENTATION_MISSING", SAFE_SCENE_COPY);
  }
  if (binding.productCode !== identity.code) {
    return closed(identity, "PRESENTATION_MISMATCH", SAFE_SCENE_COPY);
  }
  if (!binding.profile || typeof binding.profile !== "object") {
    return closed(identity, "PRESENTATION_MISSING", SAFE_SCENE_COPY);
  }
  if (!isSceneFamilyKey(binding.sceneFamilyKey)) {
    return closed(identity, "UNSUPPORTED_FAMILY", SAFE_SCENE_COPY);
  }
  const registryRow = getSceneRow(binding.sceneFamilyKey);
  if (registryRow.version !== binding.sceneFamilyVersion) {
    return closed(identity, "UNSUPPORTED_FAMILY", SAFE_SCENE_COPY);
  }

  const profile = projectProfile(binding.profile);
  const scene = registryRow.definition;
  const presentation: ProductPresentation = {
    productCode: identity.code,
    sceneFamilyKey: registryRow.familyKey,
    sceneFamilyVersion: registryRow.version,
    profile,
  };
  const productionAssetActive = activationOf(scene);
  const visibleCopy = productionAssetActive
    ? profile.htmlCopyKo
    : SAFE_SCENE_COPY;

  return {
    identity,
    presentation,
    scene,
    visualStatus:
      scene.packStatus === "APPROVED" && productionAssetActive
        ? "MASTER_READY"
        : "VISUAL_MASTER_REQUIRED",
    productionAssetActive,
    userCopyKo: visibleCopy,
    a11yLabelKo: visibleCopy,
  };
}

export function resolveCatalogProduct(
  identity: MiningProductIdentity,
): ResolvedScene {
  const presentation = presentationForCode(identity.code);
  if (!presentation) {
    return resolveScene(identity, null);
  }
  if (
    presentation.sceneFamilyKey === null ||
    presentation.sceneFamilyVersion === null
  ) {
    return {
      identity,
      presentation: {
        productCode: presentation.productCode,
        sceneFamilyKey: null,
        sceneFamilyVersion: null,
        profile: projectProfile(presentation.profile),
      },
      scene: null,
      visualStatus: "FAMILY_UNASSIGNED",
      productionAssetActive: false,
      userCopyKo: SAFE_SCENE_COPY,
      a11yLabelKo: SAFE_SCENE_COPY,
    };
  }
  return resolveScene(identity, {
    productCode: presentation.productCode,
    sceneFamilyKey: presentation.sceneFamilyKey,
    sceneFamilyVersion: presentation.sceneFamilyVersion,
    profile: presentation.profile,
  });
}
