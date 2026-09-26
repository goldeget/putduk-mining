import { NextResponse, type NextRequest } from "next/server";

import { safeProtectedReturnPath } from "@/lib/auth/return-path";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeProtectedReturnPath(
    request.nextUrl.searchParams.get("next"),
  );

  if (!code) {
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }

  const admin = createSupabaseAdminClient();
  const { error: bootstrapError } = await admin.rpc("bootstrap_user", {
    p_user_id: data.user.id,
  });

  if (bootstrapError) {
    return NextResponse.redirect(
      new URL("/auth/error?reason=bootstrap", request.url),
    );
  }

  return NextResponse.redirect(new URL(nextPath, request.url));
}
