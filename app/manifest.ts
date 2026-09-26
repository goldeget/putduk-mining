import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "퍼뜩 채굴",
    short_name: "퍼뜩 채굴",
    description: "서버 권위형 가상 채굴과 원장 기반 자산 경험",
    start_url: "/",
    display: "standalone",
    background_color: "#070a0d",
    theme_color: "#070a0d",
    lang: "ko-KR",
    orientation: "portrait-primary",
    categories: ["finance", "business", "utilities"],
    icons: [
      {
        src: "/icons/putduk-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
