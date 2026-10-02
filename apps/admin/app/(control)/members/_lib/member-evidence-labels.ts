export type MemberCountResult = {
  count: number | null;
  error: { message: string } | null;
};

/** 실패를 0으로 위장하지 않는다. */
export function memberCountLabel(result: MemberCountResult): string {
  if (result.error || result.count === null) return "확인 필요";
  return result.count.toLocaleString("ko-KR");
}

export function anyMemberCountFailed(
  results: readonly MemberCountResult[],
): boolean {
  return results.some((result) => Boolean(result.error));
}
