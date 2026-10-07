// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import {
  WalletReadView,
  type WalletReadViewProps,
} from "@/components/product/wallet-read-view";

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
        /<div[^>]*data-wallet-decoration="native-scene"[\s\S]*?<\/div>/,
      )?.[0] ?? "";
    expect(artwork).toContain('aria-hidden="true"');
    expect(artwork).toContain('alt=""');
    expect(artwork).toContain("/brand/scenes/wallet-vault-mobile-dark/");
    expect(artwork).toContain("/brand/scenes/wallet-vault-desktop-dark/");
    expect(artwork).not.toMatch(/<text|<title|<animate|<script|<svg/);
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

const reconstructionFixture: WalletReadViewProps = {
  balanceState: "ready",
  funding: {
    state: "ready",
    rows: [
      { label: "인정 원금", tone: "separate", value: "100,000원" },
      { label: "정산 전 대기 수익", tone: "separate", value: "15,000원" },
      { label: "아직 확정 전", tone: "unconfirmed", value: "25,000원" },
    ],
  },
  krw: {
    availableAtomic: "5000",
    balanceAtomic: "7000",
    heldAtomic: "2000",
    walletAccountId: "read-only-fixture",
  },
  ledgerEntries: [
    {
      id: "read-only-credit",
      amountAtomic: "5000",
      direction: "CREDIT",
      entryType: "TRIAL_REWARD_CONVERSION",
      createdAt: "2026-10-06T00:00:00.000Z",
    },
    {
      id: "read-only-debit",
      amountAtomic: "1000",
      direction: "DEBIT",
      entryType: "WITHDRAWAL_HOLD",
      createdAt: "2026-10-06T01:00:00.000Z",
    },
  ],
  ledgerState: "ready",
  receiptState: "empty",
  receipts: [],
  trialRewardAtomic: "1200",
  trialState: "ready",
};

function reconstructionDocument(overrides: Partial<WalletReadViewProps> = {}) {
  const html = renderToStaticMarkup(
    createElement(WalletReadView, {
      ...reconstructionFixture,
      ...overrides,
    }),
  );
  return new DOMParser().parseFromString(html, "text/html");
}

