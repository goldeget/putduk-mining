/**
 * 학습 공개 경계.
 * 자동 publish 점수와 canary 비율은 정해지지 않았다.
 * 고위험 금융·권한·법적 내용은 승인 대기까지만 분류하고, 후보 테이블이 없어 행을 만들지 않는다.
 */

export const AI_MEMBER_BLOCKED_POLICY = [
  "RETENTION_PERIOD_UNSET",
  "PROVIDER_TRANSMISSION_SCOPE_UNSET",
  "AUTO_PUBLISH_SCORE_UNSET",
  "CANARY_RATIO_UNSET",
  "LEARNING_CANDIDATE_STORAGE_ABSENT",
  "CONVERSATION_SUMMARY_TRANSMISSION_UNSET",
] as const;

export type AiMemberBlockedPolicy = (typeof AI_MEMBER_BLOCKED_POLICY)[number];

const HIGH_RISK_PATTERN =
  /(수익률|수수료|원금|출금|입금|usdt|보너스|정산|본인\s*확인|kyc|권한|약관|법적|등급|용량|세이프|마케팅|티어|\btier\b|capacity|principal|withdrawal|bonus|settlement)/i;

export type MemberLearningDecision =
  | {
      action: "AWAITING_APPROVAL";
      policy: "LEARNING_CANDIDATE_STORAGE_ABSENT";
      risk: "LEARNING_HIGH";
    }
  | {
      action: "BLOCKED_POLICY";
      policy: "AUTO_PUBLISH_SCORE_UNSET";
      risk: "LEARNING_LOW" | "LEARNING_MEDIUM";
    };

export function decideMemberLearningPublication(
  text: string,
): MemberLearningDecision {
  if (HIGH_RISK_PATTERN.test(text)) {
    return {
      action: "AWAITING_APPROVAL",
      policy: "LEARNING_CANDIDATE_STORAGE_ABSENT",
      risk: "LEARNING_HIGH",
    };
  }
  const medium = /(사용법|메뉴|화면|안내|설명|어디)/.test(text);
  return {
    action: "BLOCKED_POLICY",
    policy: "AUTO_PUBLISH_SCORE_UNSET",
    risk: medium ? "LEARNING_MEDIUM" : "LEARNING_LOW",
  };
}

const CLOSED_PUBLISH_ACTIONS = new Set([
  "AWAITING_APPROVAL",
  "BLOCKED_POLICY",
  "PUBLISHED",
]);

/** 점수·비율이 없으므로 어떤 위험도도 지식으로 공개하지 않는다. */
export function knowledgePublishAllowed(
  action: MemberLearningDecision["action"] | "PUBLISHED",
) {
  return !CLOSED_PUBLISH_ACTIONS.has(action);
}
