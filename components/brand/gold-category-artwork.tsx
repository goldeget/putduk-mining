const prefix = "/brand/scenes/gold-category/gold-category-";
const widths = [320, 640, 960, 1536];

/** Neutral GOLD category decoration. Product facts remain live HTML. */
export function GoldCategoryArtwork({
  sizes = "(min-width: 980px) 300px, 33vw",
}: {
  sizes?: string;
}) {
  return (
    <picture>
      <source
        type="image/avif"
        srcSet={widths
          .map((width) => `${prefix}${width}-v1.avif ${width}w`)
          .join(", ")}
        sizes={sizes}
      />
      <img
        alt=""
        aria-hidden="true"
        width={1536}
        height={1024}
        loading="lazy"
        decoding="async"
        src={`${prefix}320-v1.webp`}
        srcSet={widths
          .map((width) => `${prefix}${width}-v1.webp ${width}w`)
          .join(", ")}
        sizes={sizes}
      />
    </picture>
  );
}
