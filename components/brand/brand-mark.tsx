import type { SVGProps } from "react";

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

export function BrandMark({ title = "PUTDUK", ...props }: BrandMarkProps) {
  const titleId = title ? "putduk-brand-title" : undefined;

  return (
    <svg
      viewBox="0 0 44 44"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-labelledby={titleId}
      fill="none"
      {...props}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <path
        d="M22 3.75 37.8 12.9v18.2L22 40.25 6.2 31.1V12.9L22 3.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m22 9.5 10.8 6.2v12.6L22 34.5l-10.8-6.2V15.7L22 9.5Z"
        fill="currentColor"
        fillOpacity=".12"
      />
      <path
        d="M14.6 25.4V18l7.4-4.2 7.4 4.2v5.6L22 27.8l-3.7-2.1v4.2"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="29.4" cy="29.2" r="2.1" fill="currentColor" />
    </svg>
  );
}
