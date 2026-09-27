/** 사용자에게 보이는 채굴 표현 금지어와 검사 헬퍼. */

export const FORBIDDEN_MINING_PHRASES = [
  "가상 채굴",
  "가상 채굴 플랫폼",
  "내부 규칙 기반 채굴",
  "내부 규칙으로 운영되는 채굴",
  "실제 채굴이 아님",
  "시뮬레이션 채굴",
  "모의 채굴",
  "가짜 채굴",
  "deterministic mining",
] as const;

/** AI 사용자 답변이 채굴을 구현 용어로 설명하면 안 되는 표현. */
const MINING_IMPLEMENTATION_EXPLAIN_PATTERNS = [
  /\bbackend\b/i,
  /\bserver\b/i,
  /\bledger\b/i,
  /\brule\s*engine\b/i,
  /백엔드/,
  /서버/,
  /원장/,
  /규칙\s*엔진/,
] as const;

export type ForbiddenMiningHit = {
  phrase: string;
  index: number;
};

export function findForbiddenMiningPhrases(text: string): ForbiddenMiningHit[] {
  const hits: ForbiddenMiningHit[] = [];
  for (const phrase of FORBIDDEN_MINING_PHRASES) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(phrase, from);
      if (index === -1) {
        break;
      }
      hits.push({ phrase, index });
      from = index + phrase.length;
    }
  }
  return hits;
}

export function findMiningImplementationExplainHits(text: string): string[] {
  if (!/채굴|마이닝|mining/i.test(text)) {
    return [];
  }

  const hits: string[] = [];
  for (const pattern of MINING_IMPLEMENTATION_EXPLAIN_PATTERNS) {
    if (pattern.test(text)) {
      hits.push(pattern.source);
    }
  }
  return hits;
}

export function assertPlainMiningUserAnswer(text: string, label: string) {
  const forbidden = findForbiddenMiningPhrases(text);
  if (forbidden.length > 0) {
    const detail = forbidden
      .map((hit) => `"${hit.phrase}"@${hit.index}`)
      .join(", ");
    throw new Error(
      `${label}: 금지 채굴 표현이 있습니다 (${detail}). 사용자 답은 평범한 "채굴"만 써야 합니다.`,
    );
  }

  if (!text.includes("채굴")) {
    throw new Error(
      `${label}: 사용자 답에 "채굴"이 없습니다. 채굴을 평범한 말로 설명해야 합니다.`,
    );
  }

  const implHits = findMiningImplementationExplainHits(text);
  if (implHits.length > 0) {
    throw new Error(
      `${label}: 채굴을 backend/server/ledger/rule engine(또는 한글 대응어)로 설명하면 안 됩니다 (${implHits.join(", ")}).`,
    );
  }

  if (
    /실제\s*(블록체인|해시레이트|hashrate)|실물\s*자산\s*채굴|실시간\s*(시세|시장\s*가격)|live\s*market\s*price/i.test(
      text,
    )
  ) {
    throw new Error(
      `${label}: 실제 블록체인 해시레이트·실물 자산 채굴·실시간 시세를 주장하면 안 됩니다.`,
    );
  }
}
