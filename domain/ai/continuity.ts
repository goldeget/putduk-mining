/**
 * PUTDUK AI 대화 연속성 정책.
 * 내구성 대화 저장소가 승인·구현되기 전까지 브라우저 세션 메모리만 허용한다.
 */

export const AI_CONVERSATION_CONTINUITY_MODE = "SESSION_MEMORY_ONLY" as const;

export type AiConversationContinuityMode =
  typeof AI_CONVERSATION_CONTINUITY_MODE;

/** 사용자에게 보이는 짧은 연속성 안내. 새로고침 시 대화가 사라짐을 숨기지 않는다. */
export const AI_CONVERSATION_CONTINUITY_COPY =
  "이 화면의 대화는 새로고침하면 사라져요.";

/**
 * 내구성 대화 스키마·복원 API는 아직 없다.
 * 스키마를 흉내 내거나 localStorage에 원문을 쌓아 연속성을 가장하지 않는다.
 */
export const AI_DURABLE_CONVERSATION_IMPLEMENTED = false;

export function assertAiConversationContinuityHonest() {
  if (AI_DURABLE_CONVERSATION_IMPLEMENTED) {
    throw new Error("AI_DURABLE_CONVERSATION_FLAG_WITHOUT_SCHEMA");
  }
  if (AI_CONVERSATION_CONTINUITY_MODE !== "SESSION_MEMORY_ONLY") {
    throw new Error("AI_CONVERSATION_CONTINUITY_MODE_UNSUPPORTED");
  }
}
