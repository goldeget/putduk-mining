"use server";

import { z } from "zod";

import {
  mapRpcFailure,
  newIdempotencyKey,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { createAdminServiceClient } from "@/lib/supabase/service";

const confirmSchema = z.object({
  depositId: z.uuid(),
  creditedKrw: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{0,14}$/),
  reason: z.string().trim().min(10).max(500),
  confirmation: z.literal("CONFIRM_USDT_DEPOSIT"),
});

export async function confirmUsdtManualDepositAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.DEPOSIT_CONFIRM,
    formData,
  );
  if (!access.ok) return access.result;

  const parsed = confirmSchema.safeParse({
    depositId: formData.get("depositId"),
    creditedKrw: formData.get("creditedKrw"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "입금 확인 입력값을 다시 확인해 주세요.",
    };
  }

  const credited = Number.parseInt(parsed.data.creditedKrw, 10);
  const db = createAdminServiceClient();
  const { error } = await db.rpc("confirm_usdt_manual_deposit", {
    p_deposit_id: parsed.data.depositId,
    p_credited_krw: credited,
    p_actor: access.principal.userId,
    p_reason: parsed.data.reason,
    p_idempotency_key: newIdempotencyKey("usdt_dep"),
  });

  if (error) {
    return mapRpcFailure(
      error.message,
      "USDT 입금 확인을 완료하지 못했습니다.",
    );
  }

  return {
    ok: true,
    message: `입금을 확인했습니다. 원화 ${credited.toLocaleString("ko-KR")}원이 반영됩니다.`,
  };
}
