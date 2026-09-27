import "server-only";

import {
  ADMIN_ABSOLUTE_SECONDS,
  ADMIN_IDLE_SECONDS,
  buildAdminSessionFingerprint,
} from "@/lib/auth/session";
import { createAdminServiceClient } from "@/lib/supabase/service";

export type AdminSessionDenial =
  | "ADMIN_SESSION_REQUIRED"
  | "ADMIN_SESSION_EXPIRED"
  | "ADMIN_SESSION_IDLE_EXPIRED"
  | "ADMIN_SESSION_ABSOLUTE_EXPIRED"
  | "ADMIN_SESSION_FINGERPRINT_MISMATCH"
  | "ADMIN_SESSION_REVOKED";

function classifySessionError(message: string | undefined): AdminSessionDenial {
  const text = message ?? "";
  if (text.includes("FINGERPRINT_MISMATCH")) {
    return "ADMIN_SESSION_FINGERPRINT_MISMATCH";
  }
  if (text.includes("IDLE_EXPIRED")) return "ADMIN_SESSION_IDLE_EXPIRED";
  if (text.includes("ABSOLUTE_EXPIRED")) {
    return "ADMIN_SESSION_ABSOLUTE_EXPIRED";
  }
  if (text.includes("REVOKED")) return "ADMIN_SESSION_REVOKED";
  if (text.includes("REQUIRED")) return "ADMIN_SESSION_REQUIRED";
  return "ADMIN_SESSION_EXPIRED";
}

export async function registerAdminAppSession(input: {
  userId: string;
  authSessionId: string;
  userAgent: string | null;
}): Promise<string | null> {
  if (!input.authSessionId) return null;
  const fingerprint = buildAdminSessionFingerprint({
    authSessionId: input.authSessionId,
    userAgent: input.userAgent,
  });
  const { data, error } = await createAdminServiceClient().rpc(
    "register_admin_session",
    {
      p_user_id: input.userId,
      p_auth_session_id: input.authSessionId,
      p_session_fingerprint: fingerprint,
      p_user_agent: input.userAgent?.slice(0, 500) ?? null,
      p_idle_seconds: ADMIN_IDLE_SECONDS,
      p_absolute_seconds: ADMIN_ABSOLUTE_SECONDS,
    },
  );
  if (error || typeof data !== "string") return null;
  return data;
}

export async function assertAndTouchAdminAppSession(input: {
  userId: string;
  authSessionId: string;
  userAgent: string | null;
}): Promise<
  | { ok: true; adminSessionId: string }
  | { ok: false; code: AdminSessionDenial }
> {
  if (!input.authSessionId) {
    return { ok: false, code: "ADMIN_SESSION_REQUIRED" };
  }
  const fingerprint = buildAdminSessionFingerprint({
    authSessionId: input.authSessionId,
    userAgent: input.userAgent,
  });
  const { data, error } = await createAdminServiceClient().rpc(
    "assert_admin_session",
    {
      p_user_id: input.userId,
      p_auth_session_id: input.authSessionId,
      p_session_fingerprint: fingerprint,
      p_idle_seconds: ADMIN_IDLE_SECONDS,
    },
  );
  if (error || typeof data !== "string") {
    return { ok: false, code: classifySessionError(error?.message) };
  }
  return { ok: true, adminSessionId: data };
}

export async function revokeCurrentAdminAppSession(input: {
  adminSessionId: string;
  actorUserId: string;
  reason: string;
}): Promise<boolean> {
  const { error } = await createAdminServiceClient().rpc(
    "revoke_admin_session",
    {
      p_session_id: input.adminSessionId,
      p_actor: input.actorUserId,
      p_reason: input.reason,
    },
  );
  return !error;
}

export async function findActiveAdminSessionId(input: {
  userId: string;
  authSessionId: string;
}): Promise<string | null> {
  if (!input.authSessionId) return null;
  const { data, error } = await createAdminServiceClient()
    .from("admin_sessions")
    .select("id")
    .eq("user_id", input.userId)
    .eq("auth_session_id", input.authSessionId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) return null;
  return data.id as string;
}

export async function revokeAllAdminAppSessions(input: {
  userId: string;
  actorUserId: string;
  reason: string;
}): Promise<boolean> {
  const { error } = await createAdminServiceClient().rpc(
    "revoke_all_admin_sessions",
    {
      p_user_id: input.userId,
      p_actor: input.actorUserId,
      p_reason: input.reason,
    },
  );
  return !error;
}
