import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/auth/",
        "/login",
        "/signup",
        "/find-id",
        "/recover",
        "/home",
        "/start",
        "/mining",
        "/wallet/",
        "/events",
        "/notifications",
        "/ai$",
        "/menu/",
      ],
    },
    sitemap: "https://mining.putduk.com/sitemap.xml",
    host: "https://mining.putduk.com",
  };
}
