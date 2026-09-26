import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  amountAtomic: z.string().regex(/^[1-9][0-9]{0,23}$/),
  currency: z.enum(["KRW", "USDT"]),
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
      code: "INVALID_DEPOSIT_REQUEST",
      message: "입금 요청 정보를 확인해 주세요.",
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("create_deposit_request", {
    p_amount_atomic: body.data.amountAtomic,
    p_currency: body.data.currency,
    p_idempotency_key: idempotencyKey,
    p_user_id: identity.userId,
  });

  if (error) {
    return apiError({
      code: "DEPOSIT_REQUEST_FAILED",
      message: "입금 요청을 생성하지 못했습니다.",
      status: 503,
    });
  }

  return apiSuccess({ requestId: data }, 201);
}
