import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildLoginPath,
  safeProtectedReturnPath,
} from "@/lib/auth/return-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type VerifiedIdentity = {
  supabase: SupabaseClient;
  userId: string;
};

export type AuthGateResult =
  | { status: "ok"; identity: VerifiedIdentity }
  | { status: "redirect"; redirectUrl: string };

export async function getVerifiedIdentity(): Promise<VerifiedIdentity | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const subject = data?.claims?.sub;

  if (!error && typeof subject === "string" && subject) {
    return { supabase, userId: subject };
  }

  // getClaims가 JWKS/타임아웃으로 비면 getUser로 한 번 더 확인한다(로컬 Auth·API 경로).
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user?.id) {
    return null;
  }

  return { supabase, userId: userData.user.id };
}

/**
 * 인증된 사용자 정보를 반환한다. 인증되지 않은 경우 null을 반환한다.
 *
 * IMPORTANT: vinext에서 redirect()가 정상 동작하지 않으므로,
 * (product)/layout.tsx의 requirePageUserOrRedirect()가
 * 클라이언트 사이드 리다이렉트로 처리한다.
 */
export async function requirePageUser(
  returnPath = "/workroom",
): Promise<VerifiedIdentity | null> {
  return getVerifiedIdentity();
}

/**
 * 인증된 사용자 정보를 반환하거나, 인증되지 않은 경우 redirect URL을 반환한다.
 * vinext 호환 — redirect() 대신 클라이언트 리다이렉트를 사용하기 위함.
 */
export async function requirePageUserOrRedirect(
  returnPath = "/workroom",
): Promise<AuthGateResult> {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return {
      status: "redirect",
      redirectUrl: buildLoginPath(safeProtectedReturnPath(returnPath)),
    };
  }
  return { status: "ok", identity };
}
