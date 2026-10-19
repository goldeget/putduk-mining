import { describe, expect, it } from "vitest";

import { formatFactAnswer } from "@/lib/ai/knowledge";
import { routeAiQuestion } from "@/lib/ai/router";
import { PUBLIC_FACTS } from "@/lib/trust/public-content";

const ALLOWED_LATIN = new Set([
  "AI",
  "KRW",
  "MINING",
  "PUTDUK",
  "START",
  "USDT",
]);

function foreignWords(text: string) {
  return (text.match(/[A-Za-z][A-Za-z-]+/g) ?? []).filter(
    (word) => !ALLOWED_LATIN.has(word),
  );
}

describe("PUTDUK AI static fact answers are plain Korean", () => {
  it("never shows raw English fact values to a member", () => {
    // 주소·경로 값은 AI 정적 답변 규칙이 쓰지 않는다. 설명용 영문 값만 본다.
    const englishDescriptive = PUBLIC_FACTS.filter(
      (fact) =>
        /^[A-Z][a-z]+( [A-Za-z]+)+$/.test(fact.value) ||
        fact.value === "Mining service",
    );
    expect(englishDescriptive.map((fact) => fact.key)).toEqual(
      expect.arrayContaining([
        "PRODUCT_TYPE",
        "SETTLEMENT_AUTHORITY",
        "AI_BOUNDARY",
      ]),
    );
    for (const fact of englishDescriptive) {
      const answer = formatFactAnswer([fact.key]);
      expect(answer, fact.key).not.toContain(fact.value);
      expect(foreignWords(answer), fact.key).toEqual([]);
    }
  });

  it.each([
    ["AI가 할 수 있는 일이 뭐야", "ai_boundary"],
    ["채굴 정산 기준이 뭐야", "settlement_authority"],
    ["퍼뜩 서비스가 뭐야", "product_identity"],
    ["체험 환영 보상 최대 5,000원이 맞아?", "start_welcome_cap"],
  ])("routes %s to a Korean-only answer", (question, routeKey) => {
    const route = routeAiQuestion(question);
    expect(route.kind).toBe("static");
    if (route.kind !== "static") return;
    expect(route.routeKey).toBe(routeKey);
    expect(foreignWords(route.answer)).toEqual([]);
  });

  it("keeps the KRW 5,000 one-time ceiling in the START answer", () => {
    const answer = formatFactAnswer(["START_WELCOME_CAP"]);
    expect(answer).toContain("최대 5,000원");
    expect(answer).toContain("한 번만");
    expect(answer).toContain("입금하지 않아도");
  });
});
