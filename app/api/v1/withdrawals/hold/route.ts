import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withdrawalLogicalApiError } from "@/lib/wallet/withdrawal-logical-errors.server";
import {
  WITHDRAWAL_SOURCE_UNAVAILABLE_CODE,
  WITHDRAWAL_SOURCE_UNAVAILABLE_COPY,
} from "@/lib/wallet/withdrawal-source-status";

const requestSchema = z.strictObject({
  method: z.enum(["KRW_BANK", "USDT_ADDRESS"]),
  destinationId: z.string().uuid(),
  amountKrw: z.string().regex(/^[1-9][0-9]{0,14}$/),
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

  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return apiError({
      code: "INVALID_WITHDRAWAL_REQUEST",
      message: "출금 요청 정보를 확인해 주세요.",
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();
  // Atomically delegates to request_krw_withdrawal / request_usdt_withdrawal.
  // An arbitrary fresh browser key cannot bypass the unresolved-intent guard.
  const { data, error } = await admin.rpc("hold_withdrawal_logical_request", {
    p_user_id: identity.userId,
    p_method: body.data.method,
    p_destination_id: body.data.destinationId,
    p_amount_krw: body.data.amountKrw,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    if (
      error.message.includes("WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE")
    ) {
      return apiError({
        code: WITHDRAWAL_SOURCE_UNAVAILABLE_CODE,
        message: WITHDRAWAL_SOURCE_UNAVAILABLE_COPY,
        status: 409,
      });
    }
    if (error.message.includes("WITHDRAWAL_LOGICAL_")) {
      return withdrawalLogicalApiError(error);
    }
    const insufficient = error.message.includes(
      "INSUFFICIENT_AVAILABLE_BALANCE",
    );
    return apiError({
      code: insufficient
        ? "INSUFFICIENT_AVAILABLE_BALANCE"
        : "WITHDRAWAL_REQUEST_FAILED",
      message: insufficient
        ? "출금 가능 금액이 부족해요."
        : "출금 요청을 접수하지 못했어요.",
      status: insufficient ? 409 : 503,
    });
  }

  return apiSuccess({ withdrawalId: data }, 201);
}
