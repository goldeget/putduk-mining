"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useResolvedTheme } from "@/lib/design/use-resolved-theme";

import { SAFE_SCENE_COPY } from "@/lib/mining-scene/safe-scene-copy";
import type { StageSceneInput } from "@/lib/mining-scene/stage-input";
import {
  resolveResponsiveComposition,
  type SceneImageComposition,
} from "@/lib/mining-scene/responsive-composition";
import {
  ACCENT_TOKENS,
  APPROVED_SCENE_ASSET_PATHS,
  isApprovedMasterSha256,
  isApprovedSceneMasterImage,
  type AccentToken,
  type ApprovedResponsiveSource,
  type ApprovedSceneMaster,
} from "@/lib/mining-scene/types";

import styles from "./mining-live-stage.module.css";
import { SceneDecoration } from "./scene-decoration";

const ACCENT_TOKEN_SET: ReadonlySet<string> = new Set(ACCENT_TOKENS);
// Mobile cover projects the landscape image across the 34rem-tall portrait stage.
const SCENE_IMAGE_SIZES = "(max-width: 599px) 52rem, 100vw";

type MiningLiveStageProps = {
  scene: StageSceneInput;
  presentation?: "standalone" | "backdrop";
  className?: string | undefined;
  /** 서버가 이미 확인한 채굴 상태의 장식 힌트. 중지 명령은 호출하지 않는다. */
  running?: boolean;
  reducedMotion?: boolean;
  /** 실제 서버 상태와 조작은 HTML 슬롯에 두고 장면 입력에는 넣지 않는다. */
  children?: ReactNode;
};

function approvedMaster(scene: StageSceneInput): ApprovedSceneMaster | null {
  const master = scene.master;
  return master &&
    scene.productionAssetActive &&
    isApprovedMasterSha256(master.sha256) &&
    isApprovedSceneMasterImage(master) &&
    (APPROVED_SCENE_ASSET_PATHS as readonly string[]).includes(
      master.assetPath,
    ) &&
    Number.isFinite(master.width + master.height) &&
    master.width > 0 &&
    master.height > 0
    ? master
    : null;
}

function artState(
  scene: StageSceneInput,
  master: ApprovedSceneMaster | null,
): "closed" | "pending" | "ready" {
  if (master) {
    return "ready";
  }
  if (scene.visualStatus === "VISUAL_MASTER_REQUIRED") {
    return "pending";
  }
  return "closed";
}

