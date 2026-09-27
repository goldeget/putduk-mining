import type { NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/home/:path*",
    "/start/:path*",
    "/mining/:path*",
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
  ],
};
