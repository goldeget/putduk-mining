import type { AiScreenContext } from "@/domain/ai/chat";

import {
  createGeneralSafeAiContext,
  createPublicAiContext,
  createUiHelpAiContext,
  type AiContext,
} from "./context";
import { isAiResponseCacheable, routeAiQuestion, type AiRoute } from "./router";
import type { AiToolName } from "./tools";

export type AiTurnPlan = {
  cacheable: boolean;
  context: AiContext;
  route: AiRoute;
};

export function planAiTurn({
  question,
  screenContext,
}: {
  question: string;
  screenContext?: AiScreenContext;
}): AiTurnPlan {
  const route = routeAiQuestion(question, screenContext);
  const context =
    route.kind === "general_safe"
      ? createGeneralSafeAiContext()
      : route.kind === "ui_help" && screenContext
        ? createUiHelpAiContext(screenContext)
        : createPublicAiContext();

  return {
    cacheable: isAiResponseCacheable(),
    context,
    route,
  };
}

const TOOL_FAILURE_COPY: Record<AiToolName, string> = {
  "deposit.latest_status":
    "입금 상태를 안전하게 확인하지 못했습니다. 잠시 후 입금 화면에서 다시 확인해 주세요.",
  "event.progress":
    "이벤트 진행 상태를 안전하게 확인하지 못했습니다. 잠시 후 이벤트 화면에서 다시 확인해 주세요.",
  "kyc.status":
    "본인 인증 상태를 안전하게 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
  "mining.status":
    "채굴 상태를 안전하게 확인하지 못했습니다. 잠시 후 채굴 화면에서 다시 확인해 주세요.",
  "mining.today_reward":
    "오늘의 확정 채굴 보상을 안전하게 확인하지 못했습니다. 확인되지 않은 금액은 안내하지 않습니다.",
  "notification.recent":
    "최근 알림을 안전하게 확인하지 못했습니다. 잠시 후 알림 화면에서 다시 확인해 주세요.",
  "referral.status":
    "추천 보상 상태를 안전하게 확인하지 못했습니다. 확인되지 않은 보상은 안내하지 않습니다.",
  "trial.status":
    "PUTDUK START 상태를 안전하게 확인하지 못했습니다. 잠시 후 START 화면에서 다시 확인해 주세요.",
  "wallet.summary":
    "지갑 상태를 안전하게 확인하지 못했습니다. 확인되지 않은 잔액은 안내하지 않습니다.",
  "withdrawal.latest_status":
    "출금 상태를 안전하게 확인하지 못했습니다. 잠시 후 출금 화면에서 다시 확인해 주세요.",
};

export function getAiToolFailureCopy(tool: AiToolName) {
  return TOOL_FAILURE_COPY[tool];
}
