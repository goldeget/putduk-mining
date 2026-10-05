import type { MetadataRoute } from "next";

import {
  PUBLIC_DISCOVERY_LAST_MODIFIED,
  PUBLIC_DISCOVERY_PATHS,
  toPublicUrl,
} from "@/lib/trust/public-discovery";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_DISCOVERY_PATHS.map((path) => ({
    url: toPublicUrl(path),
    lastModified: PUBLIC_DISCOVERY_LAST_MODIFIED,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/putduk-facts" ? 0.9 : 0.7,
  }));
}
