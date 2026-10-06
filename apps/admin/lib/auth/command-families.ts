export const ADMIN_COMMAND_FAMILIES = {
  WITHDRAWAL_OPERATOR: "WITHDRAWAL_OPERATOR",
  KYC_REVIEW: "KYC_REVIEW",
  SAFE_MODE: "SAFE_MODE",
  RESTRICTION: "RESTRICTION",
  DEPOSIT_CONFIRM: "DEPOSIT_CONFIRM",
  DEPOSIT_APPROVE: "DEPOSIT_APPROVE",
  RECONCILIATION_ACK: "RECONCILIATION_ACK",
  ECONOMY_POLICY: "ECONOMY_POLICY",
  PRODUCT_CATALOG: "PRODUCT_CATALOG",
} as const;

export type AdminCommandFamily =
  (typeof ADMIN_COMMAND_FAMILIES)[keyof typeof ADMIN_COMMAND_FAMILIES];

export function isAdminCommandFamily(
  value: unknown,
): value is AdminCommandFamily {
  return (
    typeof value === "string" &&
    (Object.values(ADMIN_COMMAND_FAMILIES) as string[]).includes(value)
  );
}
