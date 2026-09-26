import type { MetadataRoute } from "next";

import { TRUST_DOCUMENTS } from "@/lib/trust/public-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://mining.putduk.com";

  return [
    {
      url: baseUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...TRUST_DOCUMENTS.map((document) => ({
      url: `${baseUrl}${document.path}`,
      changeFrequency: "monthly" as const,
      priority: document.path === "/putduk-facts" ? 0.9 : 0.7,
    })),
  ];
}
