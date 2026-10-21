import type { MetadataRoute } from "next";
import { APP_MANIFEST_ICONS } from "@/lib/design/app-icons";
import { PUBLIC_SITE_ORIGIN } from "@/lib/trust/public-discovery";

export default function manifest(): MetadataRoute.Manifest {
  const officialWebsite = PUBLIC_SITE_ORIGIN === "https://putduk.com";
  return {
    id: "/",
    name: officialWebsite ? "퍼뜩 공식 홈페이지" : "퍼뜩 채굴",
    short_name: officialWebsite ? "퍼뜩" : "퍼뜩 채굴",
    description: officialWebsite
      ? "퍼뜩 서비스 소개와 이용 안내를 확인하는 공식 홈페이지"
      : "앱을 닫아도 이어지고, 돌아오면 결과를 확인하는 채굴 경험",
    start_url: "/",
    scope: "/",
    display: officialWebsite ? "browser" : "standalone",
    background_color: "#020a14",
    theme_color: "#020a14",
    lang: "ko-KR",
    orientation: "any",
    categories: ["finance", "business", "utilities"],
    icons: APP_MANIFEST_ICONS,
  };
}
