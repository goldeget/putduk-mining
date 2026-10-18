/** Requests requiring an operator action, including sent transfers awaiting finalization. */
export const ACTIONABLE_WITHDRAWAL_STATUSES = [
  "REQUESTED",
  "REVIEWING",
  "APPROVED",
  "PROCESSING",
  "HELD",
  "ADMIN_PROCESSING",
  "EXTERNAL_SENT_RECORDED",
] as const;
