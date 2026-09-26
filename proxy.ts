import type { NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/start/:path*",
    "/mining/:path*",
    "/wallet/:path*",
    "/events/:path*",
    "/menu/:path*",
    "/admin/:path*",
    "/api/v1/me/:path*",
    "/api/v1/trial/:path*",
    "/api/v1/wallet/:path*",
    "/api/v1/deposits/:path*",
    "/api/v1/withdrawals/:path*",
    "/api/v1/notifications/:path*",
    "/api/v1/analytics/:path*",
    "/api/v1/ai/:path*",
    "/api/v1/admin/:path*",
  ],
};
