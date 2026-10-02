import localFont from "next/font/local";

export const putdukFont = localFont({
  src: "../../assets/fonts/PretendardVariable.woff2",
  variable: "--font-putduk",
  weight: "45 930",
  display: "swap",
  preload: true,
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "Arial", "sans-serif"],
});
