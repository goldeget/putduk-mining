/**
 * WORKROOM signup bonus domain logic.
 *
 * Every new member receives a signup bonus (default 100,000 KRW) that is
 * automatically credited to their monitoring balance. The bonus itself
 * cannot be withdrawn — only the profit earned through monitoring sessions.
 * When a user requests a withdrawal, the operator recovers the bonus
 * principal via the recover_signup_bonus SQL function.
 */

import type { SignupBonusStatus } from "../workroom/monitoring-policy";

/** Check whether a user's signup bonus has been recovered. */
export function isBonusRecovered(status: SignupBonusStatus | null): boolean {
  return status?.recovered ?? false;
}

/** Check whether a user is eligible for bonus profit withdrawal. */
export function canWithdrawBonusProfit(
  status: SignupBonusStatus | null,
  availableBalanceKrw: number,
  minWithdrawalKrw: number,
  maxBonusProfitWithdrawalKrw: number,
): boolean {
  if (!status || status.recovered) return false;
  return (
    availableBalanceKrw >= minWithdrawalKrw &&
    availableBalanceKrw <= maxBonusProfitWithdrawalKrw + Number(status.granted)
  );
}

/**
 * Determine the maximum withdrawal amount for a bonus-only user.
 * The user can withdraw profit up to maxBonusProfitWithdrawalKrw,
 * but only after the operator recovers the bonus principal.
 */
export function maxBonusWithdrawalKrw(
  balanceKrw: number,
  bonusGrantedKrw: number,
  maxBonusProfitWithdrawalKrw: number,
): number {
  const profitAfterRecovery = balanceKrw - bonusGrantedKrw;
  return Math.min(Math.max(0, profitAfterRecovery), maxBonusProfitWithdrawalKrw);
}
