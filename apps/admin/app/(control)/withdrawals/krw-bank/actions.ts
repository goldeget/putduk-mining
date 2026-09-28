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

const recordSchema = z.object({
  withdrawalId: z.uuid(),
  bankReference: z.string().trim().min(2).max(200),
  actualKrw: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{0,14}$/),
  sentAt: z.string().trim().min(1),
  confirmation: z.literal("RECORD_KRW_SEND"),
});

const finalizeSchema = z.object({
  withdrawalId: z.uuid(),
  confirmation: z.literal("FINALIZE_LEDGER"),
});

const releaseSchema = z.object({
  withdrawalId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
  confirmation: z.enum(["REJECT_HOLD", "CANCEL_HOLD"]),
});

function releaseDisposition(
  confirmation: "REJECT_HOLD" | "CANCEL_HOLD",
): "REJECTED" | "CANCELLED" {
  return confirmation === "REJECT_HOLD" ? "REJECTED" : "CANCELLED";
}

export async function recordKrwExternalSendAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR,
    formData,
  );
  if (!access.ok) return access.result;

  const parsed = recordSchema.safeParse({
    withdrawalId: formData.get("withdrawalId"),
    bankReference: formData.get("bankReference"),
    actualKrw: formData.get("actualKrw"),
    sentAt: formData.get("sentAt"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "계좌 송금 기록 입력값을 확인해 주세요.",
    };
  }

  const sentAt = new Date(parsed.data.sentAt);
  if (Number.isNaN(sentAt.getTime())) {
    return {
      ok: false,
      code: "INVALID_SENT_AT",
      message: "송금 시각을 다시 확인해 주세요.",
    };
  }

  const service = createAdminServiceClient();
  const { data: existingSends, error: existingError } = await service
    .from("withdrawal_external_sends")
    .select("id")
    .eq("withdrawal_id", parsed.data.withdrawalId)
    .limit(1);
  if (!existingError && existingSends && existingSends.length > 0) {
    return {
      ok: true,
      message:
        "외부 송금은 이미 기록되어 있습니다. 다시 보내지 말고 원장만 확정하세요.",
    };
  }

  const { error } = await service.rpc("record_krw_external_send", {
    p_withdrawal_id: parsed.data.withdrawalId,
    p_bank_reference: parsed.data.bankReference,
    p_actual_krw_amount: Number.parseInt(parsed.data.actualKrw, 10),
    p_actor: access.principal.userId,
    p_sent_at: sentAt.toISOString(),
    p_idempotency_key: newIdempotencyKey("krw_send"),
  });

  if (error) {
    return mapRpcFailure(error.message, "계좌 송금 기록을 남기지 못했습니다.");
  }
  return {
    ok: true,
    message: "계좌 송금을 기록했습니다. 이제 원장만 확정하면 됩니다.",
  };
}

export async function finalizeWithdrawalLedgerAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR,
    formData,
  );
  if (!access.ok) return access.result;

  const parsed = finalizeSchema.safeParse({
    withdrawalId: formData.get("withdrawalId"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "원장 확정 입력을 확인해 주세요.",
    };
  }

  const service = createAdminServiceClient();
  const { data: current, error: currentError } = await service
    .from("withdrawal_requests")
    .select("finalize_ledger_transaction_id")
    .eq("id", parsed.data.withdrawalId)
    .maybeSingle();
  if (!currentError && current?.finalize_ledger_transaction_id) {
    return { ok: true, message: "출금 원장은 이미 확정되어 있습니다." };
  }

  const { error } = await service.rpc("finalize_withdrawal_ledger", {
    p_withdrawal_id: parsed.data.withdrawalId,
    p_actor: access.principal.userId,
    p_idempotency_key: newIdempotencyKey("wd_fin"),
  });

  if (error) {
    return mapRpcFailure(
      error.message,
      "원장 확정을 완료하지 못했습니다. 외부 송금이 먼저 기록됐는지 확인하세요.",
    );
  }
  return { ok: true, message: "출금 원장을 확정했습니다." };
}

export async function releaseWithdrawalHoldAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR,
    formData,
  );
  if (!access.ok) return access.result;

  const parsed = releaseSchema.safeParse({
    withdrawalId: formData.get("withdrawalId"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "거절 또는 취소 사유를 확인해 주세요.",
    };
  }

  const disposition = releaseDisposition(parsed.data.confirmation);

  const { error } = await createAdminServiceClient().rpc(
    "release_withdrawal_hold",
    {
      p_withdrawal_id: parsed.data.withdrawalId,
      p_actor: access.principal.userId,
      p_reason: parsed.data.reason,
      p_idempotency_key: newIdempotencyKey("wd_rel"),
      p_disposition: disposition,
    },
  );

  if (error) {
    return mapRpcFailure(
      error.message,
      "보류 금액을 해제하지 못했습니다. 외부 송금 이후에는 해제할 수 없습니다.",
    );
  }
  return {
    ok: true,
    message:
      disposition === "REJECTED"
        ? "출금을 거절하고 보류 금액을 해제했습니다."
        : "출금을 취소하고 보류 금액을 해제했습니다.",
  };
}
