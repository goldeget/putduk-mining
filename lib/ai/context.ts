import type { AiScreenContext } from "@/domain/ai/chat";

import { getCanonicalAiKnowledge, type AiKnowledge } from "./knowledge";

export type AiProviderScreenContext = Pick<
  AiScreenContext,
  "currentProduct" | "currentRoute" | "currentWorld"
> & {
  hasSelectedEvent?: true;
  hasSelectedTransaction?: true;
};

export type AiContext = {
  knowledge: AiKnowledge;
  locale: "ko-KR";
  scope: "GENERAL_SAFE" | "PUBLIC_FACTS_ONLY" | "UI_HELP";
  screenContext?: AiProviderScreenContext;
  userContextIncluded: boolean;
};

export function createPublicAiContext(): AiContext {
  return {
    knowledge: getCanonicalAiKnowledge(),
    locale: "ko-KR",
    scope: "PUBLIC_FACTS_ONLY",
    userContextIncluded: false,
  };
}

export function createGeneralSafeAiContext(): AiContext {
  return {
    knowledge: getCanonicalAiKnowledge([]),
    locale: "ko-KR",
    scope: "GENERAL_SAFE",
    userContextIncluded: false,
  };
}

export function createUiHelpAiContext(
  screenContext: AiScreenContext,
): AiContext {
  const providerScreenContext: AiProviderScreenContext = {
    ...(screenContext.currentProduct
      ? { currentProduct: screenContext.currentProduct }
      : {}),
    ...(screenContext.currentRoute
      ? { currentRoute: screenContext.currentRoute }
      : {}),
    ...(screenContext.currentWorld
      ? { currentWorld: screenContext.currentWorld }
      : {}),
    ...(screenContext.selectedEvent ? { hasSelectedEvent: true } : {}),
    ...(screenContext.selectedTransaction
      ? { hasSelectedTransaction: true }
      : {}),
  };

  return {
    knowledge: getCanonicalAiKnowledge(),
    locale: "ko-KR",
    scope: "UI_HELP",
    screenContext: providerScreenContext,
    userContextIncluded: true,
  };
}
