import { guardAiQuestion } from "./guard";
import { formatFactAnswer } from "./knowledge";

export type AiRoute =
  | {
      answer: string;
      classification:
        "ACTION_BOUNDARY" | "INTERNAL_DATA_REQUEST" | "STATIC_FACT";
      kind: "static";
      routeKey: string;
    }
  | {
      classification: "PUBLIC_INFORMATION";
      kind: "low_cost" | "high_capability";
      routeKey: string;
    };

type StaticRule = {
  factKeys: readonly string[];
  pattern: RegExp;
  routeKey: string;
};

const STATIC_RULES: readonly StaticRule[] = [
  {
    routeKey: "trial_separation",
    pattern: /(체험|start).*(실제|지갑|잔액|전환|합쳐|섞)/i,
    factKeys: ["TRIAL_LEDGER"],
  },
  {
    routeKey: "trial_duration",
    pattern: /(체험|start).*(시간|기간|언제|종료|얼마)/i,
    factKeys: ["TRIAL_DURATION"],
  },
  {
    routeKey: "funding_methods",
    pattern: /(입금|출금|충전|funding).*(방식|수단|krw|usdt|원화)/i,
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

export function routeAiQuestion(question: string): AiRoute {
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
  const staticRule = STATIC_RULES.find((rule) => rule.pattern.test(normalized));
  if (staticRule) {
    return {
      answer: formatFactAnswer(staticRule.factKeys),
      classification: "STATIC_FACT",
      kind: "static",
      routeKey: staticRule.routeKey,
    };
  }

  const needsHighCapability =
    normalized.length > 400 || COMPLEX_ANALYSIS_PATTERN.test(normalized);

  return {
    classification: "PUBLIC_INFORMATION",
    kind: needsHighCapability ? "high_capability" : "low_cost",
    routeKey: needsHighCapability
      ? "public_facts_analysis"
      : "public_facts_question",
  };
}
