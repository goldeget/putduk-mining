"use client";

import { useState } from "react";

import { useResolvedTheme } from "@/lib/design/use-resolved-theme";

import styles from "./wallet-scene.module.css";

type WalletSceneProps = {
  className?: string | undefined;
  sizes?: string;
  priority?: boolean;
};

/** Reviewed Wallet decoration only; this boundary receives no financial data. */
export function WalletScene({
  className,
  sizes = "(min-width: 1100px) 1200px, 100vw",
  priority = false,
}: WalletSceneProps) {
  const theme = useResolvedTheme();
  return (
    <WalletSceneFrame
      key={theme}
      theme={theme}
      className={className}
      sizes={sizes}
      priority={priority}
    />
  );
}

function WalletSceneFrame({
  className,
  theme,
  sizes,
  priority,
}: {
  className?: string | undefined;
  theme: "dark" | "light";
  sizes: string;
  priority: boolean;
}) {
  const [mode, setMode] = useState<"responsive" | "webp" | "unavailable">(
    "responsive",
  );
  const [desktopFallback, setDesktopFallback] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mobileFamily =
    theme === "light" ? "wallet-chip-mobile-light" : "wallet-vault-mobile-dark";
  const desktopFamily =
    theme === "light"
      ? "wallet-chip-desktop-light"
      : "wallet-vault-desktop-dark";
  const mobileWidths = theme === "light" ? [480, 640, 940] : [480, 640, 941];
  const nativeWidth = theme === "light" ? 940 : 941;
  const url = (family: string, width: number, format: "avif" | "webp") => {
    const asset = `/brand/scenes/${family}/${family}-${width}-v1.${format}`;
    return attempt === 0 ? asset : `${asset}?wallet-art-retry=${attempt}`;
  };
  const sourceSet = (
    family: string,
    widths: readonly number[],
    format: "avif" | "webp",
  ) =>
    widths.map((width) => `${url(family, width, format)} ${width}w`).join(", ");
  function imageFailed() {
    if (mode === "responsive") {
      setDesktopFallback(window.matchMedia("(min-width: 640px)").matches);
      setMode("webp");
    } else if (mode === "webp") {
      setMode("unavailable");
    }
  }
  function retry() {
    setAttempt((previous) => previous + 1);
    setDesktopFallback(false);
    setMode("responsive");
  }
  return (
    <div
      className={[styles.scene, className].filter(Boolean).join(" ")}
      data-scene-theme={theme}
      data-wallet-scene-state={mode}
    >
      <div
        className={styles.visual}
        data-wallet-decoration="native-scene"
        aria-hidden="true"
      >
        {mode === "responsive" ? (
          <picture key={`responsive-${attempt}`}>
            {(["avif", "webp"] as const).map((format) => (
              <source
                key={`desktop-${format}`}
                media="(min-width: 640px)"
                type={`image/${format}`}
                srcSet={sourceSet(
                  desktopFamily,
                  [960, 1280, 1536, 1920],
                  format,
                )}
                sizes={sizes}
              />
            ))}
            {(["avif", "webp"] as const).map((format) => (
              <source
                key={`mobile-${format}`}
                type={`image/${format}`}
                srcSet={sourceSet(mobileFamily, mobileWidths, format)}
                sizes={sizes}
              />
            ))}
            <img
              src={url(mobileFamily, 640, "webp")}
              width={nativeWidth}
              height={1672}
              alt=""
              aria-hidden="true"
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : undefined}
              decoding="async"
              onError={imageFailed}
            />
          </picture>
        ) : mode === "webp" ? (
          <picture key={`fallback-${attempt}`}>
            <img
              src={url(
                desktopFallback ? desktopFamily : mobileFamily,
                desktopFallback ? 1280 : 640,
                "webp",
              )}
              width={desktopFallback ? 1983 : nativeWidth}
              height={desktopFallback ? 793 : 1672}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              onError={imageFailed}
            />
          </picture>
        ) : null}
      </div>
      {mode === "unavailable" ? (
        <div
          className={styles.recovery}
          role="status"
          data-wallet-decoration-status="unavailable"
        >
          <p>지갑 배경을 불러오지 못했어요.</p>
          <button type="button" onClick={retry}>
            배경 다시 불러오기
          </button>
        </div>
      ) : null}
    </div>
  );
}
