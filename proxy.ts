import { NextResponse, type NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/proxy";
import {
  legacyWorkroomDestination,
  isRetiredWorkroomMutation,
} from "@/lib/workroom/retirement";

export async function proxy(request: NextRequest) {
  if (isRetiredWorkroomMutation(request.nextUrl.pathname, request.method)) {
    return NextResponse.json(
      {
        error: {
          code: "LEGACY_PRODUCT_RETIRED",
          message:
            "이전 서비스의 신규 체험과 채굴은 종료되었습니다. 워크룸을 이용해 주세요.",
        },
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }
  const destination = legacyWorkroomDestination(request.nextUrl.pathname);
  if (destination && ["GET", "HEAD"].includes(request.method)) {
    const url = request.nextUrl.clone();
    url.pathname = destination;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/workroom/:path*",
    "/api/v1/workroom/:path*",
    "/api/v1/mining/:path*",
    "/api/v1/products/:path*",
    "/api/v1/events/:path*",
    "/home/:path*",
    "/start/:path*",
    "/mining/:path*",
    "/products/:path*",
    "/wallet/:path*",
    "/events/:path*",
    "/notifications/:path*",
    "/ai",
    "/menu/:path*",
    "/api/v1/me/:path*",
    "/api/v1/trial/:path*",
    "/api/v1/wallet/:path*",
    "/api/v1/deposits/:path*",
    "/api/v1/withdrawals/:path*",
    "/api/v1/notifications/:path*",
    "/api/v1/analytics/:path*",
    "/api/v1/ai/:path*",
    "/api/v1/support/:path*",
  ],
};
