"use server";

import { z } from "zod";

import {
  mapRpcFailure,
  prepareMoneyAttempt,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { createAdminServiceClient } from "@/lib/supabase/service";
import { parseKstDateTimeInput } from "@/lib/time/kst-input";
import {
  manualUsdtPayoutFailure,
  normalizeManualUsdtAmount,
  parseManualUsdtFullPayoutEvidence,
} from "@/lib/withdrawals/usdt-manual-payout-contract";

const recordSchema = z.object({
  withdrawalId: z.uuid(),
  network: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(["TRC20", "ERC20", "BEP20"])),
  txHash: z.string().trim().min(8).max(128),
  actualUsdt: z
    .string()
    .trim()
    .regex(/^[0-9]+(\.[0-9]{1,6})?$/)
    .refine((value) => /[1-9]/.test(value)),
  fullPayoutConfirmed: z.literal("true"),
  sentAt: z.string().trim().min(1),
  confirmation: z.literal("RECORD_USDT_SEND"),
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

export async function recordUsdtExternalSendAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const prepared = prepareMoneyAttempt(formData);
  if (!prepared.ok) return prepared.result;
  const parsed = recordSchema.safeParse({
    withdrawalId: formData.get("withdrawalId"),
    network: formData.get("network"),
    txHash: formData.get("txHash"),
    actualUsdt: formData.get("actualUsdt"),
    fullPayoutConfirmed: formData.get("fullPayoutConfirmed"),
    sentAt: formData.get("sentAt"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "USDT 송금 기록 입력값을 확인해 주세요.",
    };
  }

  const sentAt = parseKstDateTimeInput(parsed.data.sentAt);
  if (!sentAt) {
    return {
      ok: false,
      code: "INVALID_SENT_AT",
      message: "송금 시각을 다시 확인해 주세요.",
    };
  }

  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.WITHDRAWAL_OPERATOR,
    formData,
  );
  if (!access.ok) return access.result;

  const service = createAdminServiceClient();
  // Hidden fields and free-form notes cannot establish the requested KRW amount.
  const original = await service
    .from("withdrawal_requests")
    .select(
      "id,user_id,amount_atomic,fee_atomic,currency,destination_type,withdrawal_destination_id",
    )
    .eq("id", parsed.data.withdrawalId)
    .maybeSingle();
  const originalSchema = z.object({
    id: z.uuid(),
    user_id: z.uuid(),
    amount_atomic: z.union([
      z.string().regex(/^[1-9][0-9]{0,18}$/),
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ]),
    fee_atomic: z.union([z.literal(0), z.literal("0")]),
    currency: z.literal("KRW"),
    destination_type: z.literal("USDT_ADDRESS"),
    withdrawal_destination_id: z.uuid(),
  });
  const request = originalSchema.safeParse(original.data);
  const unavailable: CommandActionResult = {
    ok: false,
    code: "USDT_MANUAL_FULL_PAYOUT_REQUEST_MISMATCH",
    message:
      "원화 출금 요청 원본을 확인하지 못했습니다. 다시 송금하지 말고 기존 요청을 확인해 주세요.",
  };
  if (
    original.error ||
    !request.success ||
    request.data.id !== parsed.data.withdrawalId
  )
    return unavailable;
  const history = await service
    .from("withdrawal_destination_history")
    .select("user_id,destination_type,metadata")
    .eq("destination_id", request.data.withdrawal_destination_id)
    .eq("action", "REGISTERED")
    .limit(2);
  const registered = z
    .object({
      user_id: z.uuid(),
      destination_type: z.literal("USDT_ADDRESS"),
      metadata: z.object({ network: z.enum(["TRC20", "ERC20", "BEP20"]) }),
    })
    .safeParse(history.data?.[0]);
  if (
    history.error ||
    history.data?.length !== 1 ||
    !registered.success ||
    registered.data.user_id !== request.data.user_id
  ) {
    return {
      ok: false,
      ...manualUsdtPayoutFailure("USDT_DESTINATION_NETWORK_ORIGINAL_REQUIRED")!,
    };
  }
  if (registered.data.metadata.network !== parsed.data.network) {
    return {
      ok: false,
      ...manualUsdtPayoutFailure("USDT_SEND_NETWORK_MISMATCH")!,
    };
  }
  const actualUsdtAmount = normalizeManualUsdtAmount(parsed.data.actualUsdt);
  if (!actualUsdtAmount)
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "실제 USDT 송금액을 확인해 주세요.",
    };
  const requestedKrwAmount = String(request.data.amount_atomic);
  const conversionEvidence = parseManualUsdtFullPayoutEvidence(
    {
      version: 1,
      basis: "OPERATOR_MANUAL_FULL_PAYOUT",
      withdrawalId: request.data.id,
      requestedKrwAmount,
      actualUsdtAmount,
      network: registered.data.metadata.network,
      feeKrw: "0",
      fullPayoutConfirmed: parsed.data.fullPayoutConfirmed === "true",
    },
    {
      withdrawalId: request.data.id,
      requestedKrwAmount,
      actualUsdtAmount,
      network: registered.data.metadata.network,
    },
  );
  if (!conversionEvidence) return unavailable;
  const { data: sendId, error } = await service.rpc(
    "record_usdt_external_send",
    {
      p_withdrawal_id: parsed.data.withdrawalId,
      p_network: parsed.data.network,
      p_tx_hash: parsed.data.txHash,
      p_actual_usdt_amount: actualUsdtAmount,
      p_conversion_evidence: conversionEvidence,
      p_actor: access.principal.userId,
      p_sent_at: sentAt,
      p_idempotency_key: prepared.idempotencyKey,
    },
  );

  if (error) {
    if (
      error.message.includes("IDEMPOTENCY_KEY_REUSED") ||
      error.message.includes("EXTERNAL_SEND_PAYLOAD_MISMATCH")
    ) {
      return {
        ok: false,
        code: error.message.includes("IDEMPOTENCY_KEY_REUSED")
          ? "IDEMPOTENCY_KEY_REUSED"
          : "EXTERNAL_SEND_PAYLOAD_MISMATCH",
        message:
          "기록된 송금과 입력 내용이 다릅니다. 다시 송금하지 말고 기존 기록을 확인해 주세요.",
      };
    }
    const manualFailure = manualUsdtPayoutFailure(error.message);
    if (manualFailure) return { ok: false, ...manualFailure };
    return mapRpcFailure(error.message, "USDT 송금 기록을 남기지 못했습니다.");
  }
  const unconfirmed: CommandActionResult = {
    ok: false,
    code: "UNCONFIRMED",
    message:
      "송금 기록을 아직 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
  };
  if (!z.uuid().safeParse(sendId).success) return unconfirmed;
  const recordedSend = await service
    .from("withdrawal_external_sends")
    .select("id,withdrawal_id,method")
    .eq("id", sendId)
    .eq("withdrawal_id", parsed.data.withdrawalId)
    .eq("method", "USDT_ADDRESS")
    .limit(1);
  const receipt = recordedSend.data?.[0];
  if (
    recordedSend.error ||
    !receipt ||
    receipt.id !== sendId ||
    receipt.withdrawal_id !== parsed.data.withdrawalId ||
    receipt.method !== "USDT_ADDRESS"
  )
    return unconfirmed;
  return {
    ok: true,
    message:
      "USDT 외부 송금을 기록했습니다. 다시 보내지 말고 원장만 확정하세요.",
  };
}

