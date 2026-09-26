import type { SVGProps } from "react";

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

export function BrandMark({ title = "PUTDUK", ...props }: BrandMarkProps) {
  const titleId = title ? "putduk-brand-title" : undefined;

  return (
    <svg
      viewBox="0 0 128 128"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-labelledby={titleId}
      fill="none"
      {...props}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <path
        fill="currentColor"
        d="M61 31C43 30 31 19 30 5c17-1 29 8 34 22C68 13 80 4 97 6c-2 14-14 25-31 25v13h-5V31Z"
      />
      <path
        fill="currentColor"
        d="M22 75c0-24 18-43 42-43s42 19 42 43v25H22V75Z"
      />
      <rect
        x="29"
        y="58"
        width="70"
        height="48"
        rx="22"
        fill="#050607"
        stroke="currentColor"
        strokeWidth="4"
      />
      <ellipse cx="54" cy="81" rx="6" ry="12" fill="#fffdf7" />
      <path
        d="m81 74-11 7 11 7"
        fill="none"
        stroke="#fffdf7"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="7"
      />
      <circle
        cx="100"
        cy="52"
        r="16"
        fill="#17130c"
        stroke="currentColor"
        strokeWidth="5"
      />
      <circle cx="100" cy="52" r="8" fill="#fff7d0" />
    </svg>
  );
}
