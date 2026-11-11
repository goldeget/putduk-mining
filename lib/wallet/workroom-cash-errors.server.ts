import "server-only";
import { apiError } from "@/lib/api/http";
import { withdrawalLogicalApiError } from "./withdrawal-logical-errors.server";

export function workroomCashApiError(error: { message: string }) {
  if (error.message?.includes("WITHDRAWAL_LOGICAL_"))
    return withdrawalLogicalApiError(error);
  const conflict = error.message?.includes("WORKROOM_CASH_") === true;
  return apiError({
    code: conflict ? "WORKROOM_CASH_CONFLICT" : "WITHDRAWAL_REQUEST_FAILED",
    message: conflict
      ? "입금 확인된 출금 가능 금액과 처리 상태를 다시 확인해 주세요."
      : "출금 요청을 접수하지 못했어요.",
    status: conflict ? 409 : 503,
  });
}
