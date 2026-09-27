export type AiToolDefinition = {
  description: string;
  name: AiToolName;
  readOnly: true;
  returns: readonly string[];
};

export const AI_TOOL_NAMES = [
  "deposit.latest_status",
  "event.progress",
  "kyc.status",
  "mining.status",
  "mining.today_reward",
  "notification.recent",
  "referral.status",
  "trial.status",
  "wallet.summary",
  "withdrawal.latest_status",
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

// These tools are invoked only by PUTDUK's server orchestrator with the current
// authenticated Supabase client. They are never handed to the model as direct
// provider-callable functions and never accept a user ID argument.
export const AI_TOOL_REGISTRY: readonly AiToolDefinition[] = [
  {
    description: "본인의 최신 KRW/USDT 입금 요청 상태를 확인합니다.",
    name: "deposit.latest_status",
    readOnly: true,
    returns: ["amount", "currency", "requested_at", "status"],
  },
  {
    description: "본인이 참여한 최신 이벤트 진행 상태를 확인합니다.",
    name: "event.progress",
    readOnly: true,
    returns: ["completed_at", "event_title", "status", "updated_at"],
  },
  {
    description: "본인의 최신 KYC 처리 상태만 확인합니다.",
    name: "kyc.status",
    readOnly: true,
    returns: ["opened_at", "status", "updated_at"],
  },
  {
    description: "본인의 현재 활성 채굴 세션 상태를 확인합니다.",
    name: "mining.status",
    readOnly: true,
    returns: ["started_at", "status", "world"],
  },
  {
    description: "본인 지갑에 오늘 확정 기록된 채굴 보상을 합산합니다.",
    name: "mining.today_reward",
    readOnly: true,
    returns: ["amount", "currency", "kst_date"],
  },
  {
    description: "본인의 최근 알림과 읽지 않은 개수를 확인합니다.",
    name: "notification.recent",
    readOnly: true,
    returns: ["created_at", "title", "unread_count"],
  },
  {
    description: "본인의 추천 보상 자격 단계와 청구 상태를 확인합니다.",
    name: "referral.status",
    readOnly: true,
    returns: [
      "amount",
      "next_review_at",
      "paid_at",
      "qualification_stage",
      "status",
    ],
  },
  {
    description: "본인의 PUTDUK START 진행 상태를 확인합니다.",
    name: "trial.status",
    readOnly: true,
    returns: ["completed_at", "quota", "reward", "status", "world"],
  },
  {
    description: "본인의 원장 파생 지갑 잔액을 확인합니다.",
    name: "wallet.summary",
    readOnly: true,
    returns: ["available", "balance", "currency", "held"],
  },
  {
    description: "본인의 최신 출금 요청 상태를 확인합니다.",
    name: "withdrawal.latest_status",
    readOnly: true,
    returns: ["amount", "currency", "requested_at", "status"],
  },
];

export function assertAiToolBoundary() {
  if (
    AI_TOOL_REGISTRY.some(
      (tool) => tool.readOnly !== true || tool.returns.length === 0,
    )
  ) {
    throw new Error("AI_MUTATION_TOOL_FORBIDDEN");
  }
}
