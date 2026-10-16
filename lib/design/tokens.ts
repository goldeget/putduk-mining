export const designTokens = {
  background: {
    canvas: "#020a14",
    subtle: "#07111d",
    elevated: "#0d1a28",
  },
  surface: {
    default: "#0b1724",
    raised: "#101e2d",
    sunken: "#040a12",
    interactive: "#16263a",
  },
  text: {
    primary: "#f1f4f7",
    secondary: "#b7c3d0",
    tertiary: "#97a5b5",
    inverse: "#17130d",
  },
  border: {
    subtle: "rgba(163, 187, 214, 0.1)",
    default: "rgba(145, 173, 205, 0.3)",
    strong: "rgba(246, 200, 91, 0.42)",
    control: "rgba(163, 187, 214, 0.52)",
  },
  brand: {
    primary: "#f4c76c",
    strong: "#c58b35",
    hover: "#ffdc91",
    active: "#dcaa50",
    quiet: "#2b251c",
    mineral: "#fff1bf",
  },
  action: {
    primaryBackground:
      "linear-gradient(180deg, #ffe3a5 0%, #f1bd60 48%, #c98a30 100%)",
    primaryHover:
      "linear-gradient(180deg, #fff0c7 0%, #ffcf75 48%, #dda342 100%)",
    primaryActive: "linear-gradient(180deg, #e6ad4f 0%, #c98a30 100%)",
    primaryForeground: "#24180b",
    primaryBorder: "#f5d68d",
    primaryShadow: "0 6px 18px rgba(225, 168, 69, 0.24)",
  },
  status: {
    success: "#65d8a8",
    warning: "#e5b76a",
    danger: "#f08177",
    info: "#79b8e8",
  },
  world: {
    korea: "#f4c76c",
    usa: "#78aee8",
    gold: "#d9b873",
    silver: "#b9c4ca",
    crypto: "#a28ce8",
  },
  spacing: {
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    5: "1.25rem",
    6: "1.5rem",
    8: "2rem",
    10: "2.5rem",
    12: "3rem",
    16: "4rem",
    20: "5rem",
  },
  radius: {
    sm: "0.5rem",
    md: "0.75rem",
    lg: "1.125rem",
    xl: "1.5rem",
    full: "999px",
  },
  shadow: {
    lift: "0 18px 60px rgba(0, 0, 0, 0.28)",
    focus: "0 0 0 2px var(--background-canvas), 0 0 0 5px var(--brand-primary)",
  },
  motion: {
    fast: "140ms",
    standard: "220ms",
    slow: "420ms",
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },
  zIndex: {
    base: 0,
    raised: 10,
    navigation: 40,
    modal: 60,
    toast: 80,
  },
} as const;

export const lightThemeTokens = {
  background: {
    canvas: "#f8f8f8",
    subtle: "#eff1f3",
    elevated: "#ffffff",
  },
  surface: {
    default: "#ffffff",
    raised: "#ffffff",
    sunken: "#f0f2f4",
    interactive: "#f7f0e2",
  },
  text: {
    primary: "#161b21",
    secondary: "#58616b",
    tertiary: "#717b86",
    inverse: "#fffdf8",
  },
  status: {
    success: "#176444",
    warning: "#76510b",
    danger: "#ac332b",
    info: "#1f5d88",
  },
  world: {
    korea: "#94600f",
    usa: "#225f98",
    gold: "#806018",
    silver: "#52616b",
    crypto: "#6650a5",
  },
  brand: {
    primary: "#94600f",
    strong: "#744b0b",
    hover: "#825408",
    active: "#693f06",
    quiet: "#f6ead0",
    mineral: "#a8731c",
  },
  action: {
    primaryBackground:
      "linear-gradient(180deg, #ffe9b7 0%, #e9b75b 48%, #ca8b30 100%)",
    primaryHover:
      "linear-gradient(180deg, #fff2d4 0%, #f5ca78 48%, #d9a246 100%)",
    primaryActive: "linear-gradient(180deg, #dda84e 0%, #bd7d25 100%)",
    primaryForeground: "#24180b",
    primaryBorder: "#d7a64f",
    primaryShadow: "0 5px 16px rgba(125, 83, 17, 0.18)",
  },
} as const;

export type DesignTokens = typeof designTokens;
