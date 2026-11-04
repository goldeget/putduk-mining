import { NextResponse, type NextRequest } from "next/server";

import { updateAdminSession } from "@/lib/supabase/proxy";
import {
  isRetiredAdminWorkroomCommand,
  retiredAdminWorkroomDestination,
} from "@/lib/workroom/retirement";

export function proxy(request: NextRequest) {
  if (isRetiredAdminWorkroomCommand(request.nextUrl.pathname, request.method)) {
    return NextResponse.json(
      {
        error: {
          code: "LEGACY_PRODUCT_RETIRED",
          message:
            "이전 서비스의 신규 정책 게시를 종료했습니다. 워크룸 운영 화면을 이용해 주세요.",
        },
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }
  const destination = retiredAdminWorkroomDestination(request.nextUrl.pathname);
  if (destination && ["GET", "HEAD"].includes(request.method)) {
    const url = request.nextUrl.clone();
    url.pathname = destination;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return updateAdminSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
