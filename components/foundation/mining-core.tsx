"use client";

import { useId, useRef, useState } from "react";

import { useAmbientRuntime } from "@/lib/motion/ambient-runtime";
import { useMotionPreference } from "@/lib/motion/motion-preference";

import styles from "./mining-core.module.css";

type MiningCoreProps = {
  /** Only an already confirmed server running state enables energy flow. */
  running?: boolean;
  lowPower?: boolean;
};

export function MiningCore({
  running = false,
  lowPower = false,
}: MiningCoreProps) {
  const scene = useRef<HTMLDivElement>(null);
  const runtime = useAmbientRuntime(scene);
  const reducedMotion = useMotionPreference();
  const [paused, setPaused] = useState(false);
  const id = useId();
  const metalId = `${id}-metal`;
  const faceId = `${id}-face`;
  const still = reducedMotion || lowPower || !runtime.available || !running;
  const animate = !still && runtime.visible && !paused;

  return (
    <div
      ref={scene}
      className={`mining-core ${styles.scene}`}
      data-motion={animate ? "playing" : "paused"}
      data-motion-quality={still ? "static" : "ambient"}
      data-mining-running={running ? "true" : "false"}
    >
      <div className={styles.art} aria-hidden="true">
        <div className={styles.halo} />
        <div className={`${styles.orbit} ${styles.outer}`}>
          <span />
        </div>
        <div className={`${styles.orbit} ${styles.inner}`}>
          <span />
        </div>
        <div className={styles.depthRing} />
        {running ? (
          <div className={styles.energy}>
            {Array.from({ length: 6 }, (_, index) => (
              <span className={styles.particle} key={index} />
            ))}
          </div>
        ) : null}
        <div className={styles.core}>
          <svg viewBox="0 0 180 180">
            <defs>
              <linearGradient id={metalId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--brand-mineral)" />
                <stop offset="0.3" stopColor="var(--brand-primary)" />
                <stop offset="0.58" stopColor="var(--brand-strong)" />
                <stop offset="0.78" stopColor="var(--brand-mineral)" />
                <stop offset="1" stopColor="var(--brand-strong)" />
              </linearGradient>
              <linearGradient id={faceId} x1="0" y1="0" x2="0.9" y2="1">
                <stop offset="0" stopColor="var(--surface-raised)" />
                <stop offset="1" stopColor="var(--surface-sunken)" />
              </linearGradient>
            </defs>
            <path
              d="m90 17 63 36.5v73L90 163l-63-36.5v-73L90 17Z"
              fill={`url(#${metalId})`}
            />
            <path
              d="m90 28 53 30.5v61L90 151l-53-31.5v-61L90 28Z"
              fill={`url(#${faceId})`}
            />
            <path
              className={styles.bevel}
              d="m37 58.5 53 30.6 53-30.6M90 89.1V151"
            />
            <path
              className={styles.face}
              d="m90 43 40 23v47l-40 24-40-24V66l40-23Z"
            />
            <path
              className={styles.mineral}
              d="m61 105 36-42 22 24-36 40-22-22Z"
            />
            <path
              className={styles.mark}
              d="m69 106 14 13 28-32-14-15-28 34Z"
            />
          </svg>
          <span className={styles.glint} />
        </div>
      </div>
      <div className={styles.controls}>
        <button
          className={styles.pause}
          type="button"
          aria-label={
            still
              ? "채굴 공간 연출: 움직임 없이 보기"
              : paused
                ? "채굴 공간 연출 재생"
                : "채굴 공간 연출 일시정지"
          }
          aria-pressed={paused}
          aria-describedby={`${id}-motion-description`}
          disabled={still}
          onClick={() => setPaused((value) => !value)}
        >
          {still ? "움직임 없이 보기" : paused ? "연출 재생" : "연출 일시정지"}
        </button>
        <span id={`${id}-motion-description`} className={styles.description}>
          연출을 멈춰도 채굴 상태와 결과는 그대로예요.
        </span>
      </div>
    </div>
  );
}
