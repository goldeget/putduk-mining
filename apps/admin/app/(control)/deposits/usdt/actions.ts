"use server";

import {
  mapRpcFailure,
  prepareMoneyAttempt,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { usdtDepositConfirmInput } from "@/lib/deposits/usdt-confirm-input";
import { verifyUsdtDepositReceipt } from "@/lib/deposits/usdt-confirm-receipt";
import { createAdminServiceClient } from "@/lib/supabase/service";

export async function confirmUsdtManualDepositAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const prepared = prepareMoneyAttempt(formData);
  if (!prepared.ok) return prepared.result;
  const parsed = usdtDepositConfirmInput.safeParse({
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

  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.DEPOSIT_CONFIRM,
    formData,
  );
  if (!access.ok) return access.result;

  const unconfirmed: CommandActionResult = {
    ok: false,
    code: "UNCONFIRMED",
    message:
      "입금 반영을 아직 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
  };
  try {
    const db = createAdminServiceClient();
    const { data: transactionId, error } = await db.rpc(
      "confirm_usdt_manual_deposit",
      {
        p_deposit_id: parsed.data.depositId,
        p_credited_krw: parsed.data.creditedKrw,
        p_actor: access.principal.userId,
        p_reason: parsed.data.reason,
        p_idempotency_key: prepared.idempotencyKey,
      },
    );

    if (error) {
      return mapRpcFailure(
        error.message,
        "USDT 입금 확인을 완료하지 못했습니다.",
      );
    }
    const confirmed = await db
      .from("usdt_manual_deposits")
      .select(
        "id,user_id,status,credited_krw,ledger_transaction_id,wallet_ledger_id",
      )
      .eq("id", parsed.data.depositId)
      .maybeSingle();
    if (
      confirmed.error ||
      !confirmed.data?.ledger_transaction_id ||
      !confirmed.data?.wallet_ledger_id
    ) {
      return unconfirmed;
    }
    const [journal, wallet] = await Promise.all([
      db
        .from("ledger_transactions")
        .select(
          "id,category,currency,reference_type,reference_id,member_user_id",
        )
        .eq("id", confirmed.data.ledger_transaction_id)
        .maybeSingle(),
      db
        .from("wallet_ledger")
        .select(
          "id,user_id,direction,entry_type,amount_atomic,reference_type,reference_id",
        )
        .eq("id", confirmed.data.wallet_ledger_id)
        .maybeSingle(),
    ]);
    if (journal.error || wallet.error) return unconfirmed;
    const receipt = verifyUsdtDepositReceipt({
      depositId: parsed.data.depositId,
      requestedKrw: parsed.data.creditedKrw,
      rpcTransactionId: transactionId,
      deposit: confirmed.data,
      journal: journal.data,
      wallet: wallet.data,
    });
    if (!receipt.ok) {
      if (receipt.code === "UNCONFIRMED") return unconfirmed;
      return {
        ok: false,
        code: "AMOUNT_MISMATCH",
        message:
          "이미 다른 금액으로 처리되었습니다. 입금 내역을 확인해 주세요.",
      };
    }

    return {
      ok: true,
      message: `입금을 확인했습니다. 원화 ${BigInt(receipt.creditedKrw).toLocaleString("ko-KR")}원이 반영됐습니다.`,
    };
  } catch {
    // 응답이 끊겨도 이미 반영됐을 수 있다. 실패나 성공을 추측하지 않는다.
    return unconfirmed;
  }
}
