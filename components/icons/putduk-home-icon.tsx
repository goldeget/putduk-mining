import { useId, type SVGProps } from "react";

export type PutdukHomeIconName =
  | "chart"
  | "crown"
  | "coins"
  | "capacity"
  | "bolt"
  | "bank"
  | "wallet"
  | "gift"
  | "cube"
  | "more"
  | "home"
  | "ledger";

/** Native geometry from the approved home references; no economic meaning. */
export function PutdukHomeIcon({
  name,
  size = 28,
  label,
  metallic = true,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: PutdukHomeIconName;
  size?: number;
  label?: string;
  metallic?: boolean;
}) {
  const paintId = useId().replaceAll(":", "");
  const gold = metallic ? `url(#${paintId})` : "currentColor";
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      {...props}
    >
      <defs>
        <linearGradient
          id={paintId}
          x1="4"
          y1="4"
          x2="27"
          y2="30"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff2b7" />
          <stop offset="0.36" stopColor="#f0cc7c" />
          <stop offset="0.65" stopColor="#b18436" />
          <stop offset="0.82" stopColor="#f5d587" />
          <stop offset="1" stopColor="#b17e2c" />
        </linearGradient>
      </defs>
      {name === "chart" ? (
        <g fill={gold}>
          <path d="M5 18h5v11H5zM14 11h5v18h-5zM23 4h5v25h-5z" />
        </g>
      ) : null}
      {name === "crown" ? (
        <g>
          <path d="m4 10 5 5 7-10 7 10 5-5-3 14H7L4 10Z" fill={gold} />
          <path d="M8 27h16" />
          <circle cx="4" cy="9" r="1.5" fill={gold} />
          <circle cx="16" cy="4" r="1.5" fill={gold} />
          <circle cx="28" cy="9" r="1.5" fill={gold} />
        </g>
      ) : null}
      {name === "coins" ? (
        <g fill={gold}>
          <path d="M4 18v8c0 2 4 3 8 3s8-1 8-3v-8" />
          <ellipse cx="12" cy="18" rx="8" ry="3" />
          <path d="M18 6v7c0 2 3 3 6 3s6-1 6-3V6" />
          <ellipse cx="24" cy="6" rx="6" ry="3" />
          <path d="M5 23c4 2 10 2 14 0M19 10c3 1 6 1 10 0" stroke="#70551f" />
        </g>
      ) : null}
      {name === "capacity" ? (
        <g>
          <circle cx="16" cy="16" r="12" />
          <path d="M9 20V15h3v5M15 20V11h3v9M21 20V7h3v13" fill={gold} />
        </g>
      ) : null}
      {name === "bolt" ? (
        <path d="m19 2-14 17h9l-2 11 15-19h-9l1-9Z" fill={gold} />
      ) : null}
      {name === "bank" ? (
        <g fill={gold}>
          <path d="m2 11 14-8 14 8H2ZM4 26h24v3H4zM6 14h3v10H6zM14 14h4v10h-4zM23 14h3v10h-3z" />
        </g>
      ) : null}
      {name === "wallet" ? (
        <g>
          <path d="M4 9h22a3 3 0 0 1 3 3v14H6a2 2 0 0 1-2-2V9Z" fill={gold} />
          <path d="m4 9 19-5v5M23 17h6v6h-6a3 3 0 0 1 0-6Z" />
          <circle cx="23" cy="20" r="0.7" fill="#654921" stroke="none" />
        </g>
      ) : null}
      {name === "gift" ? (
        <g>
          <path d="M4 14h24v5H4zM6 19h20v11H6z" fill={gold} />
          <path d="M16 14v16M16 13C7 13 5 7 8 5c4-3 8 2 8 8ZM16 13c9 0 11-6 8-8-4-3-8 2-8 8Z" />
        </g>
      ) : null}
      {name === "cube" ? (
        <g>
          <path d="m16 3 12 7v14l-12 7L4 24V10L16 3Z" />
          <path d="m4 10 12 7 12-7M16 17v14" />
        </g>
      ) : null}
      {name === "more" ? (
        <g fill="currentColor" stroke="none">
          <circle cx="6" cy="16" r="2" />
          <circle cx="16" cy="16" r="2" />
          <circle cx="26" cy="16" r="2" />
        </g>
      ) : null}
      {name === "home" ? (
        <g>
          <path d="m3 14 13-11 13 11M7 11v18h18V11M13 29V19h6v10" />
        </g>
      ) : null}
      {name === "ledger" ? (
        <g>
          <rect x="6" y="3" width="20" height="27" rx="2" fill={gold} />
          <path
            d="M10 9h3m4 0h5M10 15h3m4 0h5M10 21h3m4 0h5"
            stroke="var(--surface-default)"
            strokeWidth="2"
          />
        </g>
      ) : null}
    </svg>
  );
}
