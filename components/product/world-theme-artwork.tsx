import styles from "./world-theme-artwork.module.css";

type WorldTheme = "korea" | "usa" | "gold" | "silver" | "digital";

/** Visual identity only. Unknown server codes never become an available world. */
export function resolveWorldThemeArtwork(
  worldCode: unknown,
): WorldTheme | null {
  switch (worldCode) {
    case "KOREA":
      return "korea";
    case "USA":
      return "usa";
    case "GOLD":
      return "gold";
    case "SILVER":
      return "silver";
    case "CRYPTO":
      return "digital";
    default:
      return null;
  }
}

/** Decorative composition; the adjacent server-provided world name is its label. */
export function WorldThemeArtwork({ worldCode }: { worldCode: string }) {
  const theme = resolveWorldThemeArtwork(worldCode);
  if (!theme) return null;
  const base = `/brand/scenes/world-collection/${theme}`;
  return (
    <picture className={styles.artwork} data-world-theme-artwork={theme}>
      <source
        type="image/avif"
        srcSet={`${base}-320-v1.avif 320w, ${base}-640-v1.avif 640w`}
        sizes="112px"
      />
      <img
        src={`${base}-320-v1.webp`}
        srcSet={`${base}-320-v1.webp 320w, ${base}-640-v1.webp 640w`}
        sizes="112px"
        width={320}
        height={213}
        alt=""
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
}
