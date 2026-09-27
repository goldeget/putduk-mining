import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "퍼뜩 채굴",
    short_name: "퍼뜩 채굴",
    description: "앱을 닫아도 이어지고, 돌아오면 결과를 확인하는 채굴 경험",
    start_url: "/",
    display: "standalone",
    background_color: "#070706",
    theme_color: "#070706",
    lang: "ko-KR",
    orientation: "portrait-primary",
    categories: ["finance", "business", "utilities"],
    icons: [
      {
        src: "/brand/pwa/putduk-pwa-dark-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pwa/putduk-pwa-dark-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/pwa/putduk-pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
