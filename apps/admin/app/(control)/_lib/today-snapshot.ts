/**
 * 오늘의 퍼뜩 — 표시용 스냅샷 규칙.
 * 숫자는 읽기 모형 결과만 쓰며, 조회 실패를 0으로 바꾸지 않는다.
 */

export type CountSource = {
  count: number | null;
  error: { message: string } | null;
};

export type CountStatus =
  { kind: "ready"; count: number } | { kind: "unavailable" };

export type AttentionCode =
  | "KRW_DEPOSIT"
  | "USDT_DEPOSIT"
  | "KRW_BANK"
  | "USDT_WD"
  | "KYC"
  | "EXCEPTION"
  | "SAFE";

export type AttentionItem = {
  code: AttentionCode;
  label: string;
  href: string;
  description: string;
  emptyHint: string;
  status: CountStatus;
};

export type AuditEntry = {
  id: string;
  action: string;
  targetType: string;
  reason: string | null;
  createdAt: string;
};

export type TodaySnapshot = {
  attention: AttentionItem[];
  attentionTotal: CountStatus;
  allQueuesEmpty: boolean;
  hasUnavailable: boolean;
  memberTotal: CountStatus;
  activeTrials: CountStatus;
  audits: AuditEntry[] | "unavailable";
  observedAtIso: string;
};

export function toCountStatus(source: CountSource): CountStatus {
  if (source.error || source.count === null) {
    return { kind: "unavailable" };
  }
  if (!Number.isSafeInteger(source.count) || source.count < 0) {
    return { kind: "unavailable" };
  }
  return { kind: "ready", count: source.count };
}

export function combineCounts(...sources: CountSource[]): CountStatus {
  const statuses = sources.map(toCountStatus);
  if (statuses.some((status) => status.kind === "unavailable")) {
    return { kind: "unavailable" };
  }
  return {
    kind: "ready",
    count: statuses.reduce(
      (sum, status) => sum + (status.kind === "ready" ? status.count : 0),
      0,
    ),
  };
}

export function formatCountDisplay(status: CountStatus): string {
  if (status.kind === "unavailable") return "확인 필요";
  return status.count.toLocaleString("ko-KR");
}

export function sumAttention(items: AttentionItem[]): CountStatus {
  if (items.some((item) => item.status.kind === "unavailable")) {
    return { kind: "unavailable" };
  }
  return {
    kind: "ready",
    count: items.reduce(
      (sum, item) =>
        sum + (item.status.kind === "ready" ? item.status.count : 0),
      0,
    ),
  };
}

export function areAllQueuesEmpty(items: AttentionItem[]): boolean {
  return (
    items.length > 0 &&
    items.every(
      (item) => item.status.kind === "ready" && item.status.count === 0,
    )
  );
}

export function buildAttentionItems(input: {
  krwDeposits: CountSource;
  usdtDeposits: CountSource;
  krwWithdrawals: CountSource;
  usdtWithdrawals: CountSource;
  kyc: CountSource;
  mismatches: CountSource;
  failedJobs: CountSource;
  safePaused: CountSource;
}): AttentionItem[] {
  return [
    {
      code: "KRW_DEPOSIT",
      label: "원화 입금 확인",
      href: "/deposits/krw",
      description: "실제 이체와 반영 금액을 확인해요.",
      emptyHint: "확인할 원화 입금이 없어요.",
      status: toCountStatus(input.krwDeposits),
    },
    {
      code: "USDT_DEPOSIT",
      label: "USDT 입금 확인",
      href: "/deposits/usdt",
      description: "외부 이체 확인 후 원화만 반영해요.",
      emptyHint: "확인할 입금이 없어요.",
      status: toCountStatus(input.usdtDeposits),
    },
    {
      code: "KRW_BANK",
      label: "계좌 출금",
      href: "/withdrawals/krw-bank",
      description: "은행 송금·거절·잔액 반영을 처리해요.",
      emptyHint: "대기 중인 계좌 출금이 없어요.",
      status: toCountStatus(input.krwWithdrawals),
    },
    {
      code: "USDT_WD",
      label: "USDT 출금",
      href: "/withdrawals/usdt",
      description: "외부 송금 기록 후 잔액만 반영해요.",
      emptyHint: "대기 중인 USDT 출금이 없어요.",
      status: toCountStatus(input.usdtWithdrawals),
    },
    {
      code: "KYC",
      label: "본인 확인",
      href: "/kyc",
      description: "승인·보류·재제출을 결정해요.",
      emptyHint: "대기 중인 본인 확인이 없어요.",
      status: toCountStatus(input.kyc),
    },
    {
      code: "EXCEPTION",
      label: "정산·대사 예외",
      href: "/exceptions",
      description: "차이를 확인해요. 여기서 숫자를 고치지 않아요.",
      emptyHint: "열린 예외가 없어요.",
      status: combineCounts(input.mismatches, input.failedJobs),
    },
    {
      code: "SAFE",
      label: "제한·안전 모드",
      href: "/restrictions",
      description: "멈춘 기능과 위험 신호를 확인해요.",
      emptyHint: "켜진 안전 모드가 없어요.",
      status: toCountStatus(input.safePaused),
    },
  ];
}

