import type { SVGProps } from "react";
import {
  PUTDUK_BRAND_VERSION,
  PUTDUK_SYMBOL_PATH,
  PUTDUK_SYMBOL_VIEW_BOX,
} from "./putduk-symbol";

type BrandMarkProps = SVGProps<SVGSVGElement> & { title?: string };

/** One small monochrome silhouette; inherited color follows every resolved theme. */
export function BrandMark({
  title = "퍼뜩 채굴",
  style,
  ...props
}: BrandMarkProps) {
  return (
    <svg
      viewBox={PUTDUK_SYMBOL_VIEW_BOX}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title || undefined}
      focusable="false"
      fill="none"
      data-putduk-brand="canonical"
      data-putduk-brand-version={PUTDUK_BRAND_VERSION}
      data-putduk-brand-render="monochrome"
      {...props}
      style={{ color: "var(--brand-identity, var(--brand-primary))", ...style }}
    >
      {title ? <title>{title}</title> : null}
      <path d={PUTDUK_SYMBOL_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
