export type MemberCountResult = {
  count: number | null;
  error: { message: string } | null;
};

/** 실패를 0으로 위장하지 않는다. */
export function memberCountLabel(result: MemberCountResult): string {
  if (!isReadyCount(result)) return "확인 필요";
  return result.count.toLocaleString("ko-KR");
}

function isReadyCount(
  result: MemberCountResult,
): result is MemberCountResult & { count: number } {
  return (
    !result.error &&
    result.count !== null &&
    Number.isSafeInteger(result.count) &&
    result.count >= 0
  );
}

/** Each canonical method must be known before a total can be stated. */
export function combineMemberCounts(
  ...results: MemberCountResult[]
): MemberCountResult {
  let count = 0;
  for (const result of results) {
    if (!isReadyCount(result) || !Number.isSafeInteger(count + result.count)) {
      return { count: null, error: { message: "MEMBER_COUNT_UNAVAILABLE" } };
    }
    count += result.count;
  }
  return { count, error: null };
}

export function anyMemberCountFailed(
  results: readonly MemberCountResult[],
): boolean {
  return results.some((result) => !isReadyCount(result));
}
