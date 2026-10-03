/** 운영자 화면에 쓰는 표시용 포맷 (원장 계산에는 사용하지 않음) */

export function formatKrw(atomic: number | string | null | undefined): string {
  if (atomic === null || atomic === undefined || atomic === "") return "—";
  if (typeof atomic === "number" && !Number.isSafeInteger(atomic)) return "—";
  if (typeof atomic === "string" && !/^-?[0-9]+$/.test(atomic)) return "—";
  return `${BigInt(atomic).toLocaleString("ko-KR")}원`;
}

export function formatUsdt(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  return `${String(amount)} USDT`;
}

export function formatKst(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** 출금 상태 → 운영자용 한국어 (Basic Mode) */
export function withdrawalStatusLabel(status: string): string {
  switch (status) {
    case "REQUESTED":
      return "접수";
    case "REVIEWING":
    case "ADMIN_PROCESSING":
      return "검토·처리 중";
    case "APPROVED":
    case "PROCESSING":
      return "송금 준비";
    case "EXTERNAL_SENT_RECORDED":
      return "외부 송금 기록됨";
    case "LEDGER_FINALIZED":
    case "COMPLETED":
      return "원장 확정·완료";
    case "REJECTED":
      return "거절·해제";
    case "CANCELLED":
      return "취소·해제";
    case "HELD":
      return "보유(홀드)";
    default:
      return status;
  }
}

export function depositStatusLabel(status: string): string {
  switch (status) {
    case "SUBMITTED":
      return "확인 대기";
    case "CONFIRMED":
      return "원화 반영 완료";
    case "REQUESTED":
      return "접수";
    case "AWAITING_TRANSFER":
      return "이체 대기";
    case "REVIEWING":
      return "확인 중";
    case "APPROVED":
      return "원화 반영 완료";
    case "REJECTED":
      return "반려";
    case "CANCELLED":
      return "취소";
    default:
      return status;
  }
}

/** 대사 차이 상태 → 운영자용 한국어 */
export function mismatchStatusLabel(status: string): string {
  switch (status) {
    case "OPEN":
      return "열림";
    case "INVESTIGATING":
      return "조사 중";
    case "RESOLVED":
      return "조사 완료";
    case "ACCEPTED":
      return "차이 인정";
    default:
      return status;
  }
}

/** 대사 차이 유형 → 짧은 한국어 안내 (원본 코드는 별도 표시) */
export function mismatchTypeLabel(mismatchType: string): string {
  switch (mismatchType) {
    case "UNBALANCED_JOURNAL":
      return "원장 대차 불일치";
    case "WELCOME_REWARD_PROJECTION_MISMATCH":
      return "환영 보상 투영 불일치";
    case "WORKER_RUNTIME_PROBE_MISMATCH":
      return "작업 검증용 차이";
    default:
      return "대사 차이";
  }
}

/** JSON 증거를 운영자가 읽을 짧은 문자열로 만든다. */
export function formatMismatchEvidence(
  value: unknown,
  emptyLabel = "기록 없음",
): string {
  if (value === null || value === undefined) return emptyLabel;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : emptyLabel;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return emptyLabel;
  }
}

/**
 * 외부 송금이 이미 기록된 상태면 true.
 * 계약 상태 EXTERNAL_SENT_RECORDED 또는 기존 PROCESSING+증거.
 */
export function hasExternalSendRecorded(input: {
  status: string;
  txHash?: string | null | undefined;
  bankReference?: string | null | undefined;
  sentAt?: string | null | undefined;
}): boolean {
  if (
    input.status === "EXTERNAL_SENT_RECORDED" ||
    input.status === "LEDGER_FINALIZED" ||
    input.status === "COMPLETED"
  ) {
    return true;
  }
  return Boolean(input.txHash || input.bankReference || input.sentAt);
}

export function canReleaseHold(status: string): boolean {
  return ![
    "EXTERNAL_SENT_RECORDED",
    "LEDGER_FINALIZED",
    "COMPLETED",
    "REJECTED",
    "CANCELLED",
  ].includes(status);
}
