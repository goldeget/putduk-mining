import type { AiScreenContext } from "@/domain/ai/chat";
import {
  findMemberAiHelpTopic,
  getMemberAiHelp,
} from "@/domain/ai/member-help";

import { guardAiQuestion, type AiDeniedClassification } from "./guard";
import { formatFactAnswer } from "./knowledge";
import type { AiToolName } from "./tools";

export type AiRoute =
  | {
      answer: string;
      classification: AiDeniedClassification | "CLARIFICATION" | "STATIC_FACT";
      kind: "static";
      routeKey: string;
    }
  | {
      classification: "ACCOUNT_STATE";
      kind: "tool";
      routeKey: string;
      tool: AiToolName;
    }
  | {
      classification: "GENERAL_SAFE";
      kind: "general_safe";
      modelTier: "high_capability" | "low_cost";
      routeKey: string;
    }
  | {
      classification: "UI_HELP";
      kind: "ui_help";
      routeKey: string;
    }
  | {
      classification: "PUTDUK_KNOWLEDGE";
      kind: "high_capability" | "low_cost";
      routeKey: string;
    };

type StaticRule = {
  factKeys: readonly string[];
  pattern: RegExp;
  routeKey: string;
};

type ToolRule = {
  pattern: RegExp;
  routeKey: string;
  tool: AiToolName;
};

const TOOL_RULES: readonly ToolRule[] = [
  {
    pattern:
      /((오늘|금일).*(채굴|마이닝).*(얼마|보상|수익)|(오늘|금일).*(얼마|보상|수익).*(채굴|마이닝)|(채굴|마이닝).*(오늘|금일).*(얼마|보상|수익)|오늘\s*얼마\s*캐)/i,
    routeKey: "account_today_mining_reward",
    tool: "mining.today_reward",
  },
  {
    pattern:
      /((내\s*)?(입금|충전).*(됐|됫|되었|상태|언제|확인|처리|안\s*(돼|왔)|왜)|(입금|충전)\s*(됐어|됫어|됐나요|확인해)|내\s*(입금|충전).*(금액|얼마|내역|맞))/i,
    routeKey: "account_deposit_status",
    tool: "deposit.latest_status",
  },
  {
    pattern:
      /((내\s*)?출금.*(됐|되었|상태|언제|확인|처리|안\s*(돼|왔)|왜)|출금\s*(됐어|됐나요|언제돼)|내\s*출금.*(금액|얼마|내역|맞))/i,
    routeKey: "account_withdrawal_status",
    tool: "withdrawal.latest_status",
  },
  {
    pattern:
      /((친구\s*초대|추천|레퍼럴).*(보상|리워드).*(왜|안|상태|언제|왔|됐|얼마|금액|내역)|(친구\s*초대|추천)\s*보상\s*(왜|어디|상태|얼마))/i,
    routeKey: "account_referral_status",
    tool: "referral.status",
  },
  {
    pattern:
      /((내\s*)?이벤트.*(어디|진행|완료|달성|상태|보상)|(참여한|참가한)\s*이벤트)/i,
    routeKey: "account_event_progress",
    tool: "event.progress",
  },
  {
    pattern:
      /((내\s*)?(잔액|지갑|보유액).*(얼마|보여|확인|상태|알려)|(잔액|지갑)\s*(얼마|보여줘|확인해)|내\s*(돈|금액|보유\s*금액).*(얼마|보여|확인|알려))/i,
    routeKey: "account_wallet_summary",
    tool: "wallet.summary",
  },
  {
    pattern:
      /((내\s*)?(채굴|마이닝).*(중|상태|돌아|작동|진행)|(채굴|마이닝)\s*(중이야|되고\s*있어))/i,
    routeKey: "account_mining_status",
    tool: "mining.status",
  },
  {
    pattern:
      /((내\s*)?(putduk\s*start|퍼뜩\s*start|퍼뜩\s*스타트|체험).*(상태|진행|완료|얼마|남|어디)|(스타트|체험)\s*(어디까지|끝났어))/i,
    routeKey: "account_trial_status",
    tool: "trial.status",
  },
  {
    pattern:
      /((내\s*)?(kyc|본인\s*인증|신원\s*인증).*(상태|진행|완료|통과|언제|왜\s*안)|(kyc|본인\s*인증)\s*(됐어|됐나요))/i,
    routeKey: "account_kyc_status",
    tool: "kyc.status",
  },
  {
    pattern: /((내\s*)?알림.*(뭐|무엇|최근|안\s*읽|확인|왔)|(새|최근)\s*알림)/i,
    routeKey: "account_recent_notifications",
    tool: "notification.recent",
  },
];

