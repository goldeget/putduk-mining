import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import {
  createRecoveryProof,
  RECOVERY_PROOF_COOKIE,
  RECOVERY_PROOF_MAX_AGE_SECONDS,
} from "@/app/auth/update-password/recovery-proof";
import { safeProtectedReturnPath } from "@/lib/auth/return-path";
import { getPublicEnv } from "@/lib/env/public";
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

function serviceUnavailable() {
  return NextResponse.json(
    { error: { code: "AUTH_SERVICE_UNAVAILABLE" } },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: NextRequest) {
  let appUrl: URL;
  try {
    appUrl = new URL(getPublicEnv().NEXT_PUBLIC_APP_URL);
  } catch {
    return serviceUnavailable();
  }

  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type");
  const requestedNext = request.nextUrl.searchParams.get("next");

  if (
    !tokenHash ||
    !requestedType ||
    !EMAIL_OTP_TYPES.has(requestedType as EmailOtpType)
  ) {
    return NextResponse.redirect(new URL("/auth/error", appUrl));
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return serviceUnavailable();
  }

  let verification: Awaited<ReturnType<typeof supabase.auth.verifyOtp>>;
  try {
    verification = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: requestedType as EmailOtpType,
    });
  } catch {
    return NextResponse.redirect(new URL("/auth/error", appUrl));
  }

  const { data, error } = verification;

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/auth/error", appUrl));
  }

  let bootstrapFailed = false;
  try {
    const admin = createSupabaseAdminClient();
    const { error: bootstrapError } = await admin.rpc("bootstrap_user", {
      p_user_id: data.user.id,
    });
    bootstrapFailed = Boolean(bootstrapError);
  } catch {
    bootstrapFailed = true;
  }

  if (bootstrapFailed) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return NextResponse.redirect(
      new URL("/auth/error?reason=bootstrap", appUrl),
    );
  }

  const isRecovery = requestedType === "recovery";
  const nextPath = isRecovery
    ? "/auth/update-password"
    : safeProtectedReturnPath(
        requestedNext === "/auth/update-password" ? null : requestedNext,
      );
  const response = NextResponse.redirect(new URL(nextPath, appUrl));

  if (!isRecovery) {
    response.cookies.set(RECOVERY_PROOF_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/auth/update-password",
      sameSite: "lax",
      secure: appUrl.protocol === "https:",
    });
    return response;
  }

  if (!data.session) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return NextResponse.redirect(
      new URL("/auth/error?reason=recovery", appUrl),
    );
  }

  let claimData: Awaited<ReturnType<typeof supabase.auth.getClaims>>["data"];
  let claimError: Awaited<ReturnType<typeof supabase.auth.getClaims>>["error"];
  try {
    const claimsResult = await supabase.auth.getClaims(
      data.session.access_token,
    );
    claimData = claimsResult.data;
    claimError = claimsResult.error;
  } catch {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return NextResponse.redirect(
      new URL("/auth/error?reason=recovery", appUrl),
    );
  }
  const sessionId = (claimData?.claims as Record<string, unknown> | undefined)
    ?.session_id;
  if (claimError || typeof sessionId !== "string") {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return NextResponse.redirect(
      new URL("/auth/error?reason=recovery", appUrl),
    );
  }

  try {
    response.cookies.set(
      RECOVERY_PROOF_COOKIE,
      createRecoveryProof({ sessionId, userId: data.user.id }),
      {
        httpOnly: true,
        maxAge: RECOVERY_PROOF_MAX_AGE_SECONDS,
        path: "/auth/update-password",
        sameSite: "lax",
        secure: appUrl.protocol === "https:",
      },
    );
  } catch {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return serviceUnavailable();
  }

  return response;
}
