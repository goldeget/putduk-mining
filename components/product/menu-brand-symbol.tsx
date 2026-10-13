import { BrandMark } from "@/components/brand/brand-mark";

/** Compatible presentation wrapper; the canonical silhouette has no SVG paint IDs. */
export function MenuBrandSymbol({
  className,
  idPrefix = "menu-hero-brand",
}: {
  className?: string;
  idPrefix?: string;
}) {
  return (
    <BrandMark title="" className={className} data-brand-placement={idPrefix} />
  );
}
