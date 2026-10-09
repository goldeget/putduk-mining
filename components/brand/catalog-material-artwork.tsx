import type { ProductCategory } from "@/domain/products/published-catalog";

const materialFamilies = {
  KR_STOCK: "semiconductor",
  US_STOCK: "semiconductor",
  SILVER: "silver",
  CRYPTO: "digital-asset",
} as const;
const widths = [320, 640, 960, 1536];

/** Neutral category materials; names, facts and disclosures remain live HTML. */
export function CatalogMaterialArtwork({
  category,
  sizes = "(min-width: 980px) 220px, 33vw",
}: {
  category: Exclude<ProductCategory, "GOLD">;
  sizes?: string;
}) {
  const family = materialFamilies[category];
  const prefix = `/brand/catalog-materials/${family}/${family}-`;
  return (
    <picture data-material-artwork={family}>
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
