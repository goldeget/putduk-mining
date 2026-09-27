import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { adminLoginPath } from "@/lib/auth/return-path";
import { getAdminEnv } from "@/lib/env";
import { adminCookieOptions } from "@/lib/supabase/cookie";

export async function updateAdminSession(request: NextRequest) {
  const env = getAdminEnv();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: adminCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, value),
          );
        },
      },
    },
  );

  const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const publicPath =
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname.startsWith("/mfa");
  const apiPath = request.nextUrl.pathname.startsWith("/api/");
  if (!publicPath && !apiPath) {
    const { data, error } = await supabase.auth.getClaims();
    if (error || typeof data?.claims?.sub !== "string") {
      const target = request.nextUrl.clone();
      const login = new URL(adminLoginPath(path), target.origin);
      target.pathname = login.pathname;
      target.search = login.search;
      const redirectResponse = NextResponse.redirect(target);
      response.cookies
        .getAll()
        .forEach((cookie) => redirectResponse.cookies.set(cookie));
      return redirectResponse;
    }
  }
  return response;
}
