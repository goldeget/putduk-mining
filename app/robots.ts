import type { MetadataRoute } from "next";

import {
  PRIVATE_ROBOTS_DISALLOW,
  PUBLIC_SITE_ORIGIN,
} from "@/lib/trust/public-discovery";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...PRIVATE_ROBOTS_DISALLOW],
    },
    sitemap: `${PUBLIC_SITE_ORIGIN}/sitemap.xml`,
    host: PUBLIC_SITE_ORIGIN,
  };
}
