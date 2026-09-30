import type { PublicFact } from "@/lib/trust/public-content";

const FACT_LABELS: Readonly<Record<string, string>> = {
  PRODUCT_NAME: "서비스 이름",
  PRODUCT_TYPE: "서비스 종류",
  OFFICIAL_DOMAIN: "공식 서비스 주소",
  ADMIN_DOMAIN: "운영자 서비스 주소",
  SUPPORTED_WORLDS: "채굴 월드",
  TRIAL_DURATION: "체험 기간",
  TRIAL_LEDGER: "체험 값과 실제 지갑",
  SUPPORTED_FUNDING_METHODS: "입금 방식",
  SETTLEMENT_AUTHORITY: "채굴·정산 기준",
  AI_BOUNDARY: "AI의 역할",
};

const DOCUMENT_LABELS: Readonly<Record<string, string>> = {
  "/about": "퍼뜩 소개",
  "/how-it-works": "이용 방법",
  "/putduk-facts": "공식 사실",
  "/verification": "검증 원칙",
  "/mining-rules": "채굴 규칙",
  "/trial": "PUTDUK START 안내",
  "/economy": "보상과 지갑",
  "/deposit": "입금 안내",
  "/withdrawal": "출금 안내",
  "/faq": "자주 묻는 질문",
  "/status": "서비스 상태",
  "/changelog": "변경 안내",
  "/ai/about": "PUTDUK AI 소개",
  "/ai/facts": "AI의 공식 정보",
  "/ai/faq": "AI 자주 묻는 질문",
  "/ai/how-it-works": "AI 이용 방법",
};

const WORLD_NAMES: Readonly<Record<string, string>> = {
  KOREA: "한국",
  USA: "미국",
  GOLD: "금",
  SILVER: "은",
  CRYPTO: "디지털 자산",
};

/** Localized display text only; governed fact keys, paths and values stay intact. */
export function localizePublicWorldNames(text: string): string {
  return text.replace(
    /\b(KOREA|USA|GOLD|SILVER|CRYPTO)\b/g,
    (name) => WORLD_NAMES[name] ?? name,
  );
}

export function getPublicFactLabel(key: string): string {
  return FACT_LABELS[key] ?? "서비스 정보";
}

export function getTrustNavigationLabel(path: string): string {
  return DOCUMENT_LABELS[path] ?? "서비스 안내";
}

export function getPublicFactDisplayValue(fact: PublicFact): string {
  const translatedValues: Readonly<Record<string, string>> = {
    PRODUCT_TYPE: "채굴 서비스",
    SETTLEMENT_AUTHORITY: "확인된 시간과 적용 기준",
    AI_BOUNDARY: "설명과 분석",
  };
  return translatedValues[fact.key] ?? localizePublicWorldNames(fact.value);
}
