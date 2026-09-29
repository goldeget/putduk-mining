/** 조회 실패와 빈 결과를 같은 상태로 두지 않는다. */
export function classifyDepositRead(input: {
  count: number;
  error: boolean;
}): "empty" | "error" | "ready" {
  if (input.error) {
    return "error";
  }
  if (input.count <= 0) {
    return "empty";
  }
  return "ready";
}
