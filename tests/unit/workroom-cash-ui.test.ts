/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CashActivity,
  type CashActivityItem,
} from "@/components/workroom/cash-activity";
import {
  CashBalance,
  CashHeader,
  CashSteps,
} from "@/components/workroom/cash-ui";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => createElement("a", { href, ...props }, children),
}));

describe("workroom cash dashboard", () => {
  it("keeps an unavailable balance distinct from a confirmed zero balance", () => {
    const unavailable = renderToStaticMarkup(
      createElement(CashBalance, { cash: null }),
    );
    expect(unavailable).toContain("잔액을 불러오지 못했어요");
    expect(unavailable).not.toContain(">0<");
    const ready = renderToStaticMarkup(
      createElement(CashBalance, {
        cash: {
          schemaVersion: 1,
          currency: "KRW",
          source: "DIRECT_DEPOSIT",
          ready: true,
          availableKrw: "70000",
          heldKrw: "30000",
          depositedKrw: "120000",
          withdrawnKrw: "20000",
        },
      }),
    );
    for (const amount of ["70,000", "30,000", "120,000", "20,000"])
      expect(ready).toContain(amount);
    expect(ready).toContain('href="/workroom/cash/deposit"');
    expect(ready).toContain('href="/workroom/cash/withdraw"');
  });

  it("filters actual request types and pending statuses without changing amounts", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const items: CashActivityItem[] = [
      {
        id: "deposit",
        type: "DEPOSIT",
        amount: "100000",
        status: "COMPLETED",
        at: "2026-11-11T01:00:00Z",
        currency: "KRW",
      },
      {
        id: "withdraw",
        type: "WITHDRAWAL",
        amount: "30000",
        status: "PROCESSING",
        at: "2026-11-11T02:00:00Z",
        currency: "KRW",
      },
      {
        id: "approved-deposit",
        type: "DEPOSIT",
        amount: "50000",
        status: "APPROVED",
        at: "2026-11-11T03:00:00Z",
        currency: "KRW",
      },
    ];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(createElement(CashActivity, { items, full: true })),
      );
      expect(host.querySelectorAll("li")).toHaveLength(3);
      expect(host.textContent).toContain("반영 완료");
      const pending = [...host.querySelectorAll("button")].find(
        (button) => button.textContent === "처리 중",
      )!;
      await act(async () => pending.click());
      expect(pending.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelectorAll("li")).toHaveLength(1);
      expect(host.querySelector("li")?.textContent).toContain("30,000원");
      expect(host.querySelector("li")?.textContent).not.toContain("100,000원");
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("shows a failed read as an error rather than an empty successful history", () => {
    const html = renderToStaticMarkup(
      createElement(CashActivity, { items: [], failed: true }),
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("아직 입출금 내역이 없어요");
  });

  it("renders a pending USDT decimal quantity without treating it as KRW or atomic units", () => {
    const html = renderToStaticMarkup(
      createElement(CashActivity, {
        items: [
          {
            id: "usdt:request",
            type: "DEPOSIT",
            amount: "12.345678",
            currency: "USDT",
            status: "SUBMITTED",
            at: "2026-11-11T03:00:00Z",
          },
        ],
      }),
    );
    expect(html).toContain("12.345678 USDT");
    expect(html).toContain("입금 확인 중");
    expect(html).not.toContain("12.345678원");
  });

  it("connects the four active cash routes and gives contact-first deposit steps", () => {
    const html = renderToStaticMarkup(
      createElement(CashHeader, {
        active: "records",
        title: "거래 내역",
        description: "내 입출금",
      }),
    );
    expect(html).toContain('href="/workroom/records" aria-current="page"');
    expect(html).toContain('href="/workroom/cash/deposit"');
    const steps = renderToStaticMarkup(createElement(CashSteps));
    expect(steps).toContain("담당자에게 문의");
    expect(steps).toContain("운영자가 확인한 금액이 반영됩니다.");
  });
});
