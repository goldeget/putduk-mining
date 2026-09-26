import { getVerifiedIdentity } from "@/lib/auth/session";
import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) {
    return apiError({
      code: "INVALID_IDEMPOTENCY_KEY",
      message: "요청 식별자를 확인해 주세요.",
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("settle_trial", {
    p_idempotency_key: idempotencyKey,
    p_user_id: identity.userId,
  });

  if (error) {
    const configurationError =
      error.message.includes("TRIAL_REWARD_CURVE_UNAVAILABLE") ||
      error.message.includes("TRIAL_REWARD_CURVE_INCOMPLETE") ||
      error.message.includes("TRIAL_REWARD_CURVE_NON_MONOTONIC");

    return apiError({
      code: configurationError
        ? "TRIAL_RULES_NOT_CONFIGURED"
        : "TRIAL_SETTLEMENT_FAILED",
      message: configurationError
        ? "체험 정산 규칙이 아직 운영 승인되지 않았습니다."
        : "체험 결과를 동기화하지 못했습니다.",
      status: configurationError ? 409 : 503,
    });
  }

  return apiSuccess({ trial: data?.[0] ?? null });
}
