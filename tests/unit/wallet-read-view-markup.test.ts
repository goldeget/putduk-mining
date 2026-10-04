import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { WalletReadView } from "@/components/product/wallet-read-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => createElement("a", { href, ...props }, children),
}));

const quietFunding = { state: "empty" as const };

describe("WalletReadView 마크업", () => {
  it("0원 상태와 빈 내역을 구분해서 보여 준다", () => {
    const html = renderToStaticMarkup(
      createElement(WalletReadView, {
        balanceState: "zero",
        funding: quietFunding,
        krw: {
          availableAtomic: "0",
          balanceAtomic: "0",
          heldAtomic: "0",
          walletAccountId: "acct-zero",
        },
        ledgerEntries: [],
        ledgerState: "empty",
        receiptState: "empty",
        receipts: [],
        trialRewardAtomic: "0",
        trialState: "empty",
      }),
    );

    expect(html).toContain("출금 가능 잔액");
    expect(html).toContain("0 KRW");
    expect(html).toContain("지금 사용 가능한 원화는 0원이에요");
    expect(html).toContain("아직 거래 내역이 없어요");
    expect(html).toContain("아직 입출금 처리 내역이 없어요");
    expect(html).toContain("원금과 대기 수익은 아직 없어요");
    expect(html).not.toMatch(/USDT\s*잔액|내 USDT|USDT 잔고/);
  });

  it("원장·영수증 증거를 요청 번호와 함께 보여 준다", () => {
    const html = renderToStaticMarkup(
      createElement(WalletReadView, {
        balanceState: "ready",
        funding: {
          state: "ready",
          rows: [
            { label: "인정 원금", tone: "separate", value: "100,000원" },
            {
              label: "정산 전 대기 수익",
              tone: "separate",
              value: "15,000원",
            },
            { label: "아직 확정 전", tone: "unconfirmed", value: "25,000원" },
          ],
        },
        krw: {
          availableAtomic: "5000",
          balanceAtomic: "7000",
          heldAtomic: "2000",
          walletAccountId: "acct-ready",
        },
        ledgerEntries: [
          {
            amountAtomic: "5000",
            createdAt: "2026-09-29T00:00:00.000Z",
            direction: "CREDIT",
            entryType: "WELCOME_REWARD",
            id: "ledger-1",
          },
        ],
        ledgerState: "ready",
        receiptState: "ready",
        receipts: [
          {
            amountAtomic: "5000",
            completedAt: null,
            currency: "KRW",
            id: "receipt-1",
            receiptNumber: "RCPT-001",
            requestedAt: "2026-09-29T01:00:00.000Z",
            status: "PROCESSING",
            transactionType: "WELCOME_WITHDRAWAL",
          },
        ],
        trialRewardAtomic: null,
        trialState: "empty",
      }),
    );

    expect(html).toContain("환영 보상");
    expect(html).toContain("+5,000 KRW");
    expect(html).toContain("2,000 KRW");
    expect(html).toContain("RCPT-001");
    expect(html).toContain("처리 중");
    expect(html).toContain("환영 보상 첫 출금");
    expect(html).toContain("인정 원금");
    expect(html).toContain("100,000원");
    expect(html).toContain("정산 전 대기 수익");
    expect(html).toContain("15,000원");
    expect(html).toContain('data-funding-tone="unconfirmed"');
    expect(html).toContain("25,000원");
    expect(html).toContain("확정된 수익이 아니에요");
    expect(html).toContain("5,000 KRW");
    expect(html).not.toContain("115,000");
    expect(html).not.toContain("140,000");
    expect(html).not.toContain("40,000원");
  });

  it("읽기 실패에 복구 버튼을 제공한다", () => {
    const html = renderToStaticMarkup(
      createElement(WalletReadView, {
        balanceState: "error",
        funding: { state: "error" },
        krw: null,
        ledgerEntries: [],
        ledgerState: "error",
        receiptState: "error",
        receipts: [],
        trialRewardAtomic: null,
        trialState: "error",
      }),
    );

    expect(html).toContain("지갑을 불러오지 못했어요");
    expect(html).toContain("원금과 대기 수익을 불러오지 못했어요");
    expect(html).toContain("거래 내역을 불러오지 못했어요");
    expect(html).toContain("처리 내역을 불러오지 못했어요");
    expect(html).toContain("다시 시도");
    expect(html).toContain("체험 값 다시 확인");
    expect(html).not.toContain("balance-card--primary");
    expect(html).not.toContain("사용 가능 잔액</small>");
  });

  it("입금·출금은 링크로만 연결하고 잔액을 쓰지 않는다", () => {
    const html = renderToStaticMarkup(
      createElement(WalletReadView, {
        balanceState: "empty",
        funding: quietFunding,
        krw: null,
        ledgerEntries: [],
        ledgerState: "empty",
        receiptState: "empty",
        receipts: [],
        trialRewardAtomic: "1200",
        trialState: "ready",
      }),
    );

    expect(html).toContain('href="/wallet/withdraw"');
    expect(html).toContain('href="/wallet/deposit"');
    expect(html).toContain("아직 표시할 지갑이 없어요");
    expect(html).not.toMatch(/update|mutate|insert/i);
  });
});
