"use client";

import { useEffect, useRef } from "react";

import type { ScenePoint } from "@/lib/mining-scene/types";

import styles from "./mining-live-stage.module.css";

type SceneDecorationProps = {
  enabled: boolean;
  anchor: ScenePoint | null;
  particleCount: number;
};

/**
 * 승인 마스터가 있을 때만 그리는 장식.
 * 돈, 버튼, 상태 문구는 그리지 않는다. 타이머로 값을 올리지 않는다.
 */
export function SceneDecoration({
  enabled,
  anchor,
  particleCount,
}: SceneDecorationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!enabled || !anchor || particleCount <= 0) {
      return;
    }
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    const count = Math.min(particleCount, 12);
    for (let index = 0; index < count; index += 1) {
      const angle = (Math.PI * 2 * index) / count;
      const radius = 12 + index * 3;
      context.beginPath();
      context.arc(
        width * anchor.x + Math.cos(angle) * radius,
        height * anchor.y + Math.sin(angle) * radius,
        1.5,
        0,
        Math.PI * 2,
      );
      context.fillStyle = "rgba(246, 200, 91, 0.85)";
      context.fill();
    }
  }, [anchor, enabled, particleCount]);

  if (!enabled) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={styles.canvas}
      width={320}
      height={180}
      data-decoration="particles"
    />
  );
}
