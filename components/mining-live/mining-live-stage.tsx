"use client";

import Image from "next/image";
import type { CSSProperties } from "react";

import { SAFE_SCENE_COPY } from "@/lib/mining-scene/safe-scene-copy";
import type { StageSceneInput } from "@/lib/mining-scene/stage-input";
import { ACCENT_TOKENS, type AccentToken } from "@/lib/mining-scene/types";

import styles from "./mining-live-stage.module.css";
import { SceneDecoration } from "./scene-decoration";

const ACCENT_TOKEN_SET: ReadonlySet<string> = new Set(ACCENT_TOKENS);

type MiningLiveStageProps = {
  scene: StageSceneInput;
  /** 서버가 이미 확인한 채굴 상태의 장식 힌트. 중지 명령은 호출하지 않는다. */
  running?: boolean;
  reducedMotion?: boolean;
};

function artState(scene: StageSceneInput): "closed" | "pending" | "ready" {
  if (scene.master !== null && scene.productionAssetActive) {
    return "ready";
  }
  if (scene.visualStatus === "VISUAL_MASTER_REQUIRED") {
    return "pending";
  }
  return "closed";
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
  running = false,
  reducedMotion = true,
}: MiningLiveStageProps) {
  const showMaster = scene.master !== null && scene.productionAssetActive;
  const paintDecoration =
    running &&
    showMaster &&
    scene.decoration === "canvas-2d" &&
    scene.performance?.webgl === false &&
    scene.performance.timerAdvancesValue === false &&
    reducedMotion === false;
  const copy = scene.userCopyKo.trim() || SAFE_SCENE_COPY;

  return (
    <section
      className={styles.stage}
      style={accentStyle(scene.accentToken)}
      data-scene-family={scene.familyKey ?? ""}
      data-scene-version={scene.version ?? ""}
      data-scene-art={artState(scene)}
      data-mining-running={running ? "true" : "false"}
      data-motion={paintDecoration ? "ambient" : "static"}
      aria-label={scene.a11yLabelKo}
    >
      {showMaster && scene.master ? (
        <Image
          className={styles.master}
          alt={scene.master.altKo}
          src={scene.master.assetPath}
          width={scene.master.width}
          height={scene.master.height}
          unoptimized
        />
      ) : null}
      <p className={styles.copy}>{copy}</p>
      <SceneDecoration
        enabled={paintDecoration}
        anchor={scene.anchor}
        particleCount={scene.performance?.maxParticles ?? 0}
      />
    </section>
  );
}