function responsiveGroups(sources: readonly ApprovedResponsiveSource[]) {
  const groups = new Map<
    string,
    { media: string; type: string; candidates: string[] }
  >();
  for (const source of sources) {
    if (
      !(APPROVED_SCENE_ASSET_PATHS as readonly string[]).includes(
        source.assetPath,
      ) ||
      !Number.isFinite(source.width + source.height) ||
      source.width <= 0 ||
      source.height <= 0 ||
      !(
        (source.mimeType === "image/avif" &&
          source.assetPath.endsWith(".avif")) ||
        (source.mimeType === "image/webp" && source.assetPath.endsWith(".webp"))
      )
    ) {
      continue;
    }
    const type = source.mimeType;
    const key = `${source.media}|${type}`;
    const group = groups.get(key) ?? {
      media: source.media,
      type,
      candidates: [],
    };
    group.candidates.push(`${source.assetPath} ${source.width}w`);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function ApprovedArt({
  master,
  sources,
  decoration,
  scene,
}: {
  master: ApprovedSceneMaster;
  sources: readonly ApprovedResponsiveSource[];
  decoration: boolean;
  scene: StageSceneInput;
}) {
  const [loaded, setLoaded] = useState(false);
  const [sourceFailed, setSourceFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const [composition, setComposition] = useState<SceneImageComposition | null>(
    null,
  );
  const [objectPosition, setObjectPosition] = useState({ x: 0.5, y: 0.5 });
  const groups = responsiveGroups(sources);
  const imageSizes = sources.some((source) => source.composition)
    ? "100vw"
    : SCENE_IMAGE_SIZES;

  useEffect(() => {
    const element = imageRef.current;
    if (!element) return;
    function synchronize() {
      if (!element?.complete || element.naturalWidth === 0) {
        setComposition(null);
        return;
      }
      setComposition(
        resolveResponsiveComposition({
          currentSrc: element.currentSrc || element.src,
          origin: window.location.origin,
          master,
          sources,
          anchor: scene.anchor,
          extractionTarget: scene.extractionTarget,
        }),
      );
      const positions = getComputedStyle(element).objectPosition.split(" ");
      const values = positions.map((part) =>
        /^\d+(?:\.\d+)?%$/.test(part) ? Number.parseFloat(part) / 100 : NaN,
      );
      setObjectPosition(
        values.length === 2 &&
          values.every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1,
          )
          ? { x: values[0]!, y: values[1]! }
          : { x: 0.5, y: 0.5 },
      );
    }
    element.addEventListener("load", synchronize);
    window.addEventListener("resize", synchronize);
    synchronize();
    return () => {
      element.removeEventListener("load", synchronize);
      window.removeEventListener("resize", synchronize);
    };
  }, [master, sources, scene.anchor, scene.extractionTarget, attempt]);

  return (
    <>
      <picture
        key={attempt}
        className={styles.picture}
        data-scene-image={
          unavailable ? "unavailable" : loaded ? "ready" : "loading"
        }
      >
        {!sourceFailed
          ? groups.map((group) => (
              <source
                key={`${group.media}|${group.type}`}
                media={group.media || undefined}
                type={group.type}
                srcSet={group.candidates.join(", ")}
                sizes={imageSizes}
              />
            ))
          : null}
        <Image
          ref={imageRef}
          className={styles.master}
          alt=""
          src={master.assetPath}
          width={master.width}
          height={master.height}
          sizes={imageSizes}
          loading="eager"
          fetchPriority="high"
          unoptimized
          onLoad={() => setLoaded(true)}
          onError={() => {
            setLoaded(false);
            if (!sourceFailed && groups.length > 0) {
              setSourceFailed(true);
            } else {
              setUnavailable(true);
            }
          }}
        />
      </picture>
      <SceneDecoration
        enabled={decoration && loaded && !unavailable && composition !== null}
        anchor={composition?.anchor ?? null}
        extractionTarget={composition?.extractionTarget ?? null}
        objectPosition={objectPosition}
        particleCount={scene.performance?.maxParticles ?? 0}
        maxFps={scene.performance?.maxFps}
        maxDpr={scene.performance?.maxDpr}
        imageWidth={composition?.width ?? 0}
        imageHeight={composition?.height ?? 0}
      />
      {unavailable ? (
        <div className={styles.imageRecovery}>
          <p role="status">배경을 불러오지 못했어요.</p>
          <button
            type="button"
            onClick={() => {
              setLoaded(false);
              setSourceFailed(false);
              setUnavailable(false);
              setAttempt((value) => value + 1);
            }}
          >
            다시 보기
          </button>
        </div>
      ) : null}
    </>
  );
}

function accentStyle(token: AccentToken | null): CSSProperties | undefined {
  if (!token || !ACCENT_TOKEN_SET.has(token)) {
    return undefined;
  }
  return {
    "--scene-accent": `var(${token})`,
  } as CSSProperties;
}

/**
 * 공통 채굴 장면.
 * 상품 코드와 패밀리 키로 레이아웃을 나누지 않는다.
 * 새 패밀리는 Scene registry 행만 추가하면 이 컴포넌트는 그대로다.
 */
export function MiningLiveStage({
  scene,
  presentation = "standalone",
  className,
  running = false,
  reducedMotion = false,
  children,
}: MiningLiveStageProps) {
  const theme = useResolvedTheme();
  const variant = scene.master?.lightVariant;
  const lightScene = variant
    ? {
        ...scene,
        master: variant.master,
        responsiveSources: variant.responsiveSources,
      }
    : null;
  if (
    theme === "light" &&
    lightScene &&
    approvedMaster(scene) &&
    approvedMaster(lightScene)
  )
    scene = lightScene;
  const master = approvedMaster(scene);
  const paintDecoration =
    running &&
    master !== null &&
    scene.decoration === "canvas-2d" &&
    scene.performance?.renderer === "canvas-2d" &&
    scene.performance?.webgl === false &&
    scene.performance.timerAdvancesValue === false &&
    reducedMotion === false;
  const copy = scene.userCopyKo.trim() || SAFE_SCENE_COPY;

  return (
    <section
      className={`${styles.stage}${className ? ` ${className}` : ""}`}
      style={accentStyle(scene.accentToken)}
      data-scene-family={scene.familyKey ?? ""}
      data-scene-version={scene.version ?? ""}
      data-scene-art={artState(scene, master)}
      data-scene-theme={theme}
      data-scene-layout={presentation}
      data-mining-running={running ? "true" : "false"}
      data-motion={paintDecoration ? "ambient" : "static"}
      aria-label={scene.a11yLabelKo}
    >
      {master ? (
        <ApprovedArt
          key={master.sha256}
          master={master}
          sources={scene.responsiveSources}
          decoration={paintDecoration}
          scene={scene}
        />
      ) : null}
      <div
        className={
          children ? `${styles.content} ${styles.withControls}` : styles.content
        }
      >
        {children ? (
          <div className={styles.controls}>{children}</div>
        ) : (
          <p className={styles.copy}>{copy}</p>
        )}
      </div>
    </section>
  );
}
