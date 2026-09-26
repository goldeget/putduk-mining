import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Route } from "next";
import { redirect } from "next/navigation";

import {
  buildLoginPath,
  safeProtectedReturnPath,
} from "@/lib/auth/return-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "CONTENT_ADMIN",
  "SUPPORT_ADMIN",
  "VIEWER",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

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

export async function getAdminIdentity(
  verifiedIdentity?: VerifiedIdentity,
): Promise<(VerifiedIdentity & { role: AdminRole }) | null> {
  const identity = verifiedIdentity ?? (await getVerifiedIdentity());
  if (!identity) {
    return null;
  }

  const { data, error } = await identity.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", identity.userId)
    .is("revoked_at", null);

  if (error || !data) {
    return null;
  }

  const role = data
    .map((record) => record.role)
    .find((value): value is AdminRole =>
      ADMIN_ROLES.includes(value as AdminRole),
    );

  return role ? { ...identity, role } : null;
}

export async function requireAdminPage() {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    redirect(buildLoginPath("/admin") as Route);
  }

  const admin = await getAdminIdentity(identity);
  if (!admin) {
    redirect("/auth/forbidden" as Route);
  }

  return admin;
}
