import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { readBoundedJsonBody } from "@/lib/api/request-body";
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

const MAX_BODY_BYTES = 2_048;
const holdReceiptSchema = z.object({
  user_id: z.uuid(),
  idempotency_key: z.string(),
  method: requestSchema.shape.method,
  destination_id: z.uuid(),
  amount_krw: z
    .union([z.string(), z.number().int().positive().safe().transform(String)])
    .pipe(requestSchema.shape.amountKrw),
  withdrawal_id: z.uuid(),
});

function unconfirmedHold() {
  return apiError({
    code: "WITHDRAWAL_RECONCILIATION_REQUIRED",
    message: "이전 요청을 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
    status: 503,
  });
}

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

  const input = await readBoundedJsonBody(request, MAX_BODY_BYTES);
  const body = requestSchema.safeParse(input.ok ? input.value : null);
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
  let result: Awaited<ReturnType<typeof admin.rpc>>;
  try {
    result = await admin.rpc("hold_withdrawal_logical_request", {
      p_user_id: identity.userId,
      p_method: body.data.method,
      p_destination_id: body.data.destinationId,
      p_amount_krw: body.data.amountKrw,
      p_idempotency_key: idempotencyKey,
    });
  } catch {
    return unconfirmedHold();
  }
  const { data, error } = result;

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

  const withdrawal = z.uuid().safeParse(data);
  if (!withdrawal.success) return unconfirmedHold();

  try {
    // Read the original member/key binding, including an already committed replay.
    // An unavailable read is uncertain: never release or send another HOLD here.
    const read = await admin
      .from("withdrawal_logical_requests")
      .select(
        "user_id,idempotency_key,method,destination_id,amount_krw,withdrawal_id",
      )
      .eq("user_id", identity.userId)
      .eq("idempotency_key", idempotencyKey)
      .eq("withdrawal_id", withdrawal.data)
      .maybeSingle();
    const receipt = holdReceiptSchema.safeParse(read.data);
    if (
      read.error ||
      !receipt.success ||
      receipt.data.user_id.toLowerCase() !== identity.userId.toLowerCase() ||
      receipt.data.idempotency_key !== idempotencyKey ||
      receipt.data.withdrawal_id.toLowerCase() !==
        withdrawal.data.toLowerCase() ||
      receipt.data.method !== body.data.method ||
      receipt.data.destination_id.toLowerCase() !==
        body.data.destinationId.toLowerCase() ||
      receipt.data.amount_krw !== body.data.amountKrw
    )
      return unconfirmedHold();
  } catch {
    return unconfirmedHold();
  }

  return apiSuccess({ withdrawalId: withdrawal.data }, 201);
}
