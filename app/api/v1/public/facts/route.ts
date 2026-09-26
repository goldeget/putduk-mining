import { NextResponse } from "next/server";

import {
  PUBLIC_FACTS,
  TRUST_CONTENT_VERSION,
  TRUST_LAST_UPDATED,
} from "@/lib/trust/public-content";

export function GET() {
  return NextResponse.json(
    {
      data: {
        facts: PUBLIC_FACTS,
        lastUpdated: TRUST_LAST_UPDATED,
        version: TRUST_CONTENT_VERSION,
      },
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
