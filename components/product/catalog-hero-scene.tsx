"use client";
import { useId, useState } from "react";
import { useResolvedTheme } from "@/lib/design/use-resolved-theme";
import styles from "./catalog-hero-scene.module.css";

/** Decoration only; receives no account, allocation, catalog or financial facts. */
export function CatalogHeroScene({
  className,
  sizes = "100vw",
  priority = false,
}: {
  className?: string | undefined;
  sizes?: string;
  priority?: boolean;
}) {
  const theme = useResolvedTheme();
  return (
    <SceneFrame
      key={theme}
      className={className}
      sizes={sizes}
      priority={priority}
      theme={theme}
    />
  );
}
function SceneFrame({
  className,
  sizes,
  priority,
  theme,
}: {
  className?: string | undefined;
  sizes: string;
  priority: boolean;
  theme: "dark" | "light";
}) {
  const [mode, setMode] = useState<"responsive" | "webp" | "unavailable">(
    "responsive",
  );
  const [desktopFallback, setDesktopFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const instanceId = useId();
  const mobileFamily =
    theme === "dark"
      ? "products-semiconductor-hero"
      : "semiconductor-wafer-light";
  const desktopFamily =
    theme === "dark"
      ? "semiconductor-tower-desktop"
      : "semiconductor-wafer-light-desktop";
  const mobileWidths =
    theme === "dark"
      ? [480, 640, 960, 1280, 1536, 1920]
      : [640, 960, 1280, 1536];
  const url = (family: string, width: number, format: "avif" | "webp") =>
    `/brand/scenes/${family}/${family}-${width}-v1.${format}${attempt ? `?catalog-art-retry=${attempt}&catalog-art-instance=${encodeURIComponent(instanceId)}` : ""}`;
  const set = (family: string, widths: number[], format: "avif" | "webp") =>
    widths.map((width) => `${url(family, width, format)} ${width}w`).join(", ");
  function failed() {
    if (mode === "responsive") {
      setDesktopFallback(window.matchMedia("(min-width: 980px)").matches);
      setMode("webp");
    } else if (mode === "webp") setMode("unavailable");
  }
  function reconcileImage(image: HTMLImageElement | null) {
    // The server-rendered image can fail before React attaches onError.
    // Loading and successfully decoded images must keep their current mode.
    if (image?.complete && image.currentSrc && image.naturalWidth === 0)
      failed();
  }
  function retry() {
    setAttempt((value) => value + 1);
    setDesktopFallback(false);
    setMode("responsive");
  }
  return (
    <div
      className={[styles.scene, className].filter(Boolean).join(" ")}
      data-catalog-hero-theme={theme}
      data-catalog-hero-state={mode}
    >
      <div className={styles.visual} aria-hidden="true">
        {mode === "responsive" ? (
          <picture key={`responsive-${attempt}`}>
            {(["avif", "webp"] as const).map((format) => (
              <source
                key={`desktop-${format}`}
                media="(min-width: 980px)"
                type={`image/${format}`}
                srcSet={set(desktopFamily, [960, 1280, 1536, 1920], format)}
                sizes={sizes}
              />
            ))}
            {(["avif", "webp"] as const).map((format) => (
              <source
                key={`mobile-${format}`}
                type={`image/${format}`}
                srcSet={set(mobileFamily, mobileWidths, format)}
                sizes={sizes}
              />
            ))}
            <img
              ref={reconcileImage}
              src={url(mobileFamily, 640, "webp")}
              width={theme === "dark" ? 1983 : 1536}
              height={theme === "dark" ? 793 : 1024}
              alt=""
              aria-hidden="true"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : undefined}
              decoding="async"
              onError={failed}
            />
          </picture>
        ) : mode === "webp" ? (
          <picture key={`fallback-${attempt}`}>
            <img
              ref={reconcileImage}
              src={url(
                desktopFallback ? desktopFamily : mobileFamily,
                desktopFallback ? 1280 : 640,
                "webp",
              )}
              width={desktopFallback || theme === "dark" ? 1983 : 1536}
              height={desktopFallback || theme === "dark" ? 793 : 1024}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              onError={failed}
            />
          </picture>
        ) : null}
      </div>
      {mode === "unavailable" ? (
        <div className={styles.recovery} role="status">
          <p>상품 배경을 불러오지 못했어요.</p>
          <button type="button" onClick={retry}>
            배경 다시 불러오기
          </button>
        </div>
      ) : null}
    </div>
  );
}
