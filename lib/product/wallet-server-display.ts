/**
 * Wallet funding display for the monitoring platform.
 * Shows the monitoring balance breakdown from workroom_accounts.
 */

export type WalletFundingRow = {
  label: string;
  value: string;
  tone: "separate" | "unconfirmed";
};

export type WalletFundingView =
  | { state: "empty" }
  | { state: "ready"; rows: WalletFundingRow[] };

/**
 * Present the monitoring balance as wallet funding rows.
 * The balance comes from workroom_accounts (signup bonus + deposits + profits).
 */
export function presentWalletFundingView(
  balanceKrw: string | null,
  signupBonusKrw: string | null,
  bonusRecovered: boolean,
): WalletFundingView {
  if (balanceKrw === null) {
    return { state: "empty" };
  }

  const rows: WalletFundingRow[] = [
    {
      label: "모니터링 잔액",
      tone: "separate" as const,
      value: `${Number(balanceKrw).toLocaleString("ko-KR")}원`,
    },
  ];

  if (signupBonusKrw && !bonusRecovered) {
    rows.push({
      label: "가입 충전금",
      tone: "separate" as const,
      value: `${Number(signupBonusKrw).toLocaleString("ko-KR")}원`,
    });
  }

  return { state: "ready", rows };
}
