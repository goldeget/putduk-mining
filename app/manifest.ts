import type { MetadataRoute } from "next";
import { WORKROOM_PWA_ICONS, WORKROOM_MARK } from "@/components/workroom/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WORKROOM",
    short_name: "WORKROOM",
    description: "무료 시뮬레이션 · 체험 포인트 현금 전환 불가",
    start_url: "/workroom",
    display: "standalone",
    background_color: WORKROOM_MARK.background,
    theme_color: "#0b1220",
    lang: "ko-KR",
    orientation: "portrait-primary",
    categories: ["education", "utilities"],
    icons: WORKROOM_PWA_ICONS,
  };
}
