export const designTokens = {
  background: {
    canvas: "#070a0d",
    subtle: "#0b1015",
    elevated: "#10171e",
  },
  surface: {
    default: "#111920",
    raised: "#172129",
    sunken: "#0b1116",
    interactive: "#1b272f",
  },
  text: {
    primary: "#f4f7f5",
    secondary: "#aab6b1",
    tertiary: "#74817c",
    inverse: "#07110d",
  },
  border: {
    subtle: "rgba(221, 235, 229, 0.09)",
    default: "rgba(221, 235, 229, 0.16)",
    strong: "rgba(221, 235, 229, 0.28)",
  },
  brand: {
    primary: "#7ce7bd",
    strong: "#48c99a",
    quiet: "#173a2f",
    mineral: "#d9b873",
  },
  status: {
    success: "#65d8a8",
    warning: "#e5b76a",
    danger: "#f08177",
    info: "#79b8e8",
  },
  world: {
    korea: "#7ce7bd",
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
    focus: "0 0 0 3px rgba(124, 231, 189, 0.3)",
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

export type DesignTokens = typeof designTokens;
