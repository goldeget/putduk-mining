// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  ParticipationResult,
  ParticipationResultError,
  ParticipationHistory,
  ParticipationPointsLedger,
} from "../../components/workroom/participation-history";
import type { WorkroomSession } from "../../domain/workroom/contracts";
const id = "11111111-1111-4111-8111-111111111111";
const base = {
  id,
  instrument: "nvda",
  stake: 1000,
  returned: 1025,
  profit: 25,
  closedAt: Date.parse("2026-11-13T10:50:22Z"),
  status: "completed" as const,
};
function render(component: Parameters<typeof renderToStaticMarkup>[0]) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(component);
  return host;
}
describe("authoritative participation result presentation", () => {
  it.each([
    [25, "증가", "+25 P"],
    [-25, "감소", "-25 P"],
    [0, "변동 없음", "0 P"],
  ])(
    "preserves signed outcome %s without treating zero as a gain",
    (profit, label, amount) => {
      const host = render(
        createElement(ParticipationResult, {
          result: {
            ...base,
            profit: Number(profit),
            returned: 1000 + Number(profit),
          },
        }),
      );
      expect(host.querySelector("h1")?.textContent).toBe("참여 결과");
      expect(
        host.querySelector('[data-result-field="profit"]')?.textContent,
      ).toContain(amount);
      expect(
        host.querySelector('[data-result-field="profit"]')?.textContent,
      ).toContain(label);
      expect(
        host.querySelector('[data-result-field="stake"]')?.textContent,
      ).toContain("1,000 P");
      expect(
        host.querySelector('[data-result-field="returned"]')?.textContent,
      ).toContain(`${(1000 + Number(profit)).toLocaleString("ko-KR")} P`);
      expect(host.textContent).toContain(id);
      expect(host.textContent).toContain(
        "현금으로 전환하거나 출금할 수 없어요",
      );
      expect(host.querySelector('a[href="/workroom"]')).not.toBeNull();
      expect(host.querySelector('a[href="/workroom/history"]')).not.toBeNull();
    },
  );
  it("shows a visible same-result retry and never invents a result when unavailable", () => {
    const href = `/workroom/history?round=${id}` as const;
    const host = render(
      createElement(ParticipationResultError, { retryHref: href }),
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector(`a[href="${href}"]`)?.textContent).toContain(
      "다시 확인",
    );
    expect(host.querySelector('[data-result-field="returned"]')).toBeNull();
  });
  it("keeps incomplete values unconfirmed and links only completed originals", () => {
    const rows: WorkroomSession[] = [
      {
        ...base,
        pattern: "wave",
        roi: 2.5,
        amplitude: 1,
        duration: 30,
        configVersion: 1,
        started: base.closedAt - 30000,
      },
      {
        ...base,
        id: "22222222-2222-4222-8222-222222222222",
        status: "active",
        returned: null,
        profit: null,
        closedAt: null,
        pattern: "wave",
        roi: 2.5,
        amplitude: 1,
        duration: 30,
        configVersion: 1,
        started: base.closedAt,
      },
    ];
    const host = render(
      createElement(ParticipationHistory, { rows, active: rows[1]! }),
    );
    expect(
      host.querySelector(`a[href="/workroom/history?round=${id}"]`),
    ).not.toBeNull();
    expect(host.querySelector('a[href*="22222222-2222"]')).toBeNull();
    expect(host.textContent).toContain("진행 중");
    expect(host.textContent).toContain("확인 중");
  });
  it("provides a useful empty state without an invented amount or sample record", () => {
    const host = render(
      createElement(ParticipationHistory, { rows: [], active: null }),
    );
    expect(host.textContent).toContain("아직 완료된 참여가 없어요");
    expect(host.querySelector('a[href="/workroom"]')).not.toBeNull();
    expect(host.querySelector("tbody tr")).toBeNull();
  });
  it("keeps ledger note, signed changes and exact balances from the server rows", () => {
    const host = render(
      createElement(ParticipationPointsLedger, {
        rows: [
          {
            id,
            note: "모의 참여 종료 반영 · 서버 원본",
            amount: -125,
            balanceAfter: 9875,
            kind: "ROUND_RETURN",
            createdAt: base.closedAt,
          },
        ],
      }),
    );
    expect(host.textContent).toContain("모의 참여 종료 반영 · 서버 원본");
    expect(host.querySelector('td[data-label="변동"]')?.textContent).toBe(
      "-125 P",
    );
    expect(
      host.querySelector('td[data-label="반영 후 잔액"]')?.textContent,
    ).toBe("9,875 P");
    expect(host.querySelectorAll("th")).toHaveLength(4);
  });
});
