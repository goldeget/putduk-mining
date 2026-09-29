/**
 * 지갑 화면 전용 읽기 모델.
 * 잔액은 서버 투영(projection)만 사용하며, 여기서 금액을 만들거나 바꾸지 않는다.
 */

export type WalletReadState = "empty" | "error" | "ready" | "zero";

export type KrwWalletProjection = {
  availableAtomic: string;
  balanceAtomic: string;
  heldAtomic: string;
  walletAccountId: string;
};

export type WalletLedgerEvidence = {
  amountAtomic: string;
  createdAt: string;
  direction: "CREDIT" | "DEBIT";
  entryType: string;
  id: string;
};

export type WalletReceiptEvidence = {
  amountAtomic: string;
  completedAt: string | null;
  currency: string;
  id: string;
  receiptNumber: string;
  requestedAt: string;
  status: string;
  transactionType: string;
};

const ATOMIC_INTEGER = /^-?\d+$/;

const seoulDateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export const walletEntryLabels: Record<string, string> = {
  DEPOSIT: "입금",
  WITHDRAWAL: "출금",
  MINING_REWARD: "채굴 보상",
  WELCOME_REWARD: "환영 보상",
  TRIAL_REWARD_CONVERSION: "PUTDUK START 전환",
  EVENT_REWARD: "이벤트 보상",
  FUNDING_PROMO_REWARD: "입금 프로모션",
  REFERRAL_REWARD: "친구 초대 보상",
  REFUND: "환불",
  REVERSAL: "취소 반영",
  UPGRADE_COST: "업그레이드",
  ADMIN_ADJUSTMENT: "운영 조정",
};

export const walletReceiptStatusLabels: Record<string, string> = {
  REQUESTED: "요청 접수",
  PENDING: "확인 중",
  REVIEWING: "확인 중",
  APPROVED: "승인",
  PROCESSING: "처리 중",
  COMPLETED: "완료",
  REJECTED: "반려",
  FAILED: "처리 실패",
  CANCELLED: "취소",
};

export const walletReceiptTypeLabels: Record<string, string> = {
  DEPOSIT: "입금",
  WITHDRAWAL: "출금",
  WELCOME_WITHDRAWAL: "환영 보상 첫 출금",
};

/** 원본 atomic 문자열이 정수인지 확인한다. 소수·빈 값은 거부한다. */
export function requireAtomicIntegerString(value: string, field: string): string {
  if (!ATOMIC_INTEGER.test(value)) {
    throw new TypeError(`${field} must be an integer string.`);
  }
  return value;
}

/**
 * 전체 잔액과 사용 가능 잔액의 차이로 출금 보류를 계산한다.
 * 화면용 파생값이며, 원장에 새 금액을 쓰지 않는다.
 */
export function projectHeldBalanceAtomic(
  balanceAtomic: string,
  availableAtomic: string,
): string {
  const balance = BigInt(
    requireAtomicIntegerString(balanceAtomic, "balanceAtomic"),
  );
  const available = BigInt(
    requireAtomicIntegerString(availableAtomic, "availableAtomic"),
  );
  if (available > balance) {
    throw new RangeError("Available balance cannot exceed total balance.");
  }
  return (balance - available).toString();
}

export function classifyWalletBalanceRead(input: {
  error: boolean;
  hasAccount: boolean;
  availableAtomic?: string;
  balanceAtomic?: string;
}): WalletReadState {
  if (input.error) {
    return "error";
  }
  if (!input.hasAccount) {
    return "empty";
  }
  const available = requireAtomicIntegerString(
    input.availableAtomic ?? "0",
    "availableAtomic",
  );
  const balance = requireAtomicIntegerString(
    input.balanceAtomic ?? "0",
    "balanceAtomic",
  );
  if (BigInt(available) === 0n && BigInt(balance) === 0n) {
    return "zero";
  }
  return "ready";
}

export function classifyLedgerHistoryRead(input: {
  count: number;
  error: boolean;
}): WalletReadState {
  if (input.error) {
    return "error";
  }
  if (input.count <= 0) {
    return "empty";
  }
  return "ready";
}

export function classifyReceiptHistoryRead(input: {
  count: number;
  error: boolean;
}): WalletReadState {
  if (input.error) {
    return "error";
  }
  if (input.count <= 0) {
    return "empty";
  }
  return "ready";
}

export function buildKrwWalletProjection(input: {
  availableBalanceAtomic: string | number | null | undefined;
  balanceAtomic: string | number | null | undefined;
  walletAccountId: string;
}): KrwWalletProjection {
  const balanceAtomic = requireAtomicIntegerString(
    String(input.balanceAtomic ?? "0"),
    "balanceAtomic",
  );
  const availableAtomic = requireAtomicIntegerString(
    String(input.availableBalanceAtomic ?? "0"),
    "availableAtomic",
  );
  return {
    availableAtomic,
    balanceAtomic,
    heldAtomic: projectHeldBalanceAtomic(balanceAtomic, availableAtomic),
    walletAccountId: input.walletAccountId,
  };
}

export function labelWalletEntryType(entryType: string): string {
  return walletEntryLabels[entryType] ?? "지갑 변동";
}

export function labelWalletReceiptStatus(status: string): string {
  return walletReceiptStatusLabels[status] ?? status;
}

export function labelWalletReceiptType(transactionType: string): string {
  return walletReceiptTypeLabels[transactionType] ?? "거래 요청";
}

/** 서버·클라이언트 동일 타임존으로 증거를 표시한다. */
export function formatWalletEvidenceTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "시간 확인 중";
  }
  return seoulDateTime.format(date);
}
