import { acknowledgeReconciliationExceptionAction } from "@/app/(control)/exceptions/actions";
import { reviewKycCaseAction } from "@/app/(control)/kyc/actions";
import { setKrwDepositSettingsAction } from "@/app/(control)/deposits/krw/instruction-actions";
import { confirmUsdtManualDepositAction } from "@/app/(control)/deposits/usdt/actions";
import { setUsdtDepositInstructionAction } from "@/app/(control)/deposits/usdt/instruction-actions";
import { setSafeModeAction } from "@/app/(control)/restrictions/actions";
import {
  finalizeWithdrawalLedgerAction,
  recordKrwExternalSendAction,
  releaseWithdrawalHoldAction,
} from "@/app/(control)/withdrawals/krw-bank/actions";
import {
  finalizeUsdtWithdrawalLedgerAction,
  recordUsdtExternalSendAction,
  releaseUsdtWithdrawalHoldAction,
} from "@/app/(control)/withdrawals/usdt/actions";
import type { CommandActionResult } from "@/app/(control)/_lib/command-gate";

export const runtime = "nodejs";

const invalidResult: CommandActionResult = {
  ok: false,
  code: "INVALID_INPUT",
  message: "처리 명령을 확인하지 못했습니다.",
};

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(invalidResult, { status: 400 });
  }

  const actionName = String(formData.get("__adminAction") ?? "");
  formData.delete("__adminAction");

  let result: CommandActionResult;
  switch (actionName) {
    case "acknowledgeReconciliationExceptionAction":
      result = await acknowledgeReconciliationExceptionAction(null, formData);
      break;
    case "reviewKycCaseAction":
      result = await reviewKycCaseAction(null, formData);
      break;
    case "setKrwDepositSettingsAction":
      result = await setKrwDepositSettingsAction(null, formData);
      break;
    case "confirmUsdtManualDepositAction":
      result = await confirmUsdtManualDepositAction(null, formData);
      break;
    case "setUsdtDepositInstructionAction":
      result = await setUsdtDepositInstructionAction(null, formData);
      break;
    case "setSafeModeAction":
      result = await setSafeModeAction(null, formData);
      break;
    case "finalizeWithdrawalLedgerAction":
      result = await finalizeWithdrawalLedgerAction(null, formData);
      break;
    case "recordKrwExternalSendAction":
      result = await recordKrwExternalSendAction(null, formData);
      break;
    case "releaseWithdrawalHoldAction":
      result = await releaseWithdrawalHoldAction(null, formData);
      break;
    case "finalizeUsdtWithdrawalLedgerAction":
      result = await finalizeUsdtWithdrawalLedgerAction(null, formData);
      break;
    case "recordUsdtExternalSendAction":
      result = await recordUsdtExternalSendAction(null, formData);
      break;
    case "releaseUsdtWithdrawalHoldAction":
      result = await releaseUsdtWithdrawalHoldAction(null, formData);
      break;
    default:
      return Response.json(invalidResult, { status: 400 });
  }

  return Response.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
