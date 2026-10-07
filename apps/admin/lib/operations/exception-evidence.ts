/** Presentation only. Never calculate balances or interpret an unknown evidence field. */
const amounts: Record<string, string> = {
  amount_atomic: "기록 금액",
  approved_amount_atomic: "승인 금액",
  wallet_amount_atomic: "지갑 반영 금액",
  debit_atomic: "차변 기록 금액",
  credit_atomic: "대변 기록 금액",
  projection_atomic: "지갑 반영 금액",
  wallet_total_atomic: "지갑 총액",
  liability_net_atomic: "부채 순액",
  posted_open_hold_atomic: "미해제 출금 보류액",
  ui_total_atomic: "화면 총액",
  finalize_amount_atomic: "확정 대상 금액",
  finalize_debit_atomic: "확정 차변 금액",
};
const counts: Record<string, string> = {
  minimum_entries: "필요한 거래 항목",
  entry_count: "거래 항목",
  currency_count: "통화 종류",
  wallet_projection_count: "지갑 반영 기록",
  projection_count: "지갑 반영 기록",
  journal_count: "분개 기록",
  outbox_count: "후속 처리 기록",
};

function integer(value: unknown): string | null {
  if (typeof value === "number")
    return Number.isSafeInteger(value)
      ? BigInt(value).toLocaleString("ko-KR")
      : null;
  if (typeof value !== "string" || !/^-?\d{1,100}$/.test(value)) return null;
  return BigInt(value).toLocaleString("ko-KR");
}

export function describeExceptionEvidence(value: unknown): string {
  if (value === null || value === undefined) return "기록 없음";
  if (typeof value !== "object" || Array.isArray(value))
    return "증거 형식을 확인해야 해요. 담당자에게 원본 기록 검토를 요청해 주세요.";
  const fields = Object.entries(value);
  const lines: string[] = [];
  let unknown = false;
  for (const [key, entry] of fields) {
    const number = integer(entry);
    if (Object.hasOwn(amounts, key) && number !== null) {
      // Atomic currency is not assumed to be KRW when the evidence omits currency.
      lines.push(`${amounts[key]}: ${number} (기록 단위)`);
    } else if (
      Object.hasOwn(counts, key) &&
      number !== null &&
      !number.startsWith("-")
    ) {
      lines.push(`${counts[key]}: ${number}건`);
    } else if (
      (key === "ok" || key === "debit_equals_credit") &&
      typeof entry === "boolean"
    ) {
      lines.push(
        `${key === "ok" ? "검증 결과" : "차변·대변 일치"}: ${entry ? "조건 충족" : "조건 미충족"}`,
      );
    } else if (key === "currency" && entry === "KRW") {
      lines.push("통화: 원화");
    } else {
      unknown = true;
    }
  }
  if (unknown || lines.length === 0)
    lines.push("별도 증거 검토 필요 · 알려지지 않은 항목은 해석하지 않았어요.");
  return lines.join(" · ");
}

export function exceptionSubjectLabel(subject: unknown): string {
  const labels: Record<string, string> = {
    ledger_transaction: "거래 원장",
    trial_reward_conversion: "환영 보상 반영",
    deposit_request: "입금 요청",
    withdrawal_request: "출금 요청",
    wallet_account: "회원 지갑",
  };
  return typeof subject === "string" && Object.hasOwn(labels, subject)
    ? labels[subject]!
    : "운영 기록 검토";
}
