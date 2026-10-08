/**
 * Twenty meaningful LOCAL QA drafts. They are not approved production campaigns.
 * Human authority: current recovery instruction authorizes synthetic operator review.
 * Policy reference defines template categories, not financial amounts or eligibility.
 * No fixture asserts mission completion, grants a badge, spends money or mints rewards.
 */
export const RECOVERY_EVENT_POLICY_REFERENCE =
  "docs/product/EVENT-REWARD-ARCHITECTURE.md";
/** Canonical business milestones, separate from guide-reading participation. */
export const localNonmoneyMissionTemplates = [
  ["MINING_STARTED.v1", "참여한 뒤 채굴을 시작하면 달성합니다."],
  [
    "MINING_SETTLEMENT_COMPLETED.v1",
    "참여한 뒤 채굴 정산이 완료되면 달성합니다.",
  ],
  ["MINING_STARTED.v1", "참여한 뒤 채굴을 시작하면 달성합니다."],
  [
    "MINING_SETTLEMENT_COMPLETED.v1",
    "참여한 뒤 채굴 정산이 완료되면 달성합니다.",
  ],
  ["MINING_STARTED.v1", "참여한 뒤 채굴을 시작하면 달성합니다."],
  ["MINING_STARTED.v1", "참여한 뒤 채굴을 시작하면 달성합니다."],
  [
    "MINING_SETTLEMENT_COMPLETED.v1",
    "참여한 뒤 채굴 정산이 완료되면 달성합니다.",
  ],
  [
    "MINING_SETTLEMENT_COMPLETED.v1",
    "참여한 뒤 채굴 정산이 완료되면 달성합니다.",
  ],
  ["DEPOSIT_CONFIRMED.v1", "참여한 뒤 입금 처리가 완료되면 달성합니다."],
  ["WITHDRAWAL_COMPLETED.v1", "참여한 뒤 출금 처리가 완료되면 달성합니다."],
  ["TRIAL_COMPLETED.v1", "참여한 뒤 퍼뜩 START를 완료하면 달성합니다."],
  [
    "TRIAL_REWARD_CONVERTED.v1",
    "참여한 뒤 START 보상 전환이 완료되면 달성합니다.",
  ],
  ["MINING_STARTED.v1", "참여한 뒤 채굴을 시작하면 달성합니다."],
  [
    "MINING_SETTLEMENT_COMPLETED.v1",
    "참여한 뒤 채굴 정산이 완료되면 달성합니다.",
  ],
  ["MINING_STARTED.v1", "참여한 뒤 채굴을 시작하면 달성합니다."],
  ["TRIAL_COMPLETED.v1", "참여한 뒤 퍼뜩 START를 완료하면 달성합니다."],
  [
    "REFERRAL_REWARD_PAID.v1",
    "참여한 뒤 초대 보상 지급이 완료되면 달성합니다.",
  ],
  [
    "REFERRAL_REWARD_PAID.v1",
    "참여한 뒤 초대 보상 지급이 완료되면 달성합니다.",
  ],
  [
    "MINING_SETTLEMENT_COMPLETED.v1",
    "참여한 뒤 채굴 정산이 완료되면 달성합니다.",
  ],
  [
    "TRIAL_REWARD_CONVERTED.v1",
    "참여한 뒤 START 보상 전환이 완료되면 달성합니다.",
  ],
] as const;
export const recoveryEventDrafts = [
  [
    "first-mining-guide",
    "첫 채굴 둘러보기",
    "첫 채굴",
    "채굴 화면에서 현재 진행 상태와 결과를 확인하세요.",
    "/mining",
  ],
  [
    "mining-result-guide",
    "채굴 결과 읽기",
    "첫 채굴",
    "채굴한 결과와 정산 상태를 구분해서 확인하세요.",
    "/mining",
  ],
  [
    "activity-return",
    "다시 만나는 퍼뜩",
    "연속 활동",
    "앱을 다시 열고 지난 채굴 결과를 확인하세요.",
    "/home",
  ],
  [
    "activity-notifications",
    "놓치지 않는 소식",
    "연속 활동",
    "알림 센터에서 새 소식과 참여 기록을 확인하세요.",
    "/notifications",
  ],
  [
    "world-materials",
    "채굴 세계 둘러보기",
    "세계 탐험",
    "상품 화면에서 서로 다른 채굴 세계를 둘러보세요.",
    "/products",
  ],
  [
    "world-allocation",
    "내 상품 배정 확인",
    "세계 탐험",
    "상품별 배정 현황과 이용 가능한 정보를 확인하세요.",
    "/products",
  ],
  [
    "world-capacity",
    "내 채굴 현황 확인",
    "세계 탐험",
    "홈에서 내 채굴 현황과 진행 상태를 확인하세요.",
    "/home",
  ],
  [
    "settlement-history",
    "내 지갑 내역 읽기",
    "정산 단계",
    "지갑에서 입출금 내역과 사용 가능한 금액을 확인하세요.",
    "/wallet",
  ],
  [
    "settlement-deposit-guide",
    "입금 안내 살펴보기",
    "정산 단계",
    "입금 방식과 신청 전에 확인할 내용을 읽어 보세요.",
    "/wallet/deposit",
  ],
  [
    "settlement-withdraw-guide",
    "출금 안내 살펴보기",
    "정산 단계",
    "출금 전에 필요한 확인 사항과 처리 안내를 읽어 보세요.",
    "/wallet/withdraw",
  ],
  [
    "rank-profile",
    "내 성장 기록 살펴보기",
    "성장 축하",
    "내 계정에 표시되는 성장 기록을 확인하세요.",
    "/menu/account",
  ],
  [
    "rank-mining",
    "다음 여정 확인",
    "성장 축하",
    "채굴 화면에서 현재 위치와 다음 여정 안내를 확인하세요.",
    "/mining",
  ],
  [
    "weekend-world",
    "주말 세계 산책",
    "주말",
    "이번 주말에 관심 있는 상품의 안내를 둘러보세요.",
    "/products",
  ],
  [
    "weekend-inbox",
    "주말 소식 읽기",
    "주말",
    "놓친 공지와 알림을 천천히 확인하세요.",
    "/notifications",
  ],
  [
    "season-start",
    "새 계절의 시작",
    "계절",
    "홈에서 새로운 안내와 현재 채굴 상태를 확인하세요.",
    "/home",
  ],
  [
    "season-safety",
    "계정 안전 점검",
    "계절",
    "내 계정의 정보를 확인하고 안전하게 이용하세요.",
    "/menu/account",
  ],
  [
    "referral-policy",
    "초대 안내 읽기",
    "초대 캠페인",
    "더보기에서 초대 관련 안내와 이용 조건을 확인하세요.",
    "/menu",
  ],
  [
    "referral-record",
    "함께하는 여정 읽기",
    "초대 캠페인",
    "공개된 초대 안내를 읽고 내 기록과 구분해서 확인하세요.",
    "/events",
  ],
  [
    "reconnect-notice",
    "연결 후 소식 확인",
    "연속 활동",
    "다시 연결된 뒤 알림 센터에서 최신 소식을 확인하세요.",
    "/notifications",
  ],
  [
    "notification-preference",
    "내 알림 선택",
    "연속 활동",
    "알림 설정에서 받고 싶은 소식을 직접 선택하세요.",
    "/menu/notifications",
  ],
] as const;

export function buildRecoveryEventPayloads(
  prefix: string,
  startsAt: string,
  endsAt: string,
) {
  if (!/^qa-[a-z0-9-]{1,30}$/.test(prefix))
    throw new Error("LOCAL_EVENT_NAMESPACE_REQUIRED");
  return recoveryEventDrafts.map(
    ([slug, title, category, mission, ctaRoute]) => ({
      slug: `${prefix}-${slug}`,
      title: `[로컬 검증] ${title}`,
      cardTitle: title,
      summary: mission,
      body: `${title}\n\n${mission}\n\n이 이벤트는 로컬 검증용이며 현금 보상과 운영 혜택이 없습니다.`,
      ctaLabel: "안내 화면 열기",
      ctaRoute,
      audience: "MEMBERS" as const,
      segment: "ALL_MEMBERS" as const,
      rewardMode: "NONE" as const,
      participation: `${category} 안내를 읽고 참여하세요. 참여 기록은 내 계정에서 확인할 수 있습니다.`,
      exclusion:
        "참여 기간 밖의 신청은 접수하지 않습니다. 같은 이벤트의 참여 기록은 한 번만 생성됩니다.",
      startsAt,
      endsAt,
    }),
  );
}
