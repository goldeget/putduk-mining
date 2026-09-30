export const designTokens = {
  background: {
    canvas: "#070706",
    subtle: "#0e0c09",
    elevated: "#15120d",
  },
  surface: {
    default: "#15120d",
    raised: "#1d1811",
    sunken: "#0a0907",
    interactive: "#241c11",
  },
  text: {
    primary: "#f8f2e4",
    secondary: "#b8ad98",
    tertiary: "#b0a38c",
    inverse: "#17130d",
  },
  border: {
    subtle: "rgba(246, 224, 174, 0.09)",
    default: "rgba(246, 224, 174, 0.32)",
    strong: "rgba(246, 200, 91, 0.36)",
    control: "rgba(246, 224, 174, 0.48)",
  },
  brand: {
    primary: "#f6c85b",
    strong: "#d99a2b",
    hover: "#ffdb83",
    active: "#e6b340",
    quiet: "#3a2810",
    mineral: "#fff0a6",
  },
  status: {
    success: "#65d8a8",
    warning: "#e5b76a",
    danger: "#f08177",
    info: "#79b8e8",
  },
  world: {
    korea: "#f6c85b",
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
    canvas: "#f8f4ea",
    subtle: "#f1eadb",
    elevated: "#fffdf8",
  },
  surface: {
    default: "#fffdf8",
    raised: "#ffffff",
    sunken: "#eee5d4",
    interactive: "#f5ead0",
  },
  text: {
    primary: "#17130d",
    secondary: "#605643",
    tertiary: "#6f614b",
    inverse: "#fffdf8",
  },
  status: {
    success: "#176444",
    warning: "#76510b",
    danger: "#ac332b",
    info: "#1f5d88",
  },
  world: {
    korea: "#9b650d",
    usa: "#225f98",
    gold: "#806018",
    silver: "#52616b",
    crypto: "#6650a5",
  },
  brand: {
    primary: "#9b650d",
    strong: "#7c4b06",
    hover: "#7c4b06",
    active: "#633b03",
    quiet: "#f0ddb0",
    mineral: "#b77a17",
  },
} as const;

export type DesignTokens = typeof designTokens;
