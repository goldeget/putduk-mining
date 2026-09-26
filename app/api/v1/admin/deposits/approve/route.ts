import { randomUUID } from "node:crypto";
import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getAdminIdentity, getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  confirmation: z.literal("APPROVE_DEPOSIT"),
  depositRequestId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
  receivedAmountAtomic: z.string().regex(/^[1-9][0-9]{0,23}$/),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "운영자 로그인이 필요합니다.",
      status: 401,
    });
  }

  const operator = await getAdminIdentity(identity);
  if (!operator || !["SUPER_ADMIN", "ADMIN"].includes(operator.role)) {
    return apiError({
      code: "FORBIDDEN",
      message: "입금 승인 권한이 없습니다.",
      status: 403,
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
      code: "INVALID_APPROVAL_REQUEST",
      message: "승인 금액, 사유와 확인 문구를 확인해 주세요.",
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("approve_deposit_request", {
    p_deposit_request_id: parsed.data.depositRequestId,
    p_ledger_idempotency_key: idempotencyKey,
    p_operator_id: operator.userId,
    p_reason: parsed.data.reason,
    p_received_amount_atomic: parsed.data.receivedAmountAtomic,
    p_request_id: randomUUID(),
  });

  if (error) {
    const notApprovable =
      error.message.includes("DEPOSIT_REQUEST_NOT_APPROVABLE") ||
      error.message.includes("DEPOSIT_REQUEST_NOT_FOUND");
    return apiError({
      code: notApprovable
        ? "DEPOSIT_NOT_APPROVABLE"
        : "DEPOSIT_APPROVAL_FAILED",
      message: notApprovable
        ? "현재 상태에서는 이 입금 요청을 승인할 수 없습니다."
        : "입금 승인을 완료하지 못했습니다.",
      status: notApprovable ? 409 : 503,
    });
  }

  return apiSuccess({ ledgerId: data });
}
