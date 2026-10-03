/** 실패 창. 만료되면 다시 시도할 수 있으며 영구 잠금이 아니다. */
export const ADMIN_AUTH_FAILURE_MAX = 5;
export const ADMIN_AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** issue/consume step-up TTL(10분)과 같은 증명 유효 시간. */
export const ADMIN_AUTH_TOTP_PROOF_MAX_AGE_MS = 10 * 60 * 1000;
export const ADMIN_AUTH_PASSWORD_PROOF_MAX_AGE_MS = 15 * 60 * 1000;

export type FailureLimitDecision = "ALLOW" | "RATE_LIMITED";

/**
 * 최근 창 안의 실패 횟수만 본다.
 * IP 단독 키나 끝나지 않는 잠금은 쓰지 않는다.
 */
export function decideFailureLimit(recentCount: number): FailureLimitDecision {
  if (!Number.isFinite(recentCount) || recentCount < 0) return "RATE_LIMITED";
  return recentCount >= ADMIN_AUTH_FAILURE_MAX ? "RATE_LIMITED" : "ALLOW";
}