export async function finalizeUsdtWithdrawalLedgerAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const prepared = prepareMoneyAttempt(formData);
  if (!prepared.ok) return prepared.result;
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
    p_idempotency_key: prepared.idempotencyKey,
  });

  if (error) {
    return mapRpcFailure(error.message, "원장 확정을 완료하지 못했습니다.");
  }
  const finalized = await service
    .from("withdrawal_requests")
    .select("finalize_ledger_transaction_id")
    .eq("id", parsed.data.withdrawalId)
    .maybeSingle();
  if (finalized.error || !finalized.data?.finalize_ledger_transaction_id) {
    return {
      ok: false,
      code: "UNCONFIRMED",
      message:
        "원장 확정을 아직 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
    };
  }
  return { ok: true, message: "USDT 출금 원장을 확정했습니다." };
}

export async function releaseUsdtWithdrawalHoldAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const prepared = prepareMoneyAttempt(formData);
  if (!prepared.ok) return prepared.result;
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
      p_idempotency_key: prepared.idempotencyKey,
      p_disposition: disposition,
    },
  );

  if (error) {
    return mapRpcFailure(error.message, "보류 금액을 해제하지 못했습니다.");
  }
  const released = await createAdminServiceClient()
    .from("withdrawal_requests")
    .select("status")
    .eq("id", parsed.data.withdrawalId)
    .maybeSingle();
  if (released.error || released.data?.status !== disposition) {
    return {
      ok: false,
      code: "UNCONFIRMED",
      message:
        "해제 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
    };
  }
  return {
    ok: true,
    message:
      disposition === "REJECTED"
        ? "출금을 거절하고 보류 금액을 해제했습니다."
        : "출금을 취소하고 보류 금액을 해제했습니다.",
  };
}
