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
  const { data, error } = await admin.rpc("start_trial", {
    p_idempotency_key: idempotencyKey,
    p_user_id: identity.userId,
  });

  if (error) {
    const unavailable = error.message.includes("TRIAL_PROGRAM_UNAVAILABLE");
    return apiError({
      code: unavailable ? "TRIAL_NOT_CONFIGURED" : "TRIAL_START_FAILED",
      message: unavailable
        ? "체험 프로그램이 아직 운영 설정되지 않았습니다."
        : "체험을 시작하지 못했습니다.",
      status: unavailable ? 409 : 503,
    });
  }

  return apiSuccess({ sessionId: data }, 201);
}
