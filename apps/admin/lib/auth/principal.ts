import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { adminLoginPath, safeAdminReturnPath } from "@/lib/auth/return-path";
import { hasAdminCommandOrigin } from "@/lib/auth/request-origin";
import {
  decideAdminAccess,
  pickHighestRole,
  type AdminRole,
  type AuthenticationMethod,
} from "@/lib/auth/policy";
import { assertAndTouchAdminAppSession } from "@/lib/auth/session-registry";
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
  adminSessionId: string;
  role: AdminRole;
  aal: string;
  amr: AuthenticationMethod[];
};

export type AdminIdentity = Omit<AdminPrincipal, "role" | "adminSessionId"> & {
  role: AdminRole | null;
  adminSessionId: string | null;
};

function parseAmr(value: unknown): AuthenticationMethod[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is AuthenticationMethod =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

async function requestUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
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
    adminSessionId: null,
    role: pickHighestRole((roleRows ?? []).map(({ role }) => role)),
    aal: typeof claims.aal === "string" ? claims.aal : "aal1",
    amr: parseAmr(claims.amr),
  };
}

function isPutdukTestRuntime() {
  return (
    process.env.APP_ENV === "test" || process.env.NEXT_PUBLIC_APP_ENV === "test"
  );
}

/**
 * 로그인 화면 SSR은 세션 조회가 끝나야 폼이 그려진다.
 * E2E prebuilt(next start)에서는 런타임 APP_ENV가 비어도 NEXT_PUBLIC_APP_ENV=test 가
 * build에 고정되므로, 테스트에서는 GoTrue 조회 없이 폼을 바로 연다.
 */
export async function getAdminIdentityForLoginPage(): Promise<AdminIdentity | null> {
  if (isPutdukTestRuntime()) {
    return null;
  }
  const identity = await getAdminIdentity();
  if (identity?.role && identity.aal === "aal2") {
    const session = await assertAndTouchAdminAppSession({
      userId: identity.userId,
      authSessionId: identity.sessionId,
      userAgent: await requestUserAgent(),
    });
    if (!session.ok) return null;
  }
  return identity;
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

async function bindAdminSession(
  identity: AdminIdentity,
): Promise<
  { ok: true; principal: AdminPrincipal } | { ok: false; code: string }
> {
  if (!identity.role || identity.aal !== "aal2") {
    return { ok: false, code: "MFA_REQUIRED" };
  }
  const session = await assertAndTouchAdminAppSession({
    userId: identity.userId,
    authSessionId: identity.sessionId,
    userAgent: await requestUserAgent(),
  });
  if (!session.ok) {
    return { ok: false, code: session.code };
  }
  return {
    ok: true,
    principal: {
      ...identity,
      role: identity.role,
      adminSessionId: session.adminSessionId,
    },
  };
}

function sessionDenialRedirect(code: string, returnPath: string): never {
  if (code === "ADMIN_SESSION_REQUIRED" || code === "MFA_REQUIRED") {
    redirect(
      `/mfa?returnTo=${encodeURIComponent(safeAdminReturnPath(returnPath))}` as Route,
    );
  }
  redirect("/session-expired" as Route);
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
  const bound = await bindAdminSession(identity);
  if (!bound.ok) sessionDenialRedirect(bound.code, returnPath);
  return bound.principal;
}

export async function requireAdminCommand(
  request: Request,
  allowedRoles: readonly AdminRole[],
): Promise<
  | { ok: true; principal: AdminPrincipal }
  | { ok: false; status: 401 | 403; code: string }
> {
  if (!hasAdminCommandOrigin(request.headers)) {
    return { ok: false, status: 403, code: "ORIGIN_DENIED" };
  }
  const identity = await getAdminIdentity();
  const decision = decideAdminAccess({
    authenticated: Boolean(identity),
    role: identity?.role ?? null,
    aal: identity?.aal ?? null,
    allowedRoles,
  });
  if (decision !== "ALLOW" || !identity?.role) {
    return {
      ok: false,
      status: decision === "UNAUTHENTICATED" ? 401 : 403,
      code: decision,
    };
  }
  const userAgent = request.headers.get("user-agent");
  const session = await assertAndTouchAdminAppSession({
    userId: identity.userId,
    authSessionId: identity.sessionId,
    userAgent,
  });
  if (!session.ok) {
    return {
      ok: false,
      status: 403,
      code: session.code,
    };
  }
  return {
    ok: true,
    principal: {
      ...identity,
      role: identity.role,
      adminSessionId: session.adminSessionId,
    },
  };
}
