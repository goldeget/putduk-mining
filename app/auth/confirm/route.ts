import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "email_change",
  "invite",
  "magiclink",
  "recovery",
  "signup",
]);

function safeNextPath(value: string | null) {
  return value === "/admin" ? "/admin" : "/start";
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type");
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (
    !tokenHash ||
    !requestedType ||
    !EMAIL_OTP_TYPES.has(requestedType as EmailOtpType)
  ) {
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: requestedType as EmailOtpType,
  });

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
