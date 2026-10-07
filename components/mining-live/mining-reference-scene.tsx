"use client";

import { useState } from "react";

import { useResolvedTheme } from "@/lib/design/use-resolved-theme";

/** Decorative source families require the independent producer's manifest gate before activation. */
export const MINING_REFERENCE_ART = {
  mobileDark: {
    prefix:
      "/brand/scenes/mining-semiconductor-mobile-dark/mining-semiconductor-mobile-dark-",
    widths: [480, 640, 941],
  },
  mobileLight: {
    prefix:
      "/brand/scenes/mining-semiconductor-mobile-light/mining-semiconductor-mobile-light-",
    widths: [480, 640, 1086],
  },
  desktopDark: {
    prefix:
      "/brand/scenes/mining-semiconductor-desktop-dark/mining-semiconductor-desktop-dark-",
    widths: [960, 1280, 1536, 1920],
  },
  desktopLight: {
    prefix:
      "/brand/scenes/mining-semiconductor-desktop-light/mining-semiconductor-desktop-light-",
    widths: [960, 1280, 1536, 1920],
  },
} as const;

function Artwork({
  theme,
  className,
  running,
}: {
  theme: "dark" | "light";
  className?: string | undefined;
  running: boolean;
}) {
  const [sourcesFailed, setSourcesFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const desktop =
    theme === "light"
      ? MINING_REFERENCE_ART.desktopLight
      : MINING_REFERENCE_ART.desktopDark;
  const mobile =
    theme === "light"
      ? MINING_REFERENCE_ART.mobileLight
      : MINING_REFERENCE_ART.mobileDark;
  return (
    <div
      className={className}
      data-scene-art={unavailable ? "unavailable" : "ready"}
      data-scene-theme={theme}
      data-mining-running={running ? "true" : "false"}
      data-motion="static"
    >
      {!unavailable ? (
        <picture key={attempt}>
          {!sourcesFailed ? (
            <>
              {(["avif", "webp"] as const).map((format) => (
                <source
                  key={`mobile-${format}`}
                  media="(max-width: 699px)"
                  type={`image/${format}`}
                  srcSet={mobile.widths
                    .map(
                      (width) =>
                        `${mobile.prefix}${width}-v1.${format} ${width}w`,
                    )
                    .join(", ")}
                  sizes="100vw"
                />
              ))}
              {(["avif", "webp"] as const).map((format) => (
                <source
                  key={`desktop-${format}`}
                  type={`image/${format}`}
                  srcSet={desktop.widths
                    .map(
                      (width) =>
                        `${desktop.prefix}${width}-v1.${format} ${width}w`,
                    )
                    .join(", ")}
                  sizes="max(100vw, 1550px)"
                />
              ))}
            </>
          ) : null}
          <img
            src={`${desktop.prefix}960-v1.webp`}
            width={1983}
            height={793}
            alt=""
            aria-hidden="true"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onError={() => {
              if (!sourcesFailed) setSourcesFailed(true);
              else setUnavailable(true);
            }}
          />
        </picture>
      ) : (
        <div role="status" data-mining-art-recovery>
          <p>배경을 불러오지 못했어요.</p>
          <button
            type="button"
            onClick={() => {
              setSourcesFailed(false);
              setUnavailable(false);
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

/** A static scene does not imply accrual. The running hint comes only from the server-owned page. */
export function MiningReferenceScene({
  running,
  className,
}: {
  running: boolean;
  className?: string | undefined;
}) {
  const theme = useResolvedTheme();
  return (
    <Artwork
      key={theme}
      theme={theme}
      running={running}
      className={className}
    />
  );
}
