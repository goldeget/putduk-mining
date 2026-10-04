import type { MetadataRoute } from "next";

import { PRIVATE_ROBOTS_DISALLOW } from "@/lib/trust/public-discovery";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_ROBOTS_DISALLOW],
    },
    sitemap: "https://mining.putduk.com/sitemap.xml",
    host: "https://mining.putduk.com",
  };
}
