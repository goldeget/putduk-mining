"use client";

import { useEffect, useRef } from "react";

import type { ScenePoint } from "@/lib/mining-scene/types";

import styles from "./mining-live-stage.module.css";

export const SCENE_MOTION_LIMITS = {
  maxFps: 30,
  maxDpr: 1.5,
  maxParticles: 12,
  maxDimension: 2048,
  maxPixels: 1_572_864,
} as const;

type SceneDecorationProps = {
  enabled: boolean;
  anchor: ScenePoint | null;
  particleCount: number;
  maxFps?: number | undefined;
  maxDpr?: number | undefined;
  imageWidth?: number;
  imageHeight?: number;
};

function bounded(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : minimum;
}

/** Canvas pixels are bounded independently from the unchanged scene image. */
export function sceneCanvasSize(width: number, height: number, dpr: number) {
  if (!Number.isFinite(width + height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0, scale: 0 };
  }
  const scale = Math.min(
    bounded(dpr, 1, SCENE_MOTION_LIMITS.maxDpr),
    SCENE_MOTION_LIMITS.maxDimension / width,
    SCENE_MOTION_LIMITS.maxDimension / height,
    Math.sqrt(SCENE_MOTION_LIMITS.maxPixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

/** The image uses centered cover; motes follow its actual cropped composition. */
export function sceneAnchorPosition(
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number,
  point: ScenePoint,
) {
  if (
    !Number.isFinite(imageWidth + imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return { x: width * point.x, y: height * point.y };
  }
  const scale = Math.max(width / imageWidth, height / imageHeight);
  const coverWidth = imageWidth * scale;
  const coverHeight = imageHeight * scale;
  return {
    x: coverWidth * point.x - (coverWidth - width) / 2,
    y: coverHeight * point.y - (coverHeight - height) / 2,
  };
}

/**
 * A few restrained light motes over the approved image, never a scene substitute.
 * Its one animation clock changes decoration geometry only, with no domain values.
 */
export function SceneDecoration({
  enabled,
  anchor,
  particleCount,
  maxFps = SCENE_MOTION_LIMITS.maxFps,
  maxDpr = SCENE_MOTION_LIMITS.maxDpr,
  imageWidth = 0,
  imageHeight = 0,
}: SceneDecorationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorX = anchor?.x;
  const anchorY = anchor?.y;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (
      !enabled ||
      !canvas ||
      anchorX === undefined ||
      anchorY === undefined ||
      !Number.isFinite(anchorX + anchorY) ||
      anchorX < 0 ||
      anchorX > 1 ||
      anchorY < 0 ||
      anchorY > 1 ||
      particleCount <= 0
    ) {
      return;
    }

    if (
      typeof window.matchMedia !== "function" ||
      typeof window.requestAnimationFrame !== "function" ||
      typeof window.cancelAnimationFrame !== "function"
    ) {
      canvas.dataset.motionState = "unavailable";
      return;
    }

    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d", { alpha: true });
    } catch {
      canvas.dataset.motionState = "unavailable";
      return;
    }
    if (!context) {
      canvas.dataset.motionState = "unavailable";
      return;
    }
    const paint = context;
    const count = Math.floor(
      bounded(particleCount, 0, SCENE_MOTION_LIMITS.maxParticles),
    );
    const fpsCeiling = bounded(maxFps, 1, SCENE_MOTION_LIMITS.maxFps);
    const dprCeiling = bounded(maxDpr, 1, SCENE_MOTION_LIMITS.maxDpr);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const capability = navigator as Navigator & {
      connection?: { saveData?: boolean };
      deviceMemory?: number;
    };
    const constrained =
      capability.connection?.saveData === true ||
      (capability.hardwareConcurrency > 0 &&
        capability.hardwareConcurrency <= 2) ||
      (typeof capability.deviceMemory === "number" &&
        capability.deviceMemory <= 2);
    let degraded = constrained;
    let visible = false;
    let disposed = false;
    let failed = false;
    let frame: number | null = null;
    let lastPaint: number | null = null;
    let lastTick: number | null = null;
    let elapsed = 0;
    let costlyFrames = 0;
    let delayedFrames = 0;
    let cssWidth = 0;
    let cssHeight = 0;

    function stop(state: string) {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      lastPaint = null;
      lastTick = null;
      canvas!.dataset.motionState = state;
      try {
        paint.clearRect(0, 0, canvas!.width, canvas!.height);
      } catch {
        failed = true;
        canvas!.dataset.motionState = "unavailable";
      }
    }

    function resize() {
      const bounds = canvas!.getBoundingClientRect();
      cssWidth = bounds.width;
      cssHeight = bounds.height;
      const size = sceneCanvasSize(
        cssWidth,
        cssHeight,
        Math.min(window.devicePixelRatio || 1, degraded ? 1 : dprCeiling),
      );
      if (canvas!.width !== size.width) canvas!.width = size.width;
      if (canvas!.height !== size.height) canvas!.height = size.height;
      canvas!.dataset.motionQuality = degraded ? "reduced" : "standard";
      canvas!.dataset.motionFps = String(
        degraded ? Math.min(15, fpsCeiling) : fpsCeiling,
      );
      canvas!.dataset.particleCount = String(
        degraded ? Math.min(count, 4) : count,
      );
    }

    function canRun() {
      return (
        !disposed &&
        !failed &&
        visible &&
        !document.hidden &&
        !reducedMotion.matches &&
        cssWidth > 0 &&
        cssHeight > 0 &&
        count > 0
      );
    }

    function schedule() {
      if (frame === null && canRun()) {
        frame = window.requestAnimationFrame(tick);
      }
    }

    function synchronize() {
      if (canRun()) {
        canvas!.dataset.motionState = "running";
        schedule();
      } else {
        stop(failed ? "unavailable" : "paused");
      }
    }

    function draw(timestamp: number) {
      const actualCount = degraded ? Math.min(count, 4) : count;
      const scaleX = canvas!.width / cssWidth;
      const scaleY = canvas!.height / cssHeight;
      paint.clearRect(0, 0, canvas!.width, canvas!.height);
      paint.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      const origin = sceneAnchorPosition(
        cssWidth,
        cssHeight,
        imageWidth,
        imageHeight,
        { x: anchorX!, y: anchorY! },
      );
      const seconds = timestamp / 1000;
      for (let index = 0; index < actualCount; index += 1) {
        const phase = index * 2.399963;
        const spread = Math.min(cssWidth, cssHeight) * (0.07 + index * 0.009);
        const x = origin.x + Math.sin(phase + seconds * 0.11) * spread;
        const y = origin.y + Math.cos(phase + seconds * 0.08) * spread * 0.55;
        paint.globalAlpha = 0.1 + (Math.sin(phase + seconds * 0.4) + 1) * 0.09;
        paint.shadowBlur = 7;
        paint.shadowColor = "#efc987";
        paint.fillStyle = index % 3 === 0 ? "#98ceef" : "#f2d9a8";
        paint.beginPath();
        paint.arc(x, y, index % 3 === 0 ? 0.8 : 1.1, 0, Math.PI * 2);
        paint.fill();
      }
      paint.globalAlpha = 1;
      paint.shadowBlur = 0;
      paint.setTransform(1, 0, 0, 1, 0, 0);
    }

    function tick(timestamp: number) {
      frame = null;
      if (!canRun()) {
        synchronize();
        return;
      }
      const interval =
        1000 / (degraded ? Math.min(15, fpsCeiling) : fpsCeiling);
      if (lastTick !== null) {
        const delta = Math.max(0, timestamp - lastTick);
        elapsed += Math.min(delta, 100);
        delayedFrames = delta > 100 ? delayedFrames + 1 : 0;
      }
      lastTick = timestamp;
      if (lastPaint === null || timestamp - lastPaint >= interval) {
        const start = performance.now();
        try {
          draw(elapsed);
        } catch {
          failed = true;
          stop("unavailable");
          return;
        }
        lastPaint = timestamp;
        costlyFrames = performance.now() - start > 8 ? costlyFrames + 1 : 0;
      }
      if (!degraded && (costlyFrames >= 3 || delayedFrames >= 5)) {
        degraded = true;
        resizeAndSynchronize();
      }
      schedule();
    }

    function resizeAndSynchronize() {
      if (disposed) return;
      try {
        resize();
        synchronize();
      } catch {
        failed = true;
        stop("unavailable");
      }
    }

    function checkViewport() {
      if (disposed) return;
      const bounds = canvas!.getBoundingClientRect();
      visible =
        bounds.bottom > 0 &&
        bounds.right > 0 &&
        bounds.top < window.innerHeight &&
        bounds.left < window.innerWidth;
      synchronize();
    }

    function contextLost(event: Event) {
      event.preventDefault();
      failed = true;
      stop("unavailable");
    }

    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              if (disposed) return;
              visible = entries.some(
                (entry) => entry.target === canvas && entry.isIntersecting,
              );
              synchronize();
            },
            { threshold: 0.01 },
          )
        : null;
    const sizeObserver =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(resizeAndSynchronize)
        : null;
    resizeAndSynchronize();
    observer?.observe(canvas);
    sizeObserver?.observe(canvas);
    if (!observer) {
      checkViewport();
      window.addEventListener("scroll", checkViewport, true);
    }
    document.addEventListener("visibilitychange", synchronize);
    canvas.addEventListener("contextlost", contextLost);
    reducedMotion.addEventListener("change", synchronize);
    window.addEventListener("resize", resizeAndSynchronize);
    if (!observer) {
      window.addEventListener("resize", checkViewport);
    }

    return () => {
      disposed = true;
      stop("paused");
      observer?.disconnect();
      sizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", synchronize);
      canvas.removeEventListener("contextlost", contextLost);
      reducedMotion.removeEventListener("change", synchronize);
      window.removeEventListener("resize", resizeAndSynchronize);
      window.removeEventListener("resize", checkViewport);
      window.removeEventListener("scroll", checkViewport, true);
    };
  }, [
    anchorX,
    anchorY,
    enabled,
    imageHeight,
    imageWidth,
    maxDpr,
    maxFps,
    particleCount,
  ]);

  if (!enabled) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={styles.canvas}
      width={0}
      height={0}
      data-decoration="light-motes"
      data-motion-state="paused"
    />
  );
}
