import "server-only";

import { hasConfiguredAiProvider } from "@/lib/env/server";
import { TRUST_CONTENT_VERSION } from "@/lib/trust/public-content";

/** 화면에는 가용 여부만 전달한다. provider와 secret 값은 서버에 남긴다. */
export function getAiAvailability() {
  return {
    knowledgeVersion: TRUST_CONTENT_VERSION,
    providerConfigured: hasConfiguredAiProvider(),
  };
}
