import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { isUsdtDepositNetwork } from "@/domain/wallet/usdt-manual-deposit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  network: z.string().trim(),
  txHash: z.string().trim().min(8).max(128),
  sentUsdtAmount: z.string().regex(/^[0-9]+(\.[0-9]{1,6})?$/),
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
  if (!body.success || !isUsdtDepositNetwork(body.data.network.toUpperCase())) {
    return apiError({
      code: "INVALID_USDT_DEPOSIT",
      message: "입금 확인 정보를 확인해 주세요.",
      status: 400,
    });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("submit_usdt_manual_deposit", {
    p_user_id: identity.userId,
    p_network: body.data.network.toUpperCase(),
    p_tx_hash: body.data.txHash,
    p_sent_usdt_amount: body.data.sentUsdtAmount,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    return apiError({
      code: "USDT_DEPOSIT_SUBMIT_FAILED",
      message: "USDT 입금 확인 요청을 접수하지 못했어요.",
      status: 503,
    });
  }

  return apiSuccess({ depositId: data }, 201);
}
