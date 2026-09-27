export type UsdtDepositNetwork = "TRC20" | "ERC20" | "BEP20";

export function isUsdtDepositNetwork(
  value: string,
): value is UsdtDepositNetwork {
  return value === "TRC20" || value === "ERC20" || value === "BEP20";
}

export function assertManualUsdtDepositSnapshots(input: {
  depositAddressSnapshot: string;
  networkSnapshot: string;
}): void {
  if (!input.depositAddressSnapshot.trim() || !input.networkSnapshot.trim()) {
    throw new Error("USDT_DEPOSIT_SNAPSHOT_REQUIRED");
  }
}
