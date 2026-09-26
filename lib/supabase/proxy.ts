import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  buildLoginPath,
  isSafeProtectedReturnPath,
} from "@/lib/auth/return-path";
import { getPublicEnv } from "@/lib/env/public";
import { supabaseServerFetch } from "@/lib/supabase/server-fetch";

export async function updateSupabaseSession(request: NextRequest) {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: supabaseServerFetch },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([name, value]) => {
            response.headers.set(name, value);
          });
        },
      },
    },
  );

  let subject: string | null = null;
  let claimsFailed = false;
  try {
    const { data, error } = await supabase.auth.getClaims();
    subject =
      !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    claimsFailed = Boolean(error);
  } catch {
    claimsFailed = true;
  }
  const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const isProtectedPage =
    request.method === "GET" && isSafeProtectedReturnPath(returnPath);

  if (isProtectedPage && (claimsFailed || !subject)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = new URL(
      buildLoginPath(returnPath),
      loginUrl.origin,
    ).search;

    const redirectResponse = NextResponse.redirect(loginUrl);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  return response;
}
