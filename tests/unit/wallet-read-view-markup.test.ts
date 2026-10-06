import { readFileSync } from "node:fs";
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
    expect(html.match(/>0<\/span><span[^>]*>원<\/span>/g)).toHaveLength(3);
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
    expect(html).toMatch(/>2,000<\/span><span[^>]*>원<\/span>/);
    expect(html).toMatch(/>5,000<\/span><span[^>]*>원<\/span>/);
    expect(html).toMatch(/>7,000<\/span><span[^>]*>원<\/span>/);
    expect(html).toContain("RCPT-001");
    expect(html).toContain("처리 중");
    expect(html).toContain("환영 보상 첫 출금");
    const metricsStart = html.indexOf('data-wallet-metrics="separate"');
    expect(metricsStart).toBeGreaterThan(-1);
    const metrics = html.slice(
      metricsStart,
      html.indexOf("</dl>", metricsStart),
    );
    expect(metrics.match(/<dt>/g)).toHaveLength(3);
    expect(metrics).toContain("인정 원금");
    expect(metrics).toMatch(/>100,000<\/span><span[^>]*>원<\/span>/);
    expect(metrics).toContain("정산 전 대기 수익");
    expect(metrics).toMatch(/>15,000<\/span><span[^>]*>원<\/span>/);
    expect(metrics).toContain('data-funding-tone="unconfirmed"');
    expect(metrics).toMatch(/>25,000<\/span><span[^>]*>원<\/span>/);
    expect(metrics).toContain("확정된 수익이 아니에요");
    expect(metrics).not.toContain("115,000");
    expect(metrics).not.toContain("140,000");
    expect(html.indexOf("사용 가능 잔액")).toBeLessThan(
      html.indexOf('data-wallet-metrics="separate"'),
    );
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
    expect(html).toContain("확인할 수 없음");
    expect(html).not.toContain("amountFigure");
    expect(html).not.toContain("balance-card--primary");
    expect(html).not.toContain("사용 가능 잔액</small>");
    expect(html).not.toContain('data-wallet-decoration="metal-wallet"');
  });

  it("최근 거래 내역과 PUTDUK START 전환을 숨기지 않는다", () => {
    const html = renderToStaticMarkup(
      createElement(WalletReadView, {
        balanceState: "ready",
        funding: quietFunding,
        krw: {
          availableAtomic: "5000",
          balanceAtomic: "5000",
          heldAtomic: "0",
          walletAccountId: "acct-start",
        },
        ledgerEntries: [
          {
            amountAtomic: "5000",
            createdAt: "2026-09-29T00:00:00.000Z",
            direction: "CREDIT",
            entryType: "TRIAL_REWARD_CONVERSION",
            id: "ledger-start",
          },
        ],
        ledgerState: "ready",
        receiptState: "empty",
        receipts: [],
        trialRewardAtomic: "0",
        trialState: "empty",
      }),
    );
    const historyStart = html.indexOf('aria-labelledby="ledger-history-title"');
    const history = html.slice(
      historyStart,
      html.indexOf("</section>", historyStart),
    );

    expect(historyStart).toBeGreaterThan(-1);
    expect(history).toContain('id="ledger-history-title"');
    expect(history).toContain("최근 거래 내역");
    expect(history).toContain("PUTDUK START 전환");
    expect(history).not.toContain("hidden");
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

  it("짧은 금액과 한글 단어는 한 줄로 두고 긴 숫자만 칸 안에 맞춘다", () => {
    const css = readFileSync(
      "components/product/wallet-read-view.module.css",
      "utf8",
    );
    const view = readFileSync(
      "components/product/wallet-read-view.tsx",
      "utf8",
    );

    function rule(selector: string) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return (
        css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{[^}]*\\}`, "m"))?.[0] ??
        ""
      );
    }

    for (const selector of [
      ".heroValue",
      ".breakdown dd",
      ".metric dd",
      ".trialCard strong",
    ]) {
      const block = rule(selector);
      expect(block, selector).toMatch(/min-width:\s*0/);
      expect(block, selector).toMatch(/line-break:\s*strict/);
      expect(block, selector).toMatch(/word-break:\s*keep-all/);
      expect(block, selector).toMatch(/container-type:\s*inline-size/);
      expect(block, selector).not.toMatch(/overflow-wrap:\s*anywhere/);
      expect(block, selector).not.toMatch(/word-break:\s*break-all/);
      expect(block, selector).not.toMatch(/white-space:\s*nowrap/);
    }

    expect(css).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.amountFigure\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.amountUnit\s*\{[^}]*white-space:\s*nowrap/s);
    expect(rule(".funding")).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(
      /@container\s+\(max-width:\s*12rem\)\s*\{[^}]*\.metrics\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );

    expect(rule(".metrics")).toMatch(
      /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(rule(".breakdown")).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(rule(".metric dd")).toMatch(
      /width:\s*calc\(100%\s*\+\s*var\(--metric-pad-inline\)\)/,
    );
    expect(rule(".metric dd")).toMatch(
      /margin:\s*0\s+calc\(-1\s*\*\s*var\(--metric-pad-inline\)\)\s+0\s+0/,
    );

    const narrow = css.slice(css.indexOf("@media (max-width: 520px)"));
    expect(narrow).toMatch(/--metric-pad-inline:\s*0\.55rem/);
    expect(narrow).not.toMatch(
      /\.metrics\s*\{[^}]*grid-template-columns:\s*1fr/,
    );

    expect(view).toContain('formatAtomicAmount(krw.availableAtomic, "KRW")');
    expect(view).toContain('formatAtomicAmount(krw.heldAtomic, "KRW")');
    expect(view).toContain('formatAtomicAmount(krw.balanceAtomic, "KRW")');
    expect(view).toContain("<WalletAmountText value={row.value} />");
    expect(view).toContain("확인할 수 없음");
    expect(view).not.toMatch(/toLocaleString|BigInt/);
    expect(view).not.toMatch(
      /availableAtomic\s*\+|heldAtomic\s*\+|balanceAtomic\s*\+/,
    );
  });

  it("장식은 접근성 트리에서 제외하고 입출금 동작 이름과 분리한다", () => {
    const html = renderToStaticMarkup(
      createElement(WalletReadView, {
        balanceState: "zero",
        funding: quietFunding,
        krw: {
          availableAtomic: "0",
          balanceAtomic: "0",
          heldAtomic: "0",
          walletAccountId: "acct-decoration",
        },
        ledgerEntries: [],
        ledgerState: "empty",
        receiptState: "empty",
        receipts: [],
        trialRewardAtomic: "0",
        trialState: "empty",
      }),
    );

    const artwork =
      html.match(
        /<svg[^>]*data-wallet-decoration="metal-wallet"[\s\S]*?<\/svg>/,
      )?.[0] ?? "";
    expect(artwork).toContain('aria-hidden="true"');
    expect(artwork).toContain('focusable="false"');
    expect(artwork).not.toMatch(/<text|<title|<animate|<script/);
    const decorations =
      html.match(/<svg\b[^>]*data-wallet-decoration="[^"]*"[^>]*>/g) ?? [];
    expect(decorations.length).toBeGreaterThan(1);
    for (const svg of decorations) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('focusable="false"');
    }
    expect(html).toMatch(
      /href="\/wallet\/deposit"[\s\S]*?<\/svg>입금하기<\/a>/,
    );
    expect(html).toMatch(
      /href="\/wallet\/withdraw"[\s\S]*?<\/svg>출금하기<\/a>/,
    );
    expect(artwork).not.toMatch(/role="(?:progressbar|status)"/);
    expect(html).not.toMatch(/수익률|보장 수익/);
  });

  it("큰 잔액도 숫자를 바꾸지 않고 원화·체험·확인 불가를 유지한다", () => {
    const html = renderToStaticMarkup(
      createElement(WalletReadView, {
        balanceState: "ready",
        funding: {
          state: "ready",
          rows: [
            { label: "인정 원금", tone: "separate", value: "확인할 수 없음" },
            { label: "정산 전 대기 수익", tone: "separate", value: "0원" },
            { label: "아직 확정 전", tone: "unconfirmed", value: "25,000원" },
          ],
        },
        krw: {
          availableAtomic: "9223372036854775807",
          balanceAtomic: "9223372036854775817",
          heldAtomic: "10",
          walletAccountId: "acct-exact-large",
        },
        ledgerEntries: [],
        ledgerState: "empty",
        receiptState: "empty",
        receipts: [],
        trialRewardAtomic: "1200",
        trialState: "ready",
      }),
    );

    expect(html).toMatch(
      />9,223,372,036,854,775,807<\/span><span[^>]*>원<\/span>/,
    );
    expect(html).toMatch(
      />9,223,372,036,854,775,817<\/span><span[^>]*>원<\/span>/,
    );
    expect(html).toMatch(/>10<\/span><span[^>]*>원<\/span>/);
    expect(html).toMatch(/>1,200<\/span><span[^>]*> 체험 단위<\/span>/);
    expect(html).toContain("확인할 수 없음");
    expect(html).toContain("확정된 수익이 아니에요");
    expect(html).toContain('data-wallet-long-amount="true"');
    expect(html).not.toMatch(
      /9,223,372,036,854,775,808|9,223,372,036,854,775,800/,
    );
  });
});
