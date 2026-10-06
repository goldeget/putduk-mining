/**
 * PUTDUK AI 대화 연속성.
 * 회원 본인 대화는 기존 ai_conversations / ai_messages에 남긴다.
 * 보존 기간과 제공자 전송 범위는 정하지 않는다.
 */

export const AI_CONVERSATION_CONTINUITY_MODE = "OWNER_ACCOUNT" as const;

export type AiConversationContinuityMode =
  typeof AI_CONVERSATION_CONTINUITY_MODE;

/** 사용자에게 보이는 짧은 연속성 안내. 보존 기간은 말하지 않는다. */
export const AI_CONVERSATION_CONTINUITY_COPY =
  "내 대화는 이 계정에서 다시 열 수 있어요.";

export const AI_DURABLE_CONVERSATION_IMPLEMENTED = true;

export function assertAiConversationContinuityHonest() {
  if (!AI_DURABLE_CONVERSATION_IMPLEMENTED) {
    throw new Error("AI_DURABLE_CONVERSATION_FLAG_WITHOUT_SCHEMA");
  }
  if (AI_CONVERSATION_CONTINUITY_MODE !== "OWNER_ACCOUNT") {
    throw new Error("AI_CONVERSATION_CONTINUITY_MODE_UNSUPPORTED");
  }
}
