import {
  PUBLIC_FACTS,
  TRUST_CONTENT_VERSION,
  TRUST_LAST_UPDATED,
  type PublicFact,
} from "@/lib/trust/public-content";
import { getPublicFactDisplayValue } from "@/lib/trust/public-presentation";

export type AiKnowledge = {
  facts: readonly PublicFact[];
  lastUpdated: string;
  version: string;
};

export function getCanonicalAiKnowledge(
  factKeys?: readonly string[],
): AiKnowledge {
  const requestedKeys = factKeys ? new Set(factKeys) : null;

  return {
    facts: requestedKeys
      ? PUBLIC_FACTS.filter((fact) => requestedKeys.has(fact.key))
      : PUBLIC_FACTS,
    lastUpdated: TRUST_LAST_UPDATED,
    version: TRUST_CONTENT_VERSION,
  };
}

export function formatFactAnswer(factKeys: readonly string[]) {
  const { facts } = getCanonicalAiKnowledge(factKeys);
  // 공개 화면과 같은 한국어 표시값만 쓴다. 원본 영문 값은 회원에게 보이지 않는다.
  return facts
    .map((fact) => `${getPublicFactDisplayValue(fact)}. ${fact.description}`)
    .join("\n\n");
}
