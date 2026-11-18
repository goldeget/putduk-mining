import type { MetadataRoute } from "next";
import { WORKROOM_PWA_ICONS, WORKROOM_MARK } from "@/components/workroom/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WORKROOM",
    short_name: "WORKROOM",
    description: "모니터링 기록과 실제 잔액을 관리하는 WORKROOM",
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