const STATIC_RULES: readonly StaticRule[] = [
  {
    routeKey: "start_welcome_cap",
    pattern:
      /(환영\s*보상|(?:체험|start|스타트).{0,24}5[,.]?000|5[,.]?000\s*원.{0,24}(?:체험|환영|스타트)|입금하지\s*않아도|입금\s*없이|사전\s*입금)/i,
    factKeys: ["START_WELCOME_CAP", "TRIAL_LEDGER"],
  },
  {
    routeKey: "trial_separation",
    pattern: /(체험|start).*(실제|지갑|잔액|전환|합쳐|섞)/i,
    factKeys: ["TRIAL_LEDGER", "START_WELCOME_CAP"],
  },
  {
    routeKey: "trial_duration",
    pattern: /(체험|start).*(시간|기간|언제|종료|얼마)/i,
    factKeys: ["TRIAL_DURATION"],
  },
  {
    routeKey: "funding_methods",
    pattern: /(입금|출금|충전|funding).*(방식|방법|수단|krw|usdt|원화)/i,
    factKeys: ["SUPPORTED_FUNDING_METHODS"],
  },
  {
    routeKey: "supported_worlds",
    pattern: /(월드|world).*(종류|어떤|몇|지원)/i,
    factKeys: ["SUPPORTED_WORLDS"],
  },
  {
    routeKey: "settlement_authority",
    pattern: /(채굴|정산).*(시간|계산|규칙|기준|서버)/i,
    factKeys: ["SETTLEMENT_AUTHORITY"],
  },
  {
    routeKey: "ai_boundary",
    pattern: /(ai|인공지능).*(권한|할 수|잔액|승인|변경)/i,
    factKeys: ["AI_BOUNDARY"],
  },
  {
    routeKey: "product_identity",
    pattern: /(putduk|퍼뜩).*(무엇|뭐|서비스|플랫폼)/i,
    factKeys: ["PRODUCT_NAME", "PRODUCT_TYPE"],
  },
];

const COMPLEX_ANALYSIS_PATTERN =
  /(비교|분석|장단점|관점|근거별|단계별|종합|요약.*여러|왜.*어떻게)/i;
const PUTDUK_TOPIC_PATTERN =
  /(putduk|퍼뜩|채굴|마이닝|월드|지갑|입금|출금|정산|체험|이벤트|추천|kyc|본인\s*인증)/i;
const UI_HELP_PATTERN =
  /(이\s*화면|여기서|현재\s*화면).*(어떻게|뭐|무엇|어디|할\s*수)/i;
const AMBIGUOUS_FOLLOW_UP_PATTERN =
  /^(그거|그건|그게|그럼|그러면|아까\s*그거).*(언제|왜|어떻게|됐|돼|뭐)/i;
const AMBIGUOUS_ACCOUNT_REWARD_PATTERN =
  /((내|나의|본인).*(보상|리워드).*(얼마|금액|상태|왜|안\s*왔)|(보상|리워드).*(내|나의|본인).*(얼마|금액|상태))/i;

export function routeAiQuestion(
  question: string,
  screenContext?: AiScreenContext,
): AiRoute {
  const guard = guardAiQuestion(question);
  if (!guard.allowed) {
    return {
      answer: guard.answer,
      classification: guard.classification,
      kind: "static",
      routeKey: `guard_${guard.classification.toLowerCase()}`,
    };
  }

  const normalized = question.replace(/\s+/g, " ").trim();
  const toolRule = TOOL_RULES.find((rule) => rule.pattern.test(normalized));
  if (toolRule) {
    return {
      classification: "ACCOUNT_STATE",
      kind: "tool",
      routeKey: toolRule.routeKey,
      tool: toolRule.tool,
    };
  }

  const staticRule = STATIC_RULES.find((rule) => rule.pattern.test(normalized));
  if (staticRule) {
    return {
      answer: formatFactAnswer(staticRule.factKeys),
      classification: "STATIC_FACT",
      kind: "static",
      routeKey: staticRule.routeKey,
    };
  }

  if (AMBIGUOUS_ACCOUNT_REWARD_PATTERN.test(normalized)) {
    return {
      answer:
        "어떤 보상을 확인할지 선택해 주세요. 오늘의 채굴 보상, PUTDUK START, 친구 초대 또는 이벤트 보상 중 하나를 함께 적어 주세요.",
      classification: "CLARIFICATION",
      kind: "static",
      routeKey: "clarify_account_reward_source",
    };
  }

  if (AMBIGUOUS_FOLLOW_UP_PATTERN.test(normalized)) {
    return {
      answer:
        "어떤 항목을 말씀하시는지 확인이 필요합니다. 입금, 출금, 채굴, 이벤트 또는 본인 인증 중 하나를 함께 적어 주세요.",
      classification: "CLARIFICATION",
      kind: "static",
      routeKey: "clarify_ambiguous_follow_up",
    };
  }

  const helpTopic = findMemberAiHelpTopic(
    normalized,
    screenContext?.currentRoute,
  );
  if (helpTopic) {
    return {
      answer: getMemberAiHelp(helpTopic).answer,
      classification: "STATIC_FACT",
      kind: "static",
      routeKey: `member_help_${helpTopic}`,
    };
  }

  if (screenContext?.currentRoute && UI_HELP_PATTERN.test(normalized)) {
    return {
      classification: "UI_HELP",
      kind: "ui_help",
      routeKey: "safe_current_screen_help",
    };
  }

  const needsHighCapability =
    normalized.length > 400 || COMPLEX_ANALYSIS_PATTERN.test(normalized);

  if (!PUTDUK_TOPIC_PATTERN.test(normalized)) {
    return {
      classification: "GENERAL_SAFE",
      kind: "general_safe",
      modelTier: needsHighCapability ? "high_capability" : "low_cost",
      routeKey: needsHighCapability
        ? "general_safe_analysis"
        : "general_safe_question",
    };
  }

  return {
    classification: "PUTDUK_KNOWLEDGE",
    kind: needsHighCapability ? "high_capability" : "low_cost",
    routeKey: needsHighCapability
      ? "putduk_knowledge_analysis"
      : "putduk_knowledge_question",
  };
}

export function isAiResponseCacheable() {
  // A topic or a best-effort redactor cannot prove that free-form input/output
  // is public. Keep member turns out of the shared cache until an approved
  // public-only corpus and deterministic input selector exist.
  return false;
}
