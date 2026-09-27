/**
 * WS-04 출금 목적지 유형.
 * 기존 BANK_ACCOUNT 표기는 표시·정책 조회에서 KRW_BANK로만 매핑한다.
 */
export type WithdrawalDestinationMethod = "KRW_BANK" | "USDT_ADDRESS";

const LEGACY_BANK = "BANK_ACCOUNT";

export function normalizeDestinationMethod(
  value: string | null | undefined,
): WithdrawalDestinationMethod | null {
  if (!value) return null;
  if (value === "KRW_BANK" || value === LEGACY_BANK) return "KRW_BANK";
  if (value === "USDT_ADDRESS") return "USDT_ADDRESS";
  return null;
}

export function destinationMethodLabel(method: WithdrawalDestinationMethod) {
  return method === "KRW_BANK" ? "은행 계좌" : "USDT 주소";
}

export function destinationMethodHint(method: WithdrawalDestinationMethod) {
  return method === "KRW_BANK"
    ? "본인 명의 계좌로 원화 출금"
    : "KRW 잔액으로 요청 · USDT로 송금";
}
