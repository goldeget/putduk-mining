import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hasAdminAuthServerProof,
  readAdminAuthFailureBudget,
  recordAdminAuthFailure,
  writeAdminAuthServerProof,
} from "@/lib/auth/failure-limit";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { getAdminIdentity, requireAdminCommand } from "@/lib/auth/principal";
import { getAdminEnv } from "@/lib/env";

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  purpose: z.enum(["SESSION", "STEP_UP"]),
  factorId: z.string().trim().min(1).max(128).optional(),
});

type TotpFactor = {
  id?: string;
  status?: string;
  factor_type?: string;
};

function json(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

function selectTotpFactor(
  factors: TotpFactor[],
  requestedId: string | undefined,
): string | null {
  if (requestedId) {
    const match = factors.find((factor) => factor.id === requestedId);
    return match?.id ?? null;
  }
  return factors.find((factor) => factor.status === "verified")?.id ?? null;
}

function listedTotpFactors(listed: {
  totp?: TotpFactor[];
  all?: TotpFactor[];
}): TotpFactor[] {
  const merged = new Map<string, TotpFactor>();
  for (const factor of listed.totp ?? []) {
    if (factor.id) merged.set(factor.id, factor);
  }
  for (const factor of listed.all ?? []) {
    if (factor.factor_type !== "totp" || !factor.id) continue;
    merged.set(factor.id, factor);
  }
  return [...merged.values()];
}

async function postVerifySessionId(
  supabase: SupabaseClient,
  fallbackSessionId: string,
): Promise<
  { ok: true; sessionId: string } | { ok: false; code: "MFA_INCOMPLETE" }
> {
  const [{ data: assurance }, { data: claimsData }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.getClaims(),
  ]);
  if (assurance?.currentLevel !== "aal2") {
    return { ok: false, code: "MFA_INCOMPLETE" };
  }
  const sessionId =
    typeof claimsData?.claims?.session_id === "string"
      ? claimsData.claims.session_id
      : fallbackSessionId;
  if (!sessionId) {
    return { ok: false, code: "MFA_INCOMPLETE" };
  }
  return { ok: true, sessionId };
}

async function verifyCode(input: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  code: string;
  factorId?: string | undefined;
}) {
  const budget = await readAdminAuthFailureBudget("TOTP", input.userId);
  if (budget === "UNAVAILABLE") {
    return json(
      "AUTH_UNAVAILABLE",
      "지금은 인증을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
  if (budget === "RATE_LIMITED") {
    return json("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
  }

  const listed = await input.supabase.auth.mfa.listFactors();
  const factorId = selectTotpFactor(
    listed.data ? listedTotpFactors(listed.data) : [],
    input.factorId,
  );
  if (listed.error || !factorId) {
    return json(
      "TOTP_UNAVAILABLE",
      "인증 코드를 확인하지 못했습니다. 다시 시도해 주세요.",
      400,
    );
  }

  const verified = await input.supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: input.code,
  });
  if (verified.error) {
    await recordAdminAuthFailure("TOTP", input.userId);
    const again = await readAdminAuthFailureBudget("TOTP", input.userId);
    if (again === "RATE_LIMITED") {
      return json("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", 429);
    }
    return json(
      "TOTP_REJECTED",
      "인증 코드가 올바르지 않거나 만료되었습니다.",
      401,
    );
  }

  const sessionTarget = await postVerifySessionId(
    input.supabase,
    input.sessionId,
  );
  if (!sessionTarget.ok) {
    return json(
      "MFA_SESSION_STALE",
      "인증 결과를 확인하지 못했습니다. 다시 로그인해 주세요.",
      503,
    );
  }

  const proved = await writeAdminAuthServerProof({
    kind: "TOTP",
    userId: input.userId,
    sessionId: sessionTarget.sessionId,
  });
  if (!proved) {
    return json(
      "AUTH_UNAVAILABLE",
      "인증 결과를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }

  return NextResponse.json(
    { data: { verified: true } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json("INVALID_CODE", "6자리 인증 코드를 확인해 주세요.", 400);
  }

  if (parsed.data.purpose === "STEP_UP") {
    const access = await requireAdminCommand(request, HIGH_IMPACT_ROLES);
    if (!access.ok) {
      return json(access.code, "이 작업을 실행할 수 없습니다.", access.status);
    }
    if (!access.principal.sessionId) {
      return json(
        "ADMIN_SESSION_REQUIRED",
        "운영 세션을 다시 확인해 주세요.",
        403,
      );
    }
    return verifyCode({
      supabase: access.principal.supabase,
      userId: access.principal.userId,
      sessionId: access.principal.sessionId,
      code: parsed.data.code,
      factorId: parsed.data.factorId,
    });
  }

  const expectedOrigin = new URL(getAdminEnv().ADMIN_APP_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin) {
    return json("ORIGIN_DENIED", "이 작업을 실행할 수 없습니다.", 403);
  }
  const identity = await getAdminIdentity();
  if (!identity?.role || !identity.sessionId) {
    return json("UNAUTHENTICATED", "다시 로그인한 뒤 시도해 주세요.", 401);
  }
  const passwordProof = await hasAdminAuthServerProof({
    kind: "PASSWORD",
    userId: identity.userId,
    sessionId: identity.sessionId,
  });
  if (passwordProof === null) {
    return json(
      "AUTH_UNAVAILABLE",
      "지금은 인증을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );
  }
  if (!passwordProof) {
    return json(
      "PASSWORD_PROOF_REQUIRED",
      "다시 로그인한 뒤 인증 코드를 입력해 주세요.",
      403,
    );
  }
  return verifyCode({
    supabase: identity.supabase,
    userId: identity.userId,
    sessionId: identity.sessionId,
    code: parsed.data.code,
    factorId: parsed.data.factorId,
  });
}
