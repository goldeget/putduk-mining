import { randomUUID } from "node:crypto";

import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  conversionId: z.uuid(),
  destinationId: z.uuid(),
  policyId: z.uuid(),
});

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

  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return apiError({
      code: "INVALID_WELCOME_WITHDRAWAL_REQUEST",
      message: "환영 보상 출금 정보를 확인해 주세요.",
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc(
    "create_welcome_reward_withdrawal_request",
    {
      p_conversion_id: parsed.data.conversionId,
      p_destination_id: parsed.data.destinationId,
      p_idempotency_key: idempotencyKey,
      p_request_id: randomUUID(),
      p_user_id: identity.userId,
      p_withdrawal_policy_id: parsed.data.policyId,
    },
  );

  if (error) {
    const destinationRequired = error.message.includes(
      "VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED",
    );
    const policyUnavailable = error.message.includes(
      "WELCOME_WITHDRAWAL_POLICY_UNAVAILABLE",
    );
    const rewardUnavailable = error.message.includes(
      "WELCOME_REWARD_NOT_WITHDRAWABLE",
    );
    const alreadyRequested = error.message.includes(
      "WELCOME_REWARD_WITHDRAWAL_EXISTS",
    );
    const paused = error.message.includes("WELCOME_WITHDRAWAL_PAUSED");
    const insufficient = error.message.includes(
      "INSUFFICIENT_AVAILABLE_BALANCE",
    );

    return apiError({
      code: destinationRequired
        ? "VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED"
        : policyUnavailable
          ? "WELCOME_WITHDRAWAL_POLICY_UNAVAILABLE"
          : rewardUnavailable
            ? "WELCOME_REWARD_NOT_WITHDRAWABLE"
            : alreadyRequested
              ? "WELCOME_REWARD_WITHDRAWAL_EXISTS"
              : paused
                ? "WELCOME_WITHDRAWAL_PAUSED"
                : insufficient
                  ? "INSUFFICIENT_AVAILABLE_BALANCE"
                  : "WELCOME_WITHDRAWAL_REQUEST_FAILED",
      message: destinationRequired
        ? "검증과 보호 대기 시간이 끝난 본인 출금 계좌가 필요합니다."
        : policyUnavailable
          ? "현재 사용할 수 있는 환영 보상 출금 정책이 없습니다."
          : rewardUnavailable
            ? "출금 가능한 환영 보상을 확인해 주세요."
            : alreadyRequested
              ? "이미 접수된 환영 보상 출금이 있습니다."
              : paused
                ? "현재 안전 점검으로 출금 접수가 잠시 중단되었습니다."
                : insufficient
                  ? "사용 가능한 환영 보상 잔액이 부족합니다."
                  : "환영 보상 출금 요청을 생성하지 못했습니다.",
      status:
        destinationRequired ||
        policyUnavailable ||
        rewardUnavailable ||
        alreadyRequested ||
        insufficient
          ? 409
          : 503,
    });
  }

  return apiSuccess({ requestId: data }, 201);
}
