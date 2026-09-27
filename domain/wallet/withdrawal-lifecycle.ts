export const WITHDRAWAL_HOLD_STATES = [
  "REQUESTED",
  "HELD",
  "ADMIN_PROCESSING",
  "EXTERNAL_SENT_RECORDED",
] as const;

export const WITHDRAWAL_TERMINAL_STATES = [
  "LEDGER_FINALIZED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;

export const WITHDRAWAL_RELEASE_DISPOSITIONS = [
  "REJECTED",
  "CANCELLED",
] as const;

export type WithdrawalHoldState = (typeof WITHDRAWAL_HOLD_STATES)[number];
export type WithdrawalReleaseDisposition =
  (typeof WITHDRAWAL_RELEASE_DISPOSITIONS)[number];

export function canReleaseWithdrawalHold(status: string): boolean {
  return (
    status === "REQUESTED" ||
    status === "HELD" ||
    status === "ADMIN_PROCESSING" ||
    status === "REVIEWING" ||
    status === "APPROVED" ||
    status === "PROCESSING"
  );
}

export function canFinalizeWithdrawalLedger(status: string): boolean {
  return status === "EXTERNAL_SENT_RECORDED";
}

export function shouldRetryExternalSend(status: string): boolean {
  return (
    status !== "EXTERNAL_SENT_RECORDED" &&
    status !== "LEDGER_FINALIZED" &&
    status !== "COMPLETED"
  );
}

/** Operator rejection ends REJECTED; user/operator cancellation ends CANCELLED. */
export function resolveReleaseDisposition(
  kind: "reject" | "cancel",
): WithdrawalReleaseDisposition {
  return kind === "reject" ? "REJECTED" : "CANCELLED";
}

export function isWithdrawalReleaseDisposition(
  value: string,
): value is WithdrawalReleaseDisposition {
  return value === "REJECTED" || value === "CANCELLED";
}