describe("Wallet reference reconstruction preserves real contracts", () => {
  it("uses one native wallet heading with the reviewed gold P while retaining the real KRW caption", () => {
    const document = reconstructionDocument();
    const heading = document.querySelector(
      'header[data-wallet-heading="native"]',
    );
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(heading?.querySelector("h1")?.textContent).toBe("지갑");
    expect(
      document.querySelector(
        '[role="radiogroup"][aria-label="원금, 수익, 거래내역"]',
      ),
    ).not.toBeNull();
    expect(heading?.querySelector("p")?.textContent).toBe(
      "실제 원화 잔액과 금액 기록을 확인하세요.",
    );
    const symbol = heading?.querySelector(
      '[data-wallet-brand-symbol="approved-gold-p"]',
    );
    expect(symbol?.getAttribute("aria-hidden")).toBe("true");
    expect(symbol?.getAttribute("focusable")).toBe("false");
    expect(
      Array.from(symbol?.querySelectorAll("path") ?? []).map((path) =>
        path.getAttribute("d"),
      ),
    ).toEqual([
      "M3 10 21 1l16 8-18 9L3 10Z",
      "M3 10v36l16 9V18L3 10Z",
      "m19 18 18-9v37l-18 9V18Z",
      "m10 14 7 4v32l-7-4V14Z",
      "m24 20 7-4v26l-7 4V20Z",
      "m3 10 18-9 16 8v37l-18 9-16-9V10Z",
    ]);
    const realWallet = document.querySelector('[aria-label="실제 KRW 지갑"]');
    expect(realWallet?.textContent).toContain("출금 가능 잔액");
    expect(realWallet?.textContent).toContain("사용 가능 잔액");
    expect(realWallet?.textContent).toContain("5,000원");
    expect(realWallet?.textContent).toContain("2,000원");
    expect(realWallet?.textContent).toContain("7,000원");
    expect(heading?.compareDocumentPosition(realWallet!)).toBe(4);
  });

  it("groups the KRW balance and three separate funding values before the two existing actions", () => {
    const document = reconstructionDocument();
    const summary = document.querySelector('[data-wallet-summary="KRW_ONLY"]');
    expect(summary).not.toBeNull();
    expect(
      summary?.querySelector('[aria-label="실제 KRW 지갑"]'),
    ).not.toBeNull();
    expect(
      summary
        ?.querySelector('[data-wallet-metrics="separate"]')
        ?.querySelectorAll("dt"),
    ).toHaveLength(3);
    expect(summary?.textContent).toContain("출금 보류");
    expect(summary?.textContent).toContain("전체");
    expect(summary?.textContent).toContain("확정된 수익이 아니에요");
    expect(summary?.querySelector("a")).toBeNull();
    const actions = document.querySelector('[aria-label="입금과 출금"]');
    expect(
      Array.from(actions?.querySelectorAll("a") ?? []).map((link) => [
        link.textContent,
        link.getAttribute("href"),
      ]),
    ).toEqual([
      ["입금하기", "/wallet/deposit"],
      ["출금하기", "/wallet/withdraw"],
    ]);
    expect(summary?.compareDocumentPosition(actions!)).toBe(4);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(document.querySelector("h1")?.textContent).toBe("지갑");
  });

  it.each(["principal", "profit", "history"] as const)(
    "keeps both real history regions visible with the %s selection",
    (initialView) => {
      const document = reconstructionDocument({ initialView });
      expect(
        document
          .querySelector('input[name="wallet-view"][checked]')
          ?.getAttribute("value"),
      ).toBe(initialView);
      const ledger = document.querySelector(
        '[aria-labelledby="ledger-history-title"]',
      );
      const receipts = document.querySelector(
        '[aria-labelledby="wallet-receipts-title"]',
      );
      expect(ledger?.textContent).toContain("PUTDUK START 전환");
      expect(receipts?.textContent).toContain("아직 입출금 처리 내역이 없어요");
      expect(ledger?.closest("[hidden],[aria-hidden=true]")).toBeNull();
      expect(receipts?.closest("[hidden],[aria-hidden=true]")).toBeNull();
      expect(
        document.querySelectorAll('input[name="wallet-view"]'),
      ).toHaveLength(3);
    },
  );

  it("shows ledger evidence before the manual USDT guide and never presents USDT as an owned balance", () => {
    const document = reconstructionDocument();
    const ledger = document.querySelector(
      '[aria-labelledby="ledger-history-title"]',
    );
    const guide = document.querySelector(
      '[aria-labelledby="wallet-money-guide-title"]',
    );
    expect(ledger?.compareDocumentPosition(guide!)).toBe(4);
    expect(guide?.tagName).toBe("ASIDE");
    expect(guide?.textContent).toContain("수동 확인 후 KRW 지갑");
    expect(guide?.textContent).toContain("사용 가능한 KRW 잔액");
    expect(guide?.querySelector("a")?.getAttribute("href")).toBe(
      "/wallet/deposit",
    );
    expect(guide?.querySelector("a")?.textContent).toBe("수동 USDT 입금 안내");
    expect(document.body.textContent).not.toMatch(
      /USDT\s*잔액|내 USDT|USDT 잔고|원금 회수|수익률|보장|L5|PLATINUM|12\.8%/,
    );
    expect(
      document.querySelector("canvas, [role=img][aria-label*=수익], svg text"),
    ).toBeNull();
  });

  it("renders only the supplied ledger direction, amount and timestamp without synthetic status", () => {
    const document = reconstructionDocument();
    const rows = document.querySelectorAll("[data-wallet-entry-direction]");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("data-wallet-entry-direction")).toBe("CREDIT");
    expect(rows[0]?.textContent).toContain("+5,000 KRW");
    expect(rows[0]?.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-10-06T00:00:00.000Z",
    );
    expect(rows[1]?.getAttribute("data-wallet-entry-direction")).toBe("DEBIT");
    expect(rows[1]?.textContent).toContain("−1,000 KRW");
    expect(rows[1]?.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-10-06T01:00:00.000Z",
    );
    expect(
      Array.from(rows)
        .map((row) => row.textContent)
        .join(" "),
    ).not.toMatch(/완료|승인|확정|관리자 확인/);
  });

  it("does not display supplied stale amounts or ledger evidence when the corresponding read failed", () => {
    const document = reconstructionDocument({
      balanceState: "error",
      funding: { state: "error" },
      ledgerState: "error",
      receiptState: "error",
      trialState: "error",
    });
    expect(
      document.querySelector('[aria-label="실제 KRW 지갑"]')?.textContent,
    ).toContain("지갑을 불러오지 못했어요");
    expect(
      document.querySelector('[data-wallet-metrics="separate"]'),
    ).toBeNull();
    expect(document.querySelector("[data-wallet-entry-direction]")).toBeNull();
    expect(
      document.querySelector('[data-wallet-decoration="metal-wallet"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /5,000|7,000|2,000|100,000|15,000|25,000/,
    );
    expect(document.body.textContent).toContain("확인할 수 없음");
    expect(document.querySelectorAll("button").length).toBeGreaterThanOrEqual(
      5,
    );
  });

  it("uses real responsive hierarchy and both resolved theme surfaces without hiding transaction evidence", () => {
    const css = readFileSync(
      "components/product/wallet-read-view.module.css",
      "utf8",
    );
    expect(css).toMatch(/\.summary\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(
      /:global\(:root\[data-theme="light"\]\)\s+\.balanceGroup/,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1100px\)[\s\S]*\.summary\s*\{[^}]*max-width:\s*42rem/,
    );
    expect(css).toMatch(
      /\.ledgerTabs\s+\.tabPanel\[data-panel="history"\]\s*\{[^}]*display:\s*grid/s,
    );
    const historyRule =
      css.match(
        /\.ledgerTabs\s+\.tabPanel\[data-panel="history"\]\s*\{[^}]*\}/,
      )?.[0] ?? "";
    expect(historyRule).not.toMatch(
      /visibility:\s*hidden|display:\s*none|opacity:\s*0/,
    );
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("forced-colors");
  });
});
