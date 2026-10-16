"use client";

import { useResolvedTheme } from "@/lib/design/use-resolved-theme";

/** The producer must confirm these families before this staged presentation is applied. */
export const LOGIN_SCENE_FAMILIES = {
  mobileDark: {
    prefix: "/brand/scenes/login-wafer-dark/login-wafer-dark-",
    widths: [480, 640, 941],
    width: 941,
    height: 1672,
  },
  desktopDark: {
    prefix: "/brand/scenes/login-semiconductor-dark/login-semiconductor-dark-",
    widths: [960, 1280, 1536, 1920],
    width: 1983,
    height: 793,
  },
  desktopLight: {
    prefix:
      "/brand/scenes/login-semiconductor-light/login-semiconductor-light-",
    widths: [960, 1280, 1536, 1920],
    width: 1983,
    height: 793,
  },
} as const;

export function LoginArtwork({
  className,
}: {
  className?: string | undefined;
}) {
  const theme = useResolvedTheme();
  const desktop =
    theme === "light"
      ? LOGIN_SCENE_FAMILIES.desktopLight
      : LOGIN_SCENE_FAMILIES.desktopDark;
  const mobile =
    theme === "light"
      ? LOGIN_SCENE_FAMILIES.desktopLight
      : LOGIN_SCENE_FAMILIES.mobileDark;
  return (
    <picture className={className} data-login-art-theme={theme}>
      {(["avif", "webp"] as const).map((format) => (
        <source
          key={`mobile-${format}`}
          media="(max-width: 1099px)"
          type={`image/${format}`}
          srcSet={mobile.widths
            .map((width) => `${mobile.prefix}${width}-v1.${format} ${width}w`)
            .join(", ")}
          sizes="100vw"
        />
      ))}
      {(["avif", "webp"] as const).map((format) => (
        <source
          key={`desktop-${format}`}
          type={`image/${format}`}
          srcSet={desktop.widths
            .map((width) => `${desktop.prefix}${width}-v1.${format} ${width}w`)
            .join(", ")}
          sizes="100vw"
        />
      ))}
      <img
        src={`${desktop.prefix}960-v1.webp`}
        width={desktop.width}
        height={desktop.height}
        alt=""
        aria-hidden="true"
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
    </picture>
  );
}

export function LoginHeading({
  id,
  className,
}: {
  id: string;
  className?: string | undefined;
}) {
  const theme = useResolvedTheme();
  return (
    <h1 id={id} className={className} aria-label="로그인">
      {theme === "light" ? "환영합니다!" : "로그인"}
    </h1>
  );
}
