"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { pickHighestRole } from "@/lib/auth/policy";
import { safeAdminReturnPath } from "@/lib/auth/return-path";
import { createAdminServerClient } from "@/lib/supabase/server";
import { recordAdminSecurityEvent } from "@/lib/security/events";

export type LoginState = { message: string } | null;
const credentialsSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(256),
  returnTo: z.string().optional(),
});
const genericLoginError = "입력한 정보로 운영자 로그인을 완료할 수 없습니다.";

export async function loginAction(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    returnTo: formData.get("returnTo") ?? undefined,
  });
  if (!parsed.success) return { message: genericLoginError };

  const supabase = await createAdminServerClient();
  const userAgent = (await headers()).get("user-agent");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    await recordAdminSecurityEvent({
      eventType: "ADMIN_LOGIN_REJECTED",
      userId: null,
      userAgent,
    });
    return { message: genericLoginError };
  }

  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .is("revoked_at", null);
  if (roleError || !pickHighestRole((roleRows ?? []).map(({ role }) => role))) {
    await recordAdminSecurityEvent({
      eventType: "ADMIN_LOGIN_REJECTED",
      userId: data.user.id,
      userAgent,
    });
    await supabase.auth.signOut({ scope: "local" });
    return { message: genericLoginError };
  }

  const recorded = await recordAdminSecurityEvent({
    eventType: "ADMIN_LOGIN_ACCEPTED",
    userId: data.user.id,
    userAgent,
  });
  if (!recorded) {
    await supabase.auth.signOut({ scope: "local" });
    return { message: genericLoginError };
  }

  const { data: assurance } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const returnTo = safeAdminReturnPath(parsed.data.returnTo);
  if (assurance?.currentLevel !== "aal2") {
    redirect(`/mfa?returnTo=${encodeURIComponent(returnTo)}` as Route);
  }
  redirect(returnTo as Route);
}

export async function logoutAction() {
  const supabase = await createAdminServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login" as Route);
}

export async function logoutAllAction() {
  const supabase = await createAdminServerClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login" as Route);
}
