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

export type ApprovedDepositJournalState =
  | "matched"
  | "mismatch"
  | "missing"
  | "not_approved";

const ATOMIC_INTEGER = /^-?\d+$/;

function parseNullableAtomic(
  value: string | null,
  field: string,
): bigint | null {
  if (value === null) {
    return null;
  }
  if (!ATOMIC_INTEGER.test(value)) {
    throw new TypeError(`${field} must be an integer string.`);
  }
  return BigInt(value);
}

/**
 * 승인된 원화 입금이 분개·투영과 같은 승인액인지 분류한다.
 * 금액을 고치거나 과거 입금을 다시 적립하지 않는다.
 */
export function classifyApprovedDepositJournal(input: {
  approvedAmountAtomic: string | null;
  currency: string;
  journalCreditAtomic: string | null;
  journalDebitAtomic: string | null;
  projectionCreditAtomic: string | null;
  status: string;
}): ApprovedDepositJournalState {
  if (input.status !== "APPROVED") {
    return "not_approved";
  }
  if (input.currency !== "KRW") {
    return "mismatch";
  }

  const approved = parseNullableAtomic(
    input.approvedAmountAtomic,
    "approvedAmountAtomic",
  );
  const debit = parseNullableAtomic(
    input.journalDebitAtomic,
    "journalDebitAtomic",
  );
  const credit = parseNullableAtomic(
    input.journalCreditAtomic,
    "journalCreditAtomic",
  );
  const projection = parseNullableAtomic(
    input.projectionCreditAtomic,
    "projectionCreditAtomic",
  );

  if (
    approved === null ||
    debit === null ||
    credit === null ||
    projection === null
  ) {
    return "missing";
  }
  if (approved <= 0n || debit !== approved || credit !== approved || projection !== approved) {
    return "mismatch";
  }
  return "matched";
}
