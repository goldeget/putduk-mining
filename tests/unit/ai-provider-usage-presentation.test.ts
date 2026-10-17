import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PutdukAiProviderUsage } from "@/components/product/putduk-ai-usage";

const bucket = {
  attemptCount: 2,
  succeeded: 1,
  failed: 0,
  cancelled: 0,
  unknown: 1,
  inputTokens: null,
  outputTokens: null,
  costMicroUsd: null,
  reservedCostMicroUsd: "250000",
};
const render = (value: unknown) =>
  renderToStaticMarkup(createElement(PutdukAiProviderUsage, { value }));
const usage = {
  nvidia: bucket,
  free: bucket,
  paid: bucket,
  memberPaidEnabled: false,
  memberPaidCapMicroUsd: null,
};

describe("own provider usage", () => {
  it("keeps unknown usage distinct from zero and paid access disabled", () => {
    const html = render(usage);
    expect(html).toContain("확인할 수 없음");
    expect(html).toContain("처리 결과나 비용을 확인 중인 요청");
    expect(html).toContain("유료 대체 답변은 사용하지 않아요.");
    expect(html).not.toContain("$0.000000");
  });

  it("renders measured integer cost without floating point rounding", () => {
    const html = render({
      ...usage,
      paid: {
        ...bucket,
        costMicroUsd: "10000001",
        inputTokens: "9007199254740993",
        outputTokens: "0",
      },
    });
    expect(html).toContain("$10.000001");
    expect(html).toContain("9,007,199,254,740,993");
  });

  it("does not render global budget or provider-controlled fields", () => {
    expect(
      render({
        ...usage,
        globalBudget: "PRIVATE_GLOBAL_VALUE",
        secret: "PRIVATE_SECRET",
      }),
    ).not.toMatch(/PRIVATE_GLOBAL_VALUE|PRIVATE_SECRET/);
    expect(
      render({ ...usage, paid: { ...bucket, reservedCostMicroUsd: "NaN" } }),
    ).toContain("AI 이용 내역을 확인할 수 없어요.");
    expect(
      render({ ...usage, free: { ...bucket, attemptCount: -1 } }),
    ).toContain("AI 이용 내역을 확인할 수 없어요.");
  });
});
