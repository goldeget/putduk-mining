import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Route } from "next";
import { redirect } from "next/navigation";

import {
  buildLoginPath,
  safeProtectedReturnPath,
} from "@/lib/auth/return-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type VerifiedIdentity = {
  supabase: SupabaseClient;
  userId: string;
};

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

export async function requirePageUser(
  returnPath = "/start",
): Promise<VerifiedIdentity> {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    redirect(buildLoginPath(safeProtectedReturnPath(returnPath)) as Route);
  }
  return identity;
}
