import type { SVGProps } from "react";
import {
  PUTDUK_BRAND_VERSION,
  PUTDUK_SYMBOL_PATH,
  PUTDUK_SYMBOL_VIEW_BOX,
} from "./putduk-symbol";

type BrandMarkProps = SVGProps<SVGSVGElement> & { title?: string };

/** One original silhouette across every size; repeated placements create no duplicate IDs. */
export function BrandMark({
  title = "PUTDUK MINING",
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
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d={PUTDUK_SYMBOL_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
