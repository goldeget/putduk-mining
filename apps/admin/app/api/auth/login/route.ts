import { headers } from "next/headers";
import { z } from "zod";

import {
  admitAdminAuthAttempt,
  finishAdminAuthAttempt,
  writeAdminAuthServerProof,
} from "@/lib/auth/failure-limit";
import { pickHighestRole } from "@/lib/auth/policy";
import {
  ADMIN_LOGIN_ID,
  resolveAdminLoginEmail,
} from "@/lib/auth/login-identifier";
import { safeAdminReturnPath } from "@/lib/auth/return-path";
import {
  findActiveAdminSessionId,
  registerAdminAppSession,
} from "@/lib/auth/session-registry";
import { createAdminServerClient } from "@/lib/supabase/server";
import { recordAdminSecurityEvent } from "@/lib/security/events";

export const runtime = "nodejs";

const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine(
      (value) =>
        z.email().safeParse(value).success || ADMIN_LOGIN_ID.test(value),
    ),
  password: z.string().min(1).max(256),
  returnTo: z.string().optional(),
});

const genericLoginError = "입력한 정보로 운영자 로그인을 완료할 수 없습니다.";
const retryLoginError = "잠시 후 다시 로그인해 주세요.";
const unavailableLoginError =
  "지금은 접속을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.";

type LoginResponse = {
  message?: string;
  redirectUrl?: string;
};

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 400 },
    );
  }

  const parsed = credentialsSchema.safeParse(body);
  const rawEmail = String((body as Record<string, unknown>)?.email ?? "")
    .trim()
    .toLowerCase();
  if (!rawEmail) {
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 400 },
    );
  }

  const resolved = parsed.success
    ? await resolveAdminLoginEmail(parsed.data.email)
    : { email: null, serviceAvailable: true };

  const admission = await admitAdminAuthAttempt(
    "PASSWORD",
    resolved.email ?? rawEmail,
  );
  if (!admission.allowed) {
    return Response.json(
      {
        message:
          admission.code === "RATE_LIMITED"
            ? retryLoginError
            : unavailableLoginError,
      } satisfies LoginResponse,
      { status: 429 },
    );
  }

  const finish = (succeeded: boolean) =>
    finishAdminAuthAttempt(admission.attemptId, succeeded);

  if (!parsed.success) {
    if (!(await finish(false))) {
      return Response.json(
        { message: unavailableLoginError } satisfies LoginResponse,
        { status: 502 },
      );
    }
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 401 },
    );
  }

  if (!resolved.email) {
    if (!(await finish(false))) {
      return Response.json(
        { message: unavailableLoginError } satisfies LoginResponse,
        { status: 502 },
      );
    }
    return Response.json(
      {
        message: resolved.serviceAvailable
          ? genericLoginError
          : unavailableLoginError,
      } satisfies LoginResponse,
      { status: 401 },
    );
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
      email: resolved.email,
      password: parsed.data.password,
    });
    data = signedIn.data;
    error = signedIn.error;
  } catch {
    if (!(await finish(false))) {
      return Response.json(
        { message: unavailableLoginError } satisfies LoginResponse,
        { status: 502 },
      );
    }
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 401 },
    );
  }

  if (error || !data.user) {
    if (!(await finish(false))) {
      return Response.json(
        { message: unavailableLoginError } satisfies LoginResponse,
        { status: 502 },
      );
    }
    await recordAdminSecurityEvent({
      eventType: "ADMIN_LOGIN_REJECTED",
      userId: null,
      userAgent,
    });
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 401 },
    );
  }

  const { data: roleRows, error: roleError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .is("revoked_at", null);

  if (roleError || !pickHighestRole((roleRows ?? []).map(({ role }) => role))) {
    const finished = await finish(false);
    await supabase.auth.signOut({ scope: "local" });
    if (!finished) {
      return Response.json(
        { message: unavailableLoginError } satisfies LoginResponse,
        { status: 502 },
      );
    }
    await recordAdminSecurityEvent({
      eventType: "ADMIN_LOGIN_REJECTED",
      userId: null,
      userAgent,
    });
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 401 },
    );
  }

  if (!(await finish(true))) {
    await supabase.auth.signOut({ scope: "local" });
    return Response.json(
      { message: unavailableLoginError } satisfies LoginResponse,
      { status: 502 },
    );
  }

  const recorded = await recordAdminSecurityEvent({
    eventType: "ADMIN_LOGIN_ACCEPTED",
    userId: data.user.id,
    userAgent,
  });
  if (!recorded) {
    await supabase.auth.signOut({ scope: "local" });
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 401 },
    );
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
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 401 },
    );
  }

  const passwordProved = await writeAdminAuthServerProof({
    kind: "PASSWORD",
    userId: data.user.id,
    sessionId: authSessionId,
  });
  if (!passwordProved) {
    await supabase.auth.signOut({ scope: "local" });
    return Response.json(
      { message: unavailableLoginError } satisfies LoginResponse,
      { status: 502 },
    );
  }

  if (assurance?.currentLevel !== "aal2") {
    return Response.json(
      {
        redirectUrl: `/mfa?returnTo=${encodeURIComponent(returnTo)}`,
      } satisfies LoginResponse,
      { status: 200 },
    );
  }

  const registered = await registerAdminAppSession({
    userId: data.user.id,
    authSessionId,
    userAgent,
  });
  if (!registered) {
    await supabase.auth.signOut({ scope: "local" });
    return Response.json(
      { message: genericLoginError } satisfies LoginResponse,
      { status: 401 },
    );
  }

  return Response.json(
    { redirectUrl: returnTo } satisfies LoginResponse,
    { status: 200 },
  );
}
