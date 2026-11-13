import type { MetadataRoute } from "next";
import { WORKROOM_PWA_ICONS } from "../../../components/workroom/brand";
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "WORKROOM ADMIN",
    short_name: "WORKROOM 운영",
    description: "WORKROOM 운영자 지원 및 알림",
    start_url: "/notifications",
    scope: "/",
    display: "standalone",
    background_color: "#0b1220",
    theme_color: "#0b1220",
    lang: "ko-KR",
    icons: WORKROOM_PWA_ICONS,
  };
}
