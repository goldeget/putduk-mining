"use client";

import { useRef } from "react";

import { useAmbientRuntime } from "@/lib/motion/ambient-runtime";
import { useMotionPreference } from "@/lib/motion/motion-preference";

import styles from "./mining-energy-layer.module.css";

/**
 * Decorative light over the approved scene master. It carries no money and no
 * progress. The parent mounts it only while the server says mining is active;
 * it then plays only when visible, in view, not low-power and not reduced-motion.
 * Reduced motion keeps one still rim light, so state and copy are unchanged.
 */
export function MiningEnergyLayer() {
  const layer = useRef<HTMLDivElement>(null);
  const runtime = useAmbientRuntime(layer);
  const reducedMotion = useMotionPreference();
  const state = reducedMotion
    ? "calm"
    : !runtime.available
      ? "static"
      : runtime.visible
        ? "playing"
        : "paused";

  return (
    <div
      ref={layer}
      className={styles.layer}
      aria-hidden="true"
      data-mining-energy={state}
    >
      <span className={styles.glow} />
      <span className={styles.sweep} />
      {Array.from({ length: 7 }, (_, index) => (
        <span className={styles.mote} key={index} />
      ))}
    </div>
  );
}
