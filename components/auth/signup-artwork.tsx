"use client";

import { useState } from "react";

import { LOGIN_SCENE_FAMILIES } from "@/components/auth/login-artwork";
import { useResolvedTheme } from "@/lib/design/use-resolved-theme";

/** Dedicated portrait master is reviewed; root must activate its producer manifest before this candidate. */
export const SIGNUP_MOBILE_DARK_ART = {
  prefix:
    "/brand/scenes/signup-semiconductor-mobile-dark/signup-semiconductor-mobile-dark-",
  widths: [480, 640, 941],
  width: 941,
  height: 1672,
} as const;

function Artwork({
  theme,
  className,
}: {
  theme: "dark" | "light";
  className?: string | undefined;
}) {
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [mobileFallback, setMobileFallback] = useState(false);
  const family =
    theme === "light"
      ? LOGIN_SCENE_FAMILIES.desktopLight
      : LOGIN_SCENE_FAMILIES.desktopDark;
  const mobile = theme === "light" ? family : SIGNUP_MOBILE_DARK_ART;
  const fallbackArt = mobileFallback ? mobile : family;
  const assetUrl = (prefix: string, width: number, format: "avif" | "webp") => {
    const asset = `${prefix}${width}-v1.${format}`;
    return attempt === 0 ? asset : `${asset}?signup-art-retry=${attempt}`;
  };
  return (
    <div
      className={className}
      data-signup-art-theme={theme}
      data-signup-art-state={failed ? "unavailable" : "ready"}
    >
      {!failed ? (
        <picture key={attempt}>
          {!fallback
            ? (["avif", "webp"] as const).map((format) => (
                <source
                  key={`mobile-${format}`}
                  media="(max-width: 699px)"
                  type={`image/${format}`}
                  srcSet={mobile.widths
                    .map(
                      (width) =>
                        `${assetUrl(mobile.prefix, width, format)} ${width}w`,
                    )
                    .join(", ")}
                  sizes="100vw"
                />
              ))
            : null}
          {!fallback
            ? (["avif", "webp"] as const).map((format) => (
                <source
                  key={format}
                  type={`image/${format}`}
                  srcSet={family.widths
                    .map(
                      (width) =>
                        `${assetUrl(family.prefix, width, format)} ${width}w`,
                    )
                    .join(", ")}
                  sizes="100vw"
                />
              ))
            : null}
          <img
            src={assetUrl(
              fallback ? fallbackArt.prefix : family.prefix,
              fallback && mobileFallback && theme === "dark" ? 640 : 960,
              "webp",
            )}
            width={fallback ? fallbackArt.width : family.width}
            height={fallback ? fallbackArt.height : family.height}
            alt=""
            aria-hidden="true"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onError={() => {
              if (fallback) {
                setFailed(true);
              } else {
                setMobileFallback(
                  window.matchMedia("(max-width: 699px)").matches,
                );
                setFallback(true);
              }
            }}
          />
        </picture>
      ) : (
        <div role="status" data-signup-art-recovery>
          <p>배경을 불러오지 못했어요.</p>
          <button
            type="button"
            onClick={() => {
              setFallback(false);
              setMobileFallback(false);
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            배경 다시 보기
          </button>
        </div>
      )}
    </div>
  );
}

export function SignupArtwork({
  className,
}: {
  className?: string | undefined;
}) {
  const theme = useResolvedTheme();
  return <Artwork key={theme} theme={theme} className={className} />;
}
