"use client";

import { useResolvedTheme } from "@/lib/design/use-resolved-theme";

/** Decorative Phase 2 artwork. It never selects a product or computes money. */
export const GLOBAL_PAVILION_ASSET = {
  path: "/brand/scenes/global-pavilion/global-pavilion-960-v1.webp",
  width: 960,
  height: 640,
} as const;

export function GlobalPavilion({
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
      ? "/brand/scenes/semiconductor-memory-light/semiconductor-memory-light-"
      : "/brand/scenes/global-pavilion/global-pavilion-";
  return (
    <picture className={className} data-art-theme={theme}>
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
        width={GLOBAL_PAVILION_ASSET.width}
        height={GLOBAL_PAVILION_ASSET.height}
        alt=""
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
      />
    </picture>
  );
}
