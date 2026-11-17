/** 사용자에게 보이는 모니터링 표현 금지어와 검사 헬퍼. */

export const FORBIDDEN_MONITORING_PHRASES = [
  "가상 모니터링",
  "가상 모니터링 플랫폼",
  "내부 규칙 기반 모니터링",
  "내부 규칙으로 운영되는 모니터링",
  "실제 모니터링이 아님",
  "시뮬레이션 모니터링",
  "모의 모니터링",
  "가짜 모니터링",
  "deterministic monitoring",
] as const;

/** AI 사용자 답변이 모니터링을 구현 용어로 설명하면 안 되는 표현. */
const MONITORING_IMPLEMENTATION_EXPLAIN_PATTERNS = [
  /\bbackend\b/i,
  /\bserver\b/i,
  /\bledger\b/i,
  /\brule\s*engine\b/i,
  /백엔드/,
  /서버/,
  /원장/,
  /규칙\s*엔진/,
] as const;

export type ForbiddenMonitoringHit = {
  phrase: string;
  index: number;
};

export function findForbiddenMonitoringPhrases(
  text: string,
): ForbiddenMonitoringHit[] {
  const hits: ForbiddenMonitoringHit[] = [];
  for (const phrase of FORBIDDEN_MONITORING_PHRASES) {
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

export function findMonitoringImplementationExplainHits(
  text: string,
): string[] {
  if (!/모니터링|monitoring/i.test(text)) {
    return [];
  }

  const hits: string[] = [];
  for (const pattern of MONITORING_IMPLEMENTATION_EXPLAIN_PATTERNS) {
    if (pattern.test(text)) {
      hits.push(pattern.source);
    }
  }
  return hits;
}

export function assertPlainMonitoringUserAnswer(text: string, label: string) {
  const forbidden = findForbiddenMonitoringPhrases(text);
  if (forbidden.length > 0) {
    const detail = forbidden
      .map((hit) => `"${hit.phrase}"@${hit.index}`)
      .join(", ");
    throw new Error(
      `${label}: 금지 모니터링 표현이 있습니다 (${detail}). 사용자 답은 평범한 "모니터링"만 써야 합니다.`,
    );
  }

  if (!text.includes("모니터링")) {
    throw new Error(
      `${label}: 사용자 답에 "모니터링"이 없습니다. 모니터링을 평범한 말로 설명해야 합니다.`,
    );
  }

  const implHits = findMonitoringImplementationExplainHits(text);
  if (implHits.length > 0) {
    throw new Error(
      `${label}: 모니터링을 backend/server/ledger/rule engine(또는 한글 대응어)로 설명하면 안 됩니다 (${implHits.join(", ")}).`,
    );
  }

  if (
    /실제\s*(블록체인|해시레이트|hashrate)|실물\s*자산\s*모니터링|실시간\s*(시세|시장\s*가격)|live\s*market\s*price/i.test(
      text,
    )
  ) {
    throw new Error(
      `${label}: 실제 블록체인 해시레이트·실물 자산 모니터링·실시간 시세를 주장하면 안 됩니다.`,
    );
  }
}

// Backward-compatible alias for existing test references
export const assertPlainMiningUserAnswer = assertPlainMonitoringUserAnswer;
