/**
 * WORKROOM monitoring settlement calculation.
 *
 * The SQL function workroom_settle is the authority for balance changes.
 * These helpers mirror the SQL curve formula for client-side display only.
 */

/**
 * Calculate the monitoring payout for a completed session.
 *
 * payout = stake × (100 + roi) / 100  (rounded)
 *
 * This matches the SQL workroom_settle formula at progress=1.0.
 */
export function calculateMonitoringPayout(
  stakeKrw: number,
  roiPercent: number,
): number {
  return Math.round((stakeKrw * (100 + roiPercent)) / 100);
}

/**
 * Calculate the profit portion of a completed session.
 *
 * profit = payout - stake = stake × roi / 100
 */
export function calculateMonitoringProfit(
  stakeKrw: number,
  roiPercent: number,
): number {
  return calculateMonitoringPayout(stakeKrw, roiPercent) - stakeKrw;
}

/**
 * Calculate monitoring progress (0.0 to 1.0).
 */
export function calculateProgress(
  startedAtMs: number,
  durationSeconds: number,
  nowMs: number,
): number {
  if (durationSeconds <= 0) return 1;
  return Math.max(0, Math.min(1, (nowMs - startedAtMs) / (durationSeconds * 1000)));
}

/**
 * Check whether a monitoring session is complete based on elapsed time.
 */
export function isMonitoringComplete(
  startedAtMs: number,
  durationSeconds: number,
  nowMs: number,
): boolean {
  return calculateProgress(startedAtMs, durationSeconds, nowMs) >= 1;
}

/**
 * Calculate remaining time in seconds.
 */
export function calculateRemainingSeconds(
  startedAtMs: number,
  durationSeconds: number,
  nowMs: number,
): number {
  return Math.max(0, Math.ceil(durationSeconds * (1 - calculateProgress(startedAtMs, durationSeconds, nowMs))));
}
