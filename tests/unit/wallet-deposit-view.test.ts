// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  WalletDepositView,
  type WalletDepositViewProps,
} from "@/components/product/wallet-deposit-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock("@/lib/analytics/client", () => ({
  trackAnalyticsEvent: async () => undefined,
}));
vi.mock("@/components/product/wallet-scene", () => ({
  WalletScene: () =>
    createElement("div", { "data-wallet-scene": "approved-art" }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

const base: WalletDepositViewProps = {
  instructions: [],
  instructionRead: "empty",
  krwHistory: [],
  krwHistoryRead: "empty",
  usdtHistory: [],
  usdtHistoryRead: "empty",
};
function render(overrides: Partial<WalletDepositViewProps> = {}) {
  const node = document.createElement("div");
  node.innerHTML = renderToStaticMarkup(
    createElement(WalletDepositView, { ...base, ...overrides }),
  );
  return node;
}

describe("wallet deposit presentation keeps manual request boundaries", () => {
  it("offers accessible method selection with the two existing forms and no invented bank details", () => {
    const node = render();
    expect(
      node.querySelectorAll('[role="radiogroup"] input[type="radio"]'),
    ).toHaveLength(2);
    expect(
      node.querySelector('input[value="bank"]')?.hasAttribute("checked"),
    ).toBe(true);
    expect(node.querySelectorAll("form")).toHaveLength(2);
    expect(node.querySelector('a[href="/wallet"]')).not.toBeNull();
    expect(node.textContent).toContain("입금은 선택 사항이에요");
    expect(node.textContent).not.toMatch(/신한은행|우리은행|1234-5678/);
  });
  it("keeps a missing USDT address unavailable and both empty histories explicit", () => {
    const node = render();
    expect(
      node.querySelector<HTMLSelectElement>("#usdt-deposit-network")?.disabled,
    ).toBe(true);
    expect(
      node.querySelector<HTMLInputElement>("#usdt-deposit-tx")?.disabled,
    ).toBe(true);
    expect(
      node.querySelector<HTMLInputElement>("#usdt-deposit-amount")?.disabled,
    ).toBe(true);
    expect(node.textContent).toContain("아직 원화 입금 요청이 없어요");
    expect(node.textContent).toContain("아직 USDT 입금 내역이 없어요");
  });
  it("does not accept stale instructions after an instruction read error", () => {
    const node = render({
      instructionRead: "error",
      instructions: [
        { network: "TRC20", depositAddress: "LOCAL-UNIT-TEST-ADDRESS-ONLY" },
      ],
    });
    expect(node.textContent).toContain("입금 안내를 불러오지 못했어요");
    expect(node.textContent).not.toContain("LOCAL-UNIT-TEST-ADDRESS-ONLY");
    expect(
      node.querySelector<HTMLInputElement>("#usdt-deposit-tx")?.disabled,
    ).toBe(true);
  });
  it("enables observed address guidance without manufacturing a balance or conversion quote", () => {
    const node = render({
      instructionRead: "ready",
      instructions: [
        { network: "TRC20", depositAddress: "LOCAL-UNIT-TEST-ADDRESS-ONLY" },
      ],
    });
    expect(node.textContent).toContain("LOCAL-UNIT-TEST-ADDRESS-ONLY");
    expect(node.textContent).toContain("입금 주소 복사");
    expect(
      node.querySelector<HTMLInputElement>("#usdt-deposit-tx")?.disabled,
    ).toBe(false);
    expect(
      node.querySelector<HTMLInputElement>("#usdt-deposit-amount")?.disabled,
    ).toBe(false);
    expect(
      node.querySelector("#usdt-deposit-amount")?.getAttribute("inputmode"),
    ).toBe("decimal");
    expect(node.textContent).not.toMatch(
      /USDT\s*(잔액|잔고)|예상.*원|환율.*[0-9]/,
    );
  });
  it("distinguishes history failures from empty records and provides recovery", () => {
    const node = render({ krwHistoryRead: "error", usdtHistoryRead: "error" });
    expect(node.textContent).toContain("입금 요청 내역을 불러오지 못했어요");
    expect(node.textContent).toContain("USDT 입금 내역을 불러오지 못했어요");
    expect(node.textContent).not.toContain("아직 원화 입금 요청이 없어요");
    expect(node.querySelectorAll('a[href="/wallet/deposit"]')).toHaveLength(2);
  });
  it("renders real request states, exact strings and masked transaction evidence separately", () => {
    const node = render({
      krwHistoryRead: "ready",
      usdtHistoryRead: "ready",
      krwHistory: [
        {
          id: "bank",
          amount: "9,007,199,254,740,993원",
          status: "이체 대기",
          description: "본인 명의 이체를 기다리는 단계예요.",
          tone: "warning",
          timestamp: null,
          timeLabel: "시간 확인 중",
        },
      ],
      usdtHistory: [
        {
          id: "usdt",
          amount: "1.123456 USDT 송금",
          status: "접수",
          description: "확인을 기다리고 있어요.",
          tone: "info",
          timestamp: "2026-10-09T00:00:00Z",
          timeLabel: "2026. 10. 9. 오전 9:00",
          detail: "TRC20 · 12345678…abcdef",
        },
      ],
    });
    expect(node.textContent).toContain("9,007,199,254,740,993원");
    expect(node.textContent).toContain("1.123456 USDT 송금");
    expect(node.textContent).toContain("TRC20 · 12345678…abcdef");
    expect(node.textContent).toContain("이체 대기");
    expect(node.querySelector("time:not([datetime])")?.textContent).toBe(
      "시간 확인 중",
    );
    expect(node.textContent).not.toContain("반영 완료");
  });
});
