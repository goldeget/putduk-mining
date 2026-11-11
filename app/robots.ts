import type { MetadataRoute } from "next";

import { PRIVATE_ROBOTS_DISALLOW } from "@/lib/trust/public-discovery";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_ROBOTS_DISALLOW],
    },
    sitemap: "https://workroom.putduk.com/sitemap.xml",
    host: "https://workroom.putduk.com",
  };
}
