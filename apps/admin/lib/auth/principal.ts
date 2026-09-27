import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { adminLoginPath, safeAdminReturnPath } from "@/lib/auth/return-path";
import {
  decideAdminAccess,
  hasRecentTotpStepUp,
  pickHighestRole,
  type AdminRole,
  type AuthenticationMethod,
} from "@/lib/auth/policy";
import { getAdminEnv } from "@/lib/env";
import { createAdminServerClient } from "@/lib/supabase/server";

type TrustedClaims = {
  sub?: unknown;
  session_id?: unknown;
  aal?: unknown;
  amr?: unknown;
};

export type AdminPrincipal = {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  role: AdminRole;
  aal: string;
  amr: AuthenticationMethod[];
};

export type AdminIdentity = Omit<AdminPrincipal, "role"> & {
  role: AdminRole | null;
};

function parseAmr(value: unknown): AuthenticationMethod[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is AuthenticationMethod =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const supabase = await createAdminServerClient();
  const [
    { data: claimsData, error: claimsError },
    { data: userData, error: userError },
  ] = await Promise.all([supabase.auth.getClaims(), supabase.auth.getUser()]);
  const claims = claimsData?.claims as TrustedClaims | undefined;
  const subject = claims?.sub;
  if (
    claimsError ||
    userError ||
    typeof subject !== "string" ||
    !subject ||
    userData.user?.id !== subject
  ) {
    return null;
  }

  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", subject)
    .is("revoked_at", null);
  if (roleError) return null;

  return {
    supabase,
    userId: subject,
    sessionId: typeof claims.session_id === "string" ? claims.session_id : "",
    role: pickHighestRole((roleRows ?? []).map(({ role }) => role)),
    aal: typeof claims.aal === "string" ? claims.aal : "aal1",
    amr: parseAmr(claims.amr),
  };
}

export async function requireAdminIdentity(
  returnPath = "/",
): Promise<AdminIdentity> {
  const identity = await getAdminIdentity();
  if (!identity)
    redirect(adminLoginPath(safeAdminReturnPath(returnPath)) as Route);
  if (!identity.role) {
    await identity.supabase.auth.signOut({ scope: "local" });
    redirect("/login?denied=1" as Route);
  }
  return identity;
}

export async function requireAdminPage(
  returnPath = "/",
): Promise<AdminPrincipal> {
  const identity = await requireAdminIdentity(returnPath);
  if (identity.aal !== "aal2") {
    redirect(
      `/mfa?returnTo=${encodeURIComponent(safeAdminReturnPath(returnPath))}` as Route,
    );
  }
  return identity as AdminPrincipal;
}

export async function requireAdminCommand(
  request: Request,
  allowedRoles: readonly AdminRole[],
): Promise<
  | { ok: true; principal: AdminPrincipal }
  | { ok: false; status: 401 | 403; code: string }
> {
  const expectedOrigin = new URL(getAdminEnv().ADMIN_APP_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin) {
    return { ok: false, status: 403, code: "ORIGIN_DENIED" };
  }
  const identity = await getAdminIdentity();
  const decision = decideAdminAccess({
    authenticated: Boolean(identity),
    role: identity?.role ?? null,
    aal: identity?.aal ?? null,
    allowedRoles,
    ...(identity ? { recentTotp: hasRecentTotpStepUp(identity.amr) } : {}),
  });
  if (decision !== "ALLOW" || !identity?.role) {
    return {
      ok: false,
      status: decision === "UNAUTHENTICATED" ? 401 : 403,
      code: decision,
    };
  }
  return { ok: true, principal: identity as AdminPrincipal };
}
