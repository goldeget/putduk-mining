import type { MetadataRoute } from "next";

import {
  PUBLIC_DISCOVERY_PATHS,
  toPublicUrl,
} from "@/lib/trust/public-discovery";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_DISCOVERY_PATHS.map((path) => ({
    url: toPublicUrl(path),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/putduk-facts" ? 0.9 : 0.7,
  }));
}
