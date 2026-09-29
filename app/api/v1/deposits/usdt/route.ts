import { z } from "zod";

import { apiError, apiSuccess } from "@/lib/api/http";
import { readIdempotencyKey } from "@/lib/api/idempotency";
import { getVerifiedIdentity } from "@/lib/auth/session";
import {
  isPositiveUsdtSentAmount,
  isUsdtDepositNetwork,
} from "@/domain/wallet/usdt-manual-deposit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const requestSchema = z.object({
  network: z.string().trim(),
  txHash: z.string().trim().min(8).max(128),
  sentUsdtAmount: z.string().trim().refine(isPositiveUsdtSentAmount),
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
    return usdtSubmitError(error.message);
  }

  const { data: owned, error: ownedError } = await admin
    .from("usdt_manual_deposits")
    .select("id")
    .eq("id", data)
    .eq("user_id", identity.userId)
    .maybeSingle();
  if (ownedError || !owned) {
    return apiError({
      code: "USDT_DEPOSIT_CONFLICT",
      message: "이 거래는 접수할 수 없어요. 거래 해시를 확인해 주세요.",
      status: 409,
    });
  }

  return apiSuccess({ depositId: owned.id }, 201);
}

function usdtSubmitError(message: string | undefined) {
  const text = message ?? "";
  if (text.includes("INVALID_USDT_MANUAL_DEPOSIT")) {
    return apiError({
      code: "INVALID_USDT_DEPOSIT",
      message: "입금 확인 정보를 확인해 주세요.",
      status: 400,
    });
  }
  if (text.includes("USDT_DEPOSIT_INSTRUCTIONS_UNAVAILABLE")) {
    return apiError({
      code: "USDT_DEPOSIT_UNAVAILABLE",
      message: "입금 안내를 준비하고 있어요. 잠시 후 다시 시도해 주세요.",
      status: 409,
    });
  }
  return apiError({
    code: "USDT_DEPOSIT_SUBMIT_FAILED",
    message: "USDT 입금 확인 요청을 접수하지 못했어요.",
    status: 503,
  });
}
