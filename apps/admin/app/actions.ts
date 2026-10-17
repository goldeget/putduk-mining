"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  admitAdminAuthAttempt,
  finishAdminAuthAttempt,
  writeAdminAuthServerProof,
} from "@/lib/auth/failure-limit";
import { pickHighestRole } from "@/lib/auth/policy";
import { safeAdminReturnPath } from "@/lib/auth/return-path";
import {
  findActiveAdminSessionId,
  registerAdminAppSession,
  revokeAllAdminAppSessions,
  revokeCurrentAdminAppSession,
} from "@/lib/auth/session-registry";
import { createAdminServerClient } from "@/lib/supabase/server";
import { recordAdminSecurityEvent } from "@/lib/security/events";

export type LoginState = { message: string } | null;
const credentialsSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(256),
  returnTo: z.string().optional(),
});
const genericLoginError = "입력한 정보로 운영자 로그인을 완료할 수 없습니다.";
const retryLoginError = "잠시 후 다시 로그인해 주세요.";
const unavailableLoginError =
  "지금은 접속을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.";

export async function loginAction(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    returnTo: formData.get("returnTo") ?? undefined,
  });
  const rawEmail = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!rawEmail) return { message: genericLoginError };
  const admission = await admitAdminAuthAttempt("PASSWORD", rawEmail);
  if (!admission.allowed)
    return {
      message:
        admission.code === "RATE_LIMITED"
          ? retryLoginError
          : unavailableLoginError,
    };
  const finish = (succeeded: boolean) =>
    finishAdminAuthAttempt(admission.attemptId, succeeded);
  if (!parsed.success) {
    if (!(await finish(false))) return { message: unavailableLoginError };
    return { message: genericLoginError };
  }

  const supabase = await createAdminServerClient();
  const userAgent = (await headers()).get("user-agent");
  let data: Awaited<
    ReturnType<typeof supabase.auth.signInWithPassword>
  >["data"];
  let error: Awaited<
    ReturnType<typeof supabase.auth.signInWithPassword>
  >["error"];
  try {
    const signedIn = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    data = signedIn.data;
    error = signedIn.error;
  } catch {
    if (!(await finish(false))) return { message: unavailableLoginError };
    return { message: genericLoginError };
  }
  if (error || !data.user) {
    if (!(await finish(false))) return { message: unavailableLoginError };
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
    const finished = await finish(false);
    await supabase.auth.signOut({ scope: "local" });
    if (!finished) return { message: unavailableLoginError };
    await recordAdminSecurityEvent({
      eventType: "ADMIN_LOGIN_REJECTED",
      userId: null,
      userAgent,
    });
    return { message: genericLoginError };
  }

  if (!(await finish(true))) {
    await supabase.auth.signOut({ scope: "local" });
    return { message: unavailableLoginError };
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
  const { data: claimsData } = await supabase.auth.getClaims();
  const authSessionId =
    typeof claimsData?.claims?.session_id === "string"
      ? claimsData.claims.session_id
      : "";
  if (!authSessionId) {
    await supabase.auth.signOut({ scope: "local" });
    return { message: genericLoginError };
  }
  const passwordProved = await writeAdminAuthServerProof({
    kind: "PASSWORD",
    userId: data.user.id,
    sessionId: authSessionId,
  });
  if (!passwordProved) {
    await supabase.auth.signOut({ scope: "local" });
    return { message: unavailableLoginError };
  }
  if (assurance?.currentLevel !== "aal2") {
    redirect(`/mfa?returnTo=${encodeURIComponent(returnTo)}` as Route);
  }

  const registered = await registerAdminAppSession({
    userId: data.user.id,
    authSessionId,
    userAgent,
  });
  if (!registered) {
    await supabase.auth.signOut({ scope: "local" });
    return { message: genericLoginError };
  }

  redirect(returnTo as Route);
}

export async function logoutAction() {
  const supabase = await createAdminServerClient();
  const [{ data: claimsData }, { data: userData }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.auth.getUser(),
  ]);
  const userId = userData.user?.id;
  const authSessionId =
    typeof claimsData?.claims?.session_id === "string"
      ? claimsData.claims.session_id
      : "";
  if (userId && authSessionId) {
    const adminSessionId = await findActiveAdminSessionId({
      userId,
      authSessionId,
    });
    if (adminSessionId) {
      await revokeCurrentAdminAppSession({
        adminSessionId,
        actorUserId: userId,
        reason: "OPERATOR_LOGOUT",
      });
    }
  }
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login" as Route);
}

export async function logoutAllAction() {
  const supabase = await createAdminServerClient();
  const [{ data: userData }] = await Promise.all([supabase.auth.getUser()]);
  const userId = userData.user?.id;
  if (userId) {
    await revokeAllAdminAppSessions({
      userId,
      actorUserId: userId,
      reason: "OPERATOR_LOGOUT_ALL",
    });
  }
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login" as Route);
}
