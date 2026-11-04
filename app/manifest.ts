import type { MetadataRoute } from "next";
import { WORKROOM_ICON } from "@/components/workroom/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WORKROOM",
    short_name: "WORKROOM",
    description: "무료 시뮬레이션 · 체험 포인트 현금 전환 불가",
    start_url: "/workroom",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    lang: "ko-KR",
    orientation: "portrait-primary",
    categories: ["education", "utilities"],
    icons: [
      {
        src: WORKROOM_ICON,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
