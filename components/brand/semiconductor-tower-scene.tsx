"use client";

import { useResolvedTheme } from "@/lib/design/use-resolved-theme";

import styles from "./semiconductor-tower-scene.module.css";

/** Exact delegated HOME artwork; it never selects a product or computes money. */
export function SemiconductorTowerScene({
  className,
  sizes = "100vw",
  priority = false,
}: {
  className?: string | undefined;
  sizes?: string;
  priority?: boolean;
}) {
  const theme = useResolvedTheme();
  const prefix =
    theme === "light"
      ? "/brand/scenes/semiconductor-wafer-light/semiconductor-wafer-light-"
      : "/brand/scenes/semiconductor-tower/semiconductor-tower-";
  const desktopPrefix =
    theme === "light"
      ? "/brand/scenes/semiconductor-wafer-light-desktop/semiconductor-wafer-light-desktop-"
      : "/brand/scenes/semiconductor-tower-desktop/semiconductor-tower-desktop-";
  return (
    <picture
      className={[styles.scene, className].filter(Boolean).join(" ")}
      data-scene-theme={theme}
      data-art-theme={theme}
    >
      {(["avif", "webp"] as const).map((format) => (
        <source
          key={`desktop-${format}`}
          media="(min-width: 980px)"
          type={`image/${format}`}
          srcSet={[960, 1280, 1536, 1920]
            .map((width) => `${desktopPrefix}${width}-v1.${format} ${width}w`)
            .join(", ")}
          sizes={sizes}
        />
      ))}
      {(["avif", "webp"] as const).map((format) => (
        <source
          key={format}
          type={`image/${format}`}
          srcSet={[640, 960, 1280, 1536]
            .map((width) => `${prefix}${width}-v1.${format} ${width}w`)
            .join(", ")}
          sizes={sizes}
        />
      ))}
      <img
        src={`${prefix}960-v1.webp`}
        width={1536}
        height={1024}
        alt=""
        aria-hidden="true"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
      />
    </picture>
  );
}
