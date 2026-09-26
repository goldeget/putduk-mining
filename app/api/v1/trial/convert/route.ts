import { randomUUID } from "node:crypto";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const WELCOME_RULE_VERSION = 1;
const WELCOME_RISK_MODEL_VERSION = "WELCOME_RISK_V1";

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
  const { data, error } = await admin.rpc("convert_trial_welcome_reward", {
    p_idempotency_key: idempotencyKey,
    p_request_id: randomUUID(),
    p_risk_model_version: WELCOME_RISK_MODEL_VERSION,
    p_rule_version: WELCOME_RULE_VERSION,
    p_user_id: identity.userId,
  });

  if (error) {
    const kycRequired = error.message.includes("WELCOME_REWARD_KYC_REQUIRED");
    const riskReview = error.message.includes(
      "WELCOME_REWARD_RISK_REVIEW_REQUIRED",
    );
    const trialIncomplete = error.message.includes("TRIAL_NOT_COMPLETED");
    const paused = error.message.includes("WELCOME_REWARD_CONVERSION_PAUSED");

    return apiError({
      code: kycRequired
        ? "WELCOME_REWARD_KYC_REQUIRED"
        : riskReview
          ? "WELCOME_REWARD_RISK_REVIEW_REQUIRED"
          : trialIncomplete
            ? "TRIAL_NOT_COMPLETED"
            : paused
              ? "WELCOME_REWARD_CONVERSION_PAUSED"
              : "WELCOME_REWARD_CONVERSION_FAILED",
      message: kycRequired
        ? "실명 확인을 완료하면 환영 보상을 전환할 수 있습니다."
        : riskReview
          ? "안전 확인이 필요해 보상 전환을 검토하고 있습니다."
          : trialIncomplete
            ? "PUTDUK START를 완료한 뒤 다시 시도해 주세요."
            : paused
              ? "현재 안전 점검으로 환영 보상 전환이 잠시 중단되었습니다."
              : "환영 보상을 전환하지 못했습니다.",
      status: kycRequired || riskReview || trialIncomplete ? 409 : 503,
    });
  }

  return apiSuccess({ conversion: data?.[0] ?? null });
}
