import type { NextRequest } from "next/server";

import { updateAdminSession } from "@/lib/supabase/proxy";

export function middleware(request: NextRequest) {
  return updateAdminSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
