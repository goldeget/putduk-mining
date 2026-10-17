// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { WalletOverviewView } from "@/components/product/wallet-overview-view";
import type { WalletReadViewProps } from "@/components/product/wallet-read-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
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

const base: WalletReadViewProps = {
  balanceState: "zero",
  krw: {
    availableAtomic: "0",
    balanceAtomic: "0",
    heldAtomic: "0",
    walletAccountId: "owned",
  },
  funding: { state: "empty" },
  ledgerEntries: [],
  ledgerState: "empty",
  receipts: [],
  receiptState: "empty",
  trialRewardAtomic: null,
  trialState: "empty",
};
function render(overrides: Partial<WalletReadViewProps> = {}) {
  return renderToStaticMarkup(
    createElement(WalletOverviewView, { ...base, ...overrides }),
  );
}
function dom(overrides: Partial<WalletReadViewProps> = {}) {
  const node = document.createElement("div");
  node.innerHTML = render(overrides);
  return node;
}

describe("wallet overview verified financial presentation", () => {
  it("shows an observed zero separately from an absent source and empty records", () => {
    const node = dom();
    expect(
      node.querySelector('[data-wallet-balance-state="zero"]')?.textContent,
    ).toContain("0원");
    expect(node.textContent).toContain("아직 없음");
    expect(node.textContent).toContain("아직 거래 내역이 없어요");
    expect(node.textContent).not.toMatch(/USDT\s*(잔액|잔고)|\+12.8%|L5 PRO/);
  });
  it("does not manufacture a zero when balance or source reads fail", () => {
    const node = dom({
      balanceState: "error",
      krw: null,
      funding: { state: "error" },
      ledgerState: "error",
    });
    expect(
      node.querySelector('[data-wallet-balance-state="error"]')?.textContent,
    ).not.toContain("0원");
    expect(node.textContent).toContain("확인할 수 없음");
    expect(node.textContent).toContain("잔액 다시 확인");
    expect(node.textContent).toContain("원금과 수익 다시 확인");
    expect(node.textContent).toContain("거래 내역 다시 확인");
  });
  it("preserves integers beyond Number precision and never adds principal to wallet", () => {
    const node = dom({
      balanceState: "ready",
      krw: {
        availableAtomic: "9007199254740993",
        balanceAtomic: "9007199254740995",
        heldAtomic: "2",
        walletAccountId: "owned",
      },
      funding: {
        state: "ready",
        rows: [
          { label: "인정 원금", value: "100,000원", tone: "separate" },
          { label: "정산 전 대기 수익", value: "0.125원", tone: "separate" },
          { label: "아직 확정 전", value: "20원", tone: "unconfirmed" },
        ],
      },
    });
    expect(
      node.querySelector('[data-wallet-value="9,007,199,254,740,995원"]'),
    ).not.toBeNull();
    expect(
      node.querySelector('[data-wallet-value="9,007,199,254,740,993원"]'),
    ).not.toBeNull();
    expect(node.textContent).toContain("0.125원");
    expect(node.textContent).toContain("잔액에 합치지 않아요");
    expect(node.textContent).not.toContain("9,007,199,254,840,995");
  });
  it.each(["principal", "profit", "history"] as const)(
    "provides real navigation with current %s view",
    (initialView) => {
      const node = dom({ initialView });
      expect(
        node.querySelector('nav a[aria-current="page"]')?.getAttribute("href"),
      ).toBe(`/wallet?view=${initialView}`);
      expect(node.querySelector('a[href="/wallet/deposit"]')).not.toBeNull();
      expect(node.querySelector('a[href="/wallet/withdraw"]')).not.toBeNull();
      expect(node.querySelectorAll("nav a")).toHaveLength(3);
    },
  );
  it("retains actual ledger direction and receipt state, not invented completion", () => {
    const node = dom({
      initialView: "history",
      ledgerState: "ready",
      ledgerEntries: [
        {
          id: "row",
          amountAtomic: "5000",
          entryType: "WITHDRAWAL",
          direction: "DEBIT",
          createdAt: "2026-10-09T00:00:00Z",
        },
      ],
      receiptState: "ready",
      receipts: [
        {
          id: "receipt",
          amountAtomic: "5000",
          currency: "KRW",
          status: "PENDING",
          transactionType: "WITHDRAWAL",
          receiptNumber: "PD-OWN-123",
          requestedAt: "2026-10-09T00:00:00Z",
          completedAt: null,
        },
      ],
    });
    expect(
      node.querySelector('[data-wallet-entry-direction="DEBIT"]')?.textContent,
    ).toContain("−5,000원");
    expect(node.textContent).toContain("확인 중");
    expect(node.textContent).toContain("PD-OWN-123");
    expect(node.textContent).not.toContain("출금 완료");
  });
  it("keeps unknown trial values apart from KRW", () => {
    const node = dom({ initialView: "profit", trialState: "error" });
    expect(node.textContent).toContain("체험 값은 원화가 아니에요");
    expect(node.textContent).toContain("체험 값 다시 확인");
    expect(node.textContent).toContain("확인할 수 없음");
  });

  it("does not relabel a receipt of another currency as a KRW amount", () => {
    const node = dom({
      initialView: "history",
      receiptState: "ready",
      receipts: [
        {
          id: "source",
          amountAtomic: "100000000",
          currency: "USDT",
          status: "PENDING",
          transactionType: "DEPOSIT",
          receiptNumber: "PD-MANUAL",
          requestedAt: "2026-10-09T00:00:00Z",
          completedAt: null,
        },
      ],
    });
    expect(node.textContent).toContain("원화 반영액 확인 중");
    expect(node.textContent).not.toContain("100,000,000원");
    expect(node.textContent).not.toContain("100000000 USDT");
  });
});
