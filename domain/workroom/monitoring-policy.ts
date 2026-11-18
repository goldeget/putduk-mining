/**
 * WORKROOM monitoring policy domain.
 *
 * The operator configures per-instrument settings (roi, duration, amplitude)
 * via the workroom_config SQL table. Global monitoring settings (signup bonus,
 * withdrawal limits, max concurrent sessions) live in workroom_monitoring_settings.
 *
 * This module provides TypeScript types and constants that mirror the SQL schema.
 */

/** Arithmetic unit: basis points (1% = 100 bps). */
export const BASIS_POINT_UNIT = 10_000n;

/** Micro-KRW per 1 KRW. Used for atomic money_source_movements amounts. */
export const MICRO_KRW_PER_KRW = 1_000_000n;

/** Microseconds per day. */
export const MICROSECONDS_PER_DAY = 86_400_000_000n;

/** Default signup bonus granted to every new member. */
export const SIGNUP_BONUS_KRW = 100_000n;

/** Minimum profit withdrawal amount (KRW). */
export const MIN_WITHDRAWAL_KRW = 5_000n;

/** Maximum bonus-profit withdrawal amount (KRW) — for signup-bonus-only users. */
export const MAX_BONUS_PROFIT_WITHDRAWAL_KRW = 10_000n;

/**
 * Per-instrument monitoring configuration.
 * Mirrors app_private.workroom_config SQL table.
 */
export interface MonitoringInstrumentConfig {
  instrument: string;
  pattern: "wave" | "slow" | "balanced";
  roi: number;
  duration: number;
  amplitude: number;
  version: number;
  minStakeKrw: number;
  maxStakeKrw: number;
}

/**
 * Global monitoring settings.
 * Mirrors app_private.workroom_monitoring_settings SQL table (singleton, id=1).
 */
export interface MonitoringSettings {
  signupBonusKrw: string;
  minWithdrawalKrw: string;
  maxBonusProfitWithdrawalKrw: string;
  maxConcurrentSessions: number;
}

/**
 * Signup bonus record for a user.
 * Mirrors app_private.workroom_signup_bonuses SQL table.
 */
export interface SignupBonusStatus {
  granted: string;
  grantedAt: number;
  recovered: boolean;
  recoveredAt: number | null;
}

/**
 * Validate that a stake amount falls within an instrument's configured range.
 */
export function validateStakeRange(
  stakeKrw: number,
  config: Pick<MonitoringInstrumentConfig, "minStakeKrw" | "maxStakeKrw">,
): boolean {
  return (
    Number.isFinite(stakeKrw) &&
    stakeKrw >= config.minStakeKrw &&
    stakeKrw <= config.maxStakeKrw
  );
}
