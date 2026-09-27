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

  if (error || typeof subject !== "string" || !subject) {
    return null;
  }

  return { supabase, userId: subject };
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
