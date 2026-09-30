import "server-only";

import { apiError } from "@/lib/api/http";
import { WITHDRAWAL_RECONCILIATION_COPY } from "@/lib/wallet/withdrawal-logical-request";

/** Internal SQL text is inspected only on the server; never returned verbatim. */
export function withdrawalLogicalApiError(error: { message: string }) {
  const recoverable = [
    "WITHDRAWAL_LOGICAL_PENDING",
    "WITHDRAWAL_LOGICAL_MISMATCH",
    "WITHDRAWAL_LOGICAL_NOT_FOUND",
    "WITHDRAWAL_LOGICAL_RECONCILIATION_REQUIRED",
    "WITHDRAWAL_LOGICAL_POLICY_CHANGED",
    "WITHDRAWAL_LOGICAL_CONFIRMATION_REQUIRED",
  ];
  return apiError({
    code: recoverable.some((code) => error.message.includes(code))
      ? "WITHDRAWAL_RECONCILIATION_REQUIRED"
      : "WITHDRAWAL_REQUEST_FAILED",
    message: WITHDRAWAL_RECONCILIATION_COPY,
    status: 409,
  });
}
