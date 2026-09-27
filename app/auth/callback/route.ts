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

  const code = request.nextUrl.searchParams.get("code");
  const requestedNext = request.nextUrl.searchParams.get("next");

  if (!code) {
    return NextResponse.redirect(new URL("/auth/error", appUrl));
  }

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return serviceUnavailable();
  }

  let exchange: Awaited<
    ReturnType<typeof supabase.auth.exchangeCodeForSession>
  >;
  let recoveryEventObserved = false;
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      recoveryEventObserved = true;
    }
  });
  try {
    exchange = await supabase.auth.exchangeCodeForSession(code);
  } catch {
    return NextResponse.redirect(new URL("/auth/error", appUrl));
  } finally {
    subscription.unsubscribe();
  }

  const { data, error } = exchange;

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

  // auth-js derives PASSWORD_RECOVERY from the PKCE verifier created by
  // resetPasswordForEmail. The user-controlled `next` query never grants this.
  const isRecovery = recoveryEventObserved;
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
