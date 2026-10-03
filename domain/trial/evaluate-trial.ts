import "server-only";

export const TRIAL_QUOTA_BPS = 10_000;
export const MAX_TRIAL_DURATION_MS = 24 * 60 * 60 * 1_000;

export type TrialCompletionReason = "QUOTA" | "TIME";

export type TrialEvaluation = {
  completionReason: TrialCompletionReason | null;
  elapsedMilliseconds: number;
  isComplete: boolean;
  quotaConsumedBps: number;
  remainingMilliseconds: number;
  status: "ACTIVE" | "COMPLETED";
};

export function evaluateTrial({
  durationMilliseconds,
  quotaConsumedBps,
  serverNow,
  startedAt,
}: {
  durationMilliseconds: number;
  quotaConsumedBps: number;
  serverNow: Date;
  startedAt: Date;
}): TrialEvaluation {
  if (
    !Number.isSafeInteger(durationMilliseconds) ||
    durationMilliseconds <= 0 ||
    durationMilliseconds > MAX_TRIAL_DURATION_MS
  ) {
    throw new RangeError("Trial duration must be between 1ms and 24 hours.");
  }

  if (!Number.isSafeInteger(quotaConsumedBps) || quotaConsumedBps < 0) {
    throw new RangeError(
      "Trial quota must be a non-negative basis-point value.",
    );
  }

  const elapsedMilliseconds = serverNow.getTime() - startedAt.getTime();
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    throw new RangeError("Server time must be at or after trial start time.");
  }

  const reachedQuota = quotaConsumedBps >= TRIAL_QUOTA_BPS;
  const reachedTimeLimit = elapsedMilliseconds >= durationMilliseconds;
  const completionReason: TrialCompletionReason | null = reachedQuota
    ? "QUOTA"
    : reachedTimeLimit
      ? "TIME"
      : null;

  return {
    completionReason,
    elapsedMilliseconds: Math.min(elapsedMilliseconds, durationMilliseconds),
    isComplete: completionReason !== null,
    quotaConsumedBps: Math.min(quotaConsumedBps, TRIAL_QUOTA_BPS),
    remainingMilliseconds: Math.max(
      0,
      durationMilliseconds - elapsedMilliseconds,
    ),
    status: completionReason ? "COMPLETED" : "ACTIVE",
  };
}
