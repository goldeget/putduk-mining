/** Reference-shaped metal portal. Each placement owns its SVG paint namespace. */
export function MenuBrandSymbol({
  className,
  idPrefix = "menu-hero-brand",
}: {
  className?: string;
  idPrefix?: string;
}) {
  const paint = (name: string) => `url(#${idPrefix}-${name})`;
  return (
    <svg
      className={className}
      viewBox="0 0 40 56"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${idPrefix}-crown`}
          x1="3"
          y1="9"
          x2="33"
          y2="9"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#b77a26" />
          <stop offset=".28" stopColor="#fff8ce" />
          <stop offset=".55" stopColor="#f1c46b" />
          <stop offset=".8" stopColor="#ffedac" />
          <stop offset="1" stopColor="#be852c" />
        </linearGradient>
        <linearGradient
          id={`${idPrefix}-frame`}
          x1="3"
          y1="30"
          x2="19"
          y2="30"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#edbb5a" />
          <stop offset=".18" stopColor="#fff2b0" />
          <stop offset=".4" stopColor="#a56a1d" />
          <stop offset=".72" stopColor="#583913" />
          <stop offset="1" stopColor="#ffe39b" />
        </linearGradient>
        <linearGradient
          id={`${idPrefix}-face`}
          x1="20"
          y1="17"
          x2="37"
          y2="46"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff4b4" />
          <stop offset=".3" stopColor="#e7ae42" />
          <stop offset=".62" stopColor="#a16a20" />
          <stop offset=".82" stopColor="#f4c467" />
          <stop offset="1" stopColor="#fff0af" />
        </linearGradient>
        <linearGradient
          id={`${idPrefix}-well`}
          x1="11"
          y1="17"
          x2="15"
          y2="46"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#080e17" />
          <stop offset=".7" stopColor="#292316" />
          <stop offset="1" stopColor="#8c6122" />
        </linearGradient>
        <linearGradient
          id={`${idPrefix}-bevel`}
          x1="10"
          y1="17"
          x2="18"
          y2="50"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff5bd" />
          <stop offset=".4" stopColor="#c78a2f" />
          <stop offset=".72" stopColor="#fff0a7" />
          <stop offset="1" stopColor="#b6751b" />
        </linearGradient>
      </defs>
      <path d="M3 10 21 1l16 8-18 9L3 10Z" fill={paint("crown")} />
      <path d="M3 10v36l16 9V18L3 10Z" fill={paint("frame")} />
      <path d="m19 18 18-9v37l-18 9V18Z" fill={paint("face")} />
      <path d="m8 17 7 4v24l-7-4V17Z" fill={paint("well")} />
      <path d="m15 19 4-1v37l-4-10V19Z" fill={paint("bevel")} />
      <path d="m21 21 13-8-8 23-5-15Z" fill="#fff1ae" opacity=".75" />
      <path d="m26 36 8-23v29l-8-6Z" fill="#b37625" opacity=".65" />
      <path d="m21 21 5 15-5 14V21Z" fill="#a56a23" opacity=".48" />
      <path d="m26 36 8 6-13 8 5-14Z" fill="#ffe6a3" opacity=".55" />
      <path
        d="m3 10 18-9 16 8v37l-18 9-16-9V10Z"
        stroke="#ffe6a5"
        strokeWidth=".65"
      />
      <path
        d="m4 11 15 8v34M19 19 36 10M20 53l16-8"
        stroke="#fff4c7"
        strokeWidth=".55"
        opacity=".85"
      />
      <path
        d="m21 21 5 15 8-23M26 36l-5 14 13-8"
        stroke="#ffe49a"
        strokeWidth=".35"
        opacity=".8"
      />
      <path
        d="M5 11v32M9 18v22"
        stroke="#fff8d8"
        strokeWidth=".5"
        opacity=".65"
      />
    </svg>
  );
}
