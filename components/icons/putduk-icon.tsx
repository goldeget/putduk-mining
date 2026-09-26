import type { SVGProps } from "react";

export type PutdukIconName =
  | "ai"
  | "arrow-right"
  | "bell"
  | "clock"
  | "event"
  | "home"
  | "menu"
  | "mining"
  | "pulse"
  | "shield"
  | "user"
  | "wallet";

type PutdukIconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  label?: string;
  name: PutdukIconName;
  size?: number;
};

const paths: Record<PutdukIconName, React.ReactNode> = {
  ai: (
    <>
      <path d="M12 3.75 19 7.8v8.4L12 20.25 5 16.2V7.8L12 3.75Z" />
      <path d="M8.6 10.25h6.8M9.5 14h5M9 8.25l1.2 2M15 8.25l-1.2 2" />
    </>
  ),
  "arrow-right": (
    <>
      <path d="M5 12h13" />
      <path d="m14 7 5 5-5 5" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 10.25a5.5 5.5 0 0 1 11 0v4.5l1.5 2H5l1.5-2v-4.5Z" />
      <path d="M10 19a2.3 2.3 0 0 0 4 0" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  event: (
    <>
      <path d="M6.5 4.75h11v14.5h-11z" />
      <path d="M9 3.5v2.75M15 3.5v2.75M9.25 10h5.5M9.25 14h3.5" />
    </>
  ),
  home: (
    <>
      <path d="m4.25 10.5 7.75-6 7.75 6" />
      <path d="M6.5 9.25v10h11v-10M10 19.25v-5h4v5" />
    </>
  ),
  menu: (
    <>
      <path d="M5 7h14M5 12h14M5 17h9" />
      <circle cx="18" cy="17" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  mining: (
    <>
      <path d="m7 18 8.8-8.8M13.75 6.5l3.75 3.75M11 4.75c3.2-.8 6 .1 8.25 2.75L17.5 9.25" />
      <path d="m5 17 2 2" />
    </>
  ),
  pulse: (
    <>
      <path d="M3.5 12h4l2-5.5 4 11 2-5.5h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.4-2.8 7.25-7 9-4.2-1.75-7-4.6-7-9V6l7-2.5Z" />
      <path d="m8.75 12 2.1 2.1 4.4-4.4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 19.25c.8-3.3 3-5 6.5-5s5.7 1.7 6.5 5" />
    </>
  ),
  wallet: (
    <>
      <path d="M4.5 7.25h13a2 2 0 0 1 2 2v8.5H6a1.5 1.5 0 0 1-1.5-1.5v-9Z" />
      <path d="M4.5 7.25 15 4.5v2.75M15.5 12h4M15.5 12h-2" />
    </>
  ),
};

export function PutdukIcon({
  label,
  name,
  size = 24,
  ...props
}: PutdukIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
