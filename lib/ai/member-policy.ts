import "server-only";

export const MEMBER_AI_MAX_REQUESTS_PER_MINUTE = 5;
export const MEMBER_AI_MAX_REQUESTS_PER_DAY = 100;

/** Configuration may lower these ceilings. Atomic counting and replay remain
 * the responsibility of the canonical DB admission, across all providers. */
export function assertMemberAiLimits(input: {
  perMinuteLimit: number;
  perDayLimit: number;
}): void {
  if (
    !Number.isSafeInteger(input.perMinuteLimit) ||
    input.perMinuteLimit < 1 ||
    input.perMinuteLimit > MEMBER_AI_MAX_REQUESTS_PER_MINUTE ||
    !Number.isSafeInteger(input.perDayLimit) ||
    input.perDayLimit < 1 ||
    input.perDayLimit > MEMBER_AI_MAX_REQUESTS_PER_DAY
  )
    throw new Error("AI_LIMIT_POLICY_INVALID");
}
