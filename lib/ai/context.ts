import { getCanonicalAiKnowledge, type AiKnowledge } from "./knowledge";

export type AiContext = {
  knowledge: AiKnowledge;
  locale: "ko-KR";
  scope: "PUBLIC_FACTS_ONLY";
  userContextIncluded: false;
};

export function createPublicAiContext(): AiContext {
  return {
    knowledge: getCanonicalAiKnowledge(),
    locale: "ko-KR",
    scope: "PUBLIC_FACTS_ONLY",
    userContextIncluded: false,
  };
}
