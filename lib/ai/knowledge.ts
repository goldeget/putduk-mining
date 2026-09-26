import {
  PUBLIC_FACTS,
  TRUST_CONTENT_VERSION,
  TRUST_LAST_UPDATED,
  type PublicFact,
} from "@/lib/trust/public-content";

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
  return facts.map((fact) => `${fact.value}. ${fact.description}`).join("\n\n");
}