export function buildTodaySnapshot(input: {
  krwDeposits: CountSource;
  usdtDeposits: CountSource;
  krwWithdrawals: CountSource;
  usdtWithdrawals: CountSource;
  kyc: CountSource;
  mismatches: CountSource;
  failedJobs: CountSource;
  safePaused: CountSource;
  users: CountSource;
  trials: CountSource;
  audits: {
    error: { message: string } | null;
    data: AuditEntry[] | null;
  } | null;
  observedAt?: Date;
}): TodaySnapshot {
  const attention = buildAttentionItems(input);
  const attentionTotal = sumAttention(attention);
  const audits =
    !input.audits || input.audits.error
      ? ("unavailable" as const)
      : (input.audits.data ?? []);

  return {
    attention,
    attentionTotal,
    allQueuesEmpty: areAllQueuesEmpty(attention),
    hasUnavailable:
      attention.some((item) => item.status.kind === "unavailable") ||
      toCountStatus(input.users).kind === "unavailable" ||
      toCountStatus(input.trials).kind === "unavailable" ||
      audits === "unavailable",
    memberTotal: toCountStatus(input.users),
    activeTrials: toCountStatus(input.trials),
    audits,
    observedAtIso: (input.observedAt ?? new Date()).toISOString(),
  };
}

export function formatObservedAtKst(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

export function formatAuditTimeKst(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(iso));
}

/** 감사 조치명을 운영자용 짧은 한국어로 바꾼다. 모르는 값은 일반화한다. */
export function auditActionLabel(action: string): string {
  switch (action) {
    case "APPROVE_DEPOSIT":
    case "CONFIRM_USDT_DEPOSIT":
      return "입금 확인";
    case "APPROVE_WITHDRAWAL":
    case "REJECT_WITHDRAWAL":
    case "RECORD_EXTERNAL_SEND":
    case "FINALIZE_WITHDRAWAL":
      return "출금 처리";
    case "REVIEW_KYC":
    case "APPROVE_KYC":
    case "REJECT_KYC":
      return "본인 확인 검토";
    case "SET_SAFE_MODE":
    case "CLEAR_SAFE_MODE":
      return "안전 모드 변경";
    case "ACK_RECONCILIATION_MISMATCH":
      return "예외 확인";
    case "BOOTSTRAP_FIRST_SUPER_ADMIN":
      return "최초 운영자 등록";
    default:
      return "운영 조치";
  }
}

export function auditTargetLabel(targetType: string): string {
  switch (targetType) {
    case "deposit_request":
    case "deposit_requests":
      return "입금";
    case "withdrawal_request":
    case "withdrawal_requests":
      return "출금";
    case "kyc_case":
    case "kyc_cases":
      return "본인 확인";
    case "safe_mode_control":
    case "safe_mode_controls":
      return "안전 모드";
    case "reconciliation_mismatch":
    case "reconciliation_mismatches":
      return "대사 예외";
    case "user":
    case "user_profiles":
      return "회원";
    default:
      return "기록";
  }
}
