// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTodaySnapshot } from "@/app/(control)/_lib/today-snapshot";
import { TodayView } from "@/components/today/today-view";
import { AdminScreenGuide } from "@/components/presentation/admin-screen-guide";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: (props: ComponentProps<"a">) => createElement("a", props),
}));

const ready = (count = 0) => ({ count, error: null });
function snapshot(
  overrides: Partial<Parameters<typeof buildTodaySnapshot>[0]> = {},
) {
  return buildTodaySnapshot({
    krwDeposits: ready(),
    usdtDeposits: ready(),
    krwWithdrawals: ready(),
    usdtWithdrawals: ready(),
    kyc: ready(),
    mismatches: ready(),
    failedJobs: ready(),
    safePaused: ready(),
    users: ready(10),
    trials: ready(2),
    audits: { data: [], error: null },
    observedAt: new Date("2026-10-07T00:00:00Z"),
    ...overrides,
  });
}
function today(value = snapshot()) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(TodayView, { snapshot: value }),
  );
  return host;
}

describe("beginner Today preserves real queue and search boundaries", () => {
  it("puts unavailable reads first without changing their counts or losing any queue", () => {
    const value = snapshot({
      krwDeposits: { count: null, error: { message: "unavailable" } },
      safePaused: ready(2),
      krwWithdrawals: ready(3),
    });
    const host = today(value);
    const grid = host.querySelector('[data-testid="today-attention-grid"]')!;
    expect(
      [...grid.children].map((node) => node.getAttribute("data-testid")),
    ).toEqual([
      "today-queue-KRW_DEPOSIT",
      "today-queue-SAFE",
      "today-queue-KRW_BANK",
      "today-queue-EXCEPTION",
      "today-queue-USDT_WD",
      "today-queue-KYC",
      "today-queue-USDT_DEPOSIT",
    ]);
    expect(
      host.querySelector('[data-testid="today-attention-total"]')?.textContent,
    ).toBe("확인 필요");
    expect(
      host.querySelector('[data-testid="today-queue-KRW_DEPOSIT"] strong')
        ?.textContent,
    ).toBe("확인 필요");
    expect(
      host
        .querySelector('aside[aria-label="먼저 확인할 일"] a')
        ?.getAttribute("href"),
    ).toBe("/deposits/krw");
    expect(value.attention[0]!.code).toBe("KRW_DEPOSIT");
    expect(host.querySelector('[data-testid="today-empty-queues"]')).toBeNull();
  });

  it("recommends the safety queue before withdrawals while preserving actual counts", () => {
    const host = today(
      snapshot({
        safePaused: ready(1),
        krwWithdrawals: ready(5),
        usdtDeposits: ready(2),
      }),
    );
    expect(
      host
        .querySelector('aside[aria-label="먼저 확인할 일"] a')
        ?.getAttribute("href"),
    ).toBe("/restrictions");
    expect(
      host.querySelector('[data-testid="today-attention-total"]')?.textContent,
    ).toBe("8");
    expect(
      host.querySelector('[data-testid="today-queue-KRW_BANK"] strong')
        ?.textContent,
    ).toBe("5");
  });

  it("keeps the genuine empty state and offers explicit name, ID and phone search without a new lookup contract", () => {
    const host = today();
    expect(host.querySelector('aside[aria-label="먼저 확인할 일"]')).toBeNull();
    expect(
      host.querySelector('[data-testid="today-empty-queues"]'),
    ).not.toBeNull();
    expect(host.querySelector('label[for="member-query"]')?.textContent).toBe(
      "이름·아이디·전화번호",
    );
    expect(
      host.querySelector('input[name="query"]')?.getAttribute("autocomplete"),
    ).toBe("off");
    expect(
      host.querySelector('section[aria-label="회원 찾기"] button')?.textContent,
    ).toBe("안전 조회");
    expect(host.querySelector("details")?.textContent).toContain(
      "승인·송금·게시가 실행되지 않습니다",
    );
  });
});

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  route.pathname = "/members";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function renderGuide() {
  await act(async () => root.render(createElement(AdminScreenGuide)));
  return host.querySelector("details")!;
}

describe("static operational guide is an accessible disclosure, never a live or execution channel", () => {
  it("opens on native disclosure and Escape restores focus to its summary", async () => {
    const details = await renderGuide();
    details.open = true;
    const close = host.querySelector("button")!;
    close.focus();
    await act(async () =>
      close.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector("summary"));
  });

  it("closes when work changes or the operator interacts outside the guide", async () => {
    const details = await renderGuide();
    details.open = true;
    await act(async () =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(details.open).toBe(false);
    details.open = true;
    route.pathname = "/catalog";
    await renderGuide();
    expect(details.open).toBe(false);
    expect(host.textContent).toContain(
      "원금 등급으로 상품 접근을 제한하지 않습니다",
    );
    expect(host.textContent).toContain("미승인 배수는 활성화하지 마세요");
  });

  it("offers a labelled close action with focus recovery", async () => {
    const details = await renderGuide();
    details.open = true;
    await act(async () => host.querySelector("button")!.click());
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(details.querySelector("summary"));
  });

  it("explains safe preparation on a nested route without any query, form or publication control", async () => {
    route.pathname = "/deposits/krw/request-id";
    const details = await renderGuide();
    expect(details.textContent).toContain("원화 입금 확인");
    expect(details.textContent).toContain("최신 상태는");
    expect(details.querySelector("form, input, a")).toBeNull();
    expect(details.querySelectorAll("button")).toHaveLength(1);
    route.pathname = "/assistant";
    await renderGuide();
    expect(host.textContent).toContain("초안 준비는 승인이 아닙니다");
  });

  it("does not substitute a misleading default guide for an unknown route", async () => {
    route.pathname = "/unwired-screen";
    await renderGuide();
    expect(host.querySelector("details")).toBeNull();
  });
});
