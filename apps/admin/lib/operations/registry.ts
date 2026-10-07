import type { AdminRole } from "@/lib/auth/policy";

const operators: readonly AdminRole[] = ["SUPER_ADMIN", "ADMIN"];

export const operationSections = {
  events: {
    title: "행사 운영",
    lead: "행사 기간과 현재 상태를 확인하고 안내 초안을 준비해요.",
    roles: [...operators, "CONTENT_ADMIN"],
    draft: "event",
    boundary:
      "보상·대상·예산은 승인된 정책에서 확인해요. 초안은 게시되지 않아요.",
  },
  notices: {
    title: "공지 운영",
    lead: "게시된 공지와 초안을 확인하고 회원에게 전할 글을 준비해요.",
    roles: [...operators, "CONTENT_ADMIN"],
    draft: "notice",
    boundary:
      "게시·예약·취소는 승인된 게시 절차가 필요해요. 여기서는 글을 준비해요.",
  },
  notifications: {
    title: "알림 전달",
    lead: "알림의 대기·전달·실패 기록을 확인해요.",
    roles: [...operators, "SUPPORT_ADMIN"],
    draft: null,
    boundary: "전달 기록과 회원의 실제 수신은 달라요. 중복 발송은 하지 않아요.",
  },
  support: {
    title: "고객 지원",
    lead: "회원 기록을 먼저 확인하고, 사실에 맞는 답변을 준비해요.",
    roles: [...operators, "SUPPORT_ADMIN"],
    draft: "reply",
    boundary:
      "답변은 초안이에요. 확인하지 않은 입금·출금 완료를 약속하지 않아요.",
  },
  ledger: {
    title: "거래 기록",
    lead: "확정된 거래와 회원의 지갑 기록을 확인해요.",
    roles: operators,
    draft: null,
    boundary: "거래 기록을 표시해요. 잔액 변경이나 원장 수리는 하지 않아요.",
  },
  mining: {
    title: "채굴 현황",
    lead: "회원의 채굴 상태와 마지막 정산 시각을 확인해요.",
    roles: operators,
    draft: null,
    boundary:
      "채굴과 정산은 서버가 계산해요. 이 화면에서 수익을 계산하지 않아요.",
  },
  audit: {
    title: "보안·운영 기록",
    lead: "누가 어떤 운영 작업을 했는지 기록을 확인해요.",
    roles: operators,
    draft: null,
    boundary:
      "기록은 수정하지 않아요. 민감한 원문과 접속 정보는 표시하지 않아요.",
  },
  analytics: {
    title: "이용 현황",
    lead: "최근 하루의 회원 가입과 서비스 이용 기록을 확인해요.",
    roles: operators,
    draft: null,
    boundary:
      "기록 건수는 이용자 수와 달라요. 조회 실패를 0건으로 표시하지 않아요.",
  },
  system: {
    title: "서비스 상태",
    lead: "최근 상태 보고와 자동 작업의 진행·실패를 확인해요.",
    roles: operators,
    draft: null,
    boundary:
      "상태 보고는 실시간 검사와 달라요. 실패한 작업은 원인 확인 후 처리해요.",
  },
} as const;

export type OperationSection = keyof typeof operationSections;
export type DraftKind = "notice" | "event" | "reply";

export function isOperationSection(value: string): value is OperationSection {
  return Object.hasOwn(operationSections, value);
}

export function canReadOperation(section: OperationSection, role: AdminRole) {
  return (operationSections[section].roles as readonly AdminRole[]).includes(
    role,
  );
}

/** Unrecognized values remain unknown; never expose raw backend enums. */
export function operationStatus(value: unknown): string {
  const labels: Record<string, string> = {
    DRAFT: "초안",
    PUBLISHED: "게시 중",
    ARCHIVED: "보관",
    SCHEDULED: "시작 전",
    LIVE: "진행 중",
    ENDED: "종료",
    CANCELLED: "취소",
    PENDING: "대기",
    SENT: "발송 기록 있음",
    DELIVERED: "전달 확인",
    FAILED: "실패 확인 필요",
    PROCESSING: "처리 중",
    RUNNING: "진행 중",
    COMPLETED: "완료",
    NORMAL: "채굴 중",
    REDUCED: "속도 제한",
    MAINTENANCE: "점검 중",
    PARTIAL_STOP: "일부 중지",
    STOPPED: "중지",
    OPERATIONAL: "정상 보고",
    DEGRADED: "일부 불안정",
    OUTAGE: "장애 보고",
    IN_APP: "앱 알림",
    WEB_PUSH: "기기 알림",
  };
  return typeof value === "string" && Object.hasOwn(labels, value)
    ? labels[value]!
    : "상태 확인 필요";
}

export function operationType(value: unknown): string {
  const labels: Record<string, string> = {
    DEPOSIT: "입금",
    WITHDRAWAL: "출금",
    MINING_REWARD: "채굴 수익",
    WELCOME_REWARD: "환영 보상",
    TRIAL_REWARD_CONVERSION: "체험 보상 전환",
    REFERRAL_REWARD: "추천 보상",
    PROMOTION_REWARD: "입금 행사 보상",
    EVENT_REWARD: "행사 보상",
    REVERSAL: "거래 되돌림",
    ADMIN_ADJUSTMENT: "운영 조정",
    notification_delivery: "알림 전달",
    safe_mode_audit: "안전 모드 기록",
    mining_settlement: "채굴 정산",
    reconciliation: "거래 대사",
    FINANCIAL_RECONCILIATION: "거래 대사",
    web: "회원 서비스",
    admin: "운영 서비스",
    database: "데이터 저장",
    notifications: "알림",
    ai: "운영 도우미",
    auth: "로그인",
  };
  return typeof value === "string" && Object.hasOwn(labels, value)
    ? labels[value]!
    : "운영 기록";
}

export type OperationRecord = {
  id: string;
  title: string;
  status: string;
  at: string | null;
  detail: string | null;
  memberId: string | null;
};
export type OperationPanel = {
  key: string;
  title: string;
  state: "ready" | "unavailable";
  count: number | null;
  rows: OperationRecord[];
};
export type OperationsSnapshot = {
  section: OperationSection;
  observedAt: string;
  panels: OperationPanel[];
};
