// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  FundedRuntimeSummary,
  type FundedRuntimeSummaryProps,
} from "@/components/product/funded-runtime-summary";
import type { FundedRuntimeDisplay } from "@/lib/product/mining-server-display";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const receipt: FundedRuntimeDisplay = {
  schema_version: 1,
  runtime_version: 2,
  state_revision: "23",
  condition_revision: "15",
  accepted_cursor_at: "2026-10-06T07:45:00.123456Z",
  evaluated_at: "2026-10-06T07:46:30.654321Z",
  allocation_bps: "5678",
  committed_reward_total_atomic: "12500",
  reward_carry: { numerator: "3", denominator: "4", unit: "KRW" },
  conditional_maintenance: {
    numerator: "1125",
    denominator: "2",
    unit: "KRW",
    qualification: "UNCONFIRMED",
  },
};

function render(props: FundedRuntimeSummaryProps = {}) {
  const html = renderToStaticMarkup(createElement(FundedRuntimeSummary, props));
  return new DOMParser().parseFromString(html, "text/html");
}

function fact(document: Document, label: string) {
  return Array.from(document.querySelectorAll("dt")).find(
    (element) => element.textContent === label,
  )?.nextElementSibling?.textContent;
}

function conditional(document: Document) {
  return document.querySelector('[aria-label="조건 확인 전 원금 유지 혜택"]')!;
}

describe("funded runtime receipt presentation", () => {
  it("separates historical accepted credits from conditional benefit and spendable wallet", () => {
    const document = render({ runtime: receipt });
    expect(
      document
        .querySelector("section")
        ?.getAttribute("data-funded-runtime-state"),
    ).toBe("confirmed");
    expect(fact(document, "확정된 채굴 누계")).toBe("12,500원");
    expect(fact(document, "채굴 배분 비율")).toBe("56.78%");
    expect(conditional(document).textContent).toContain("조건 확인 전");
    expect(conditional(document).textContent).toContain("약 562원");
    expect(conditional(document).textContent).toContain(
      "사용 가능 잔액에 포함되지 않아요.",
    );
    expect(document.body.textContent).toContain(
      "현재 채굴에서 확정된 금액의 합계예요.",
    );
    expect(document.body.textContent).toContain(
      "사용 가능 잔액은 자산에서 확인해 주세요.",
    );
    expect(document.body.textContent).not.toContain("13,062");
    expect(document.body.textContent).not.toMatch(
      /채굴 중|정상 가동|1125|UNCONFIRMED|state_revision|runtime_version|numerator|denominator|bps/,
    );
  });

  it("preserves a confirmed whole-KRW total above the JavaScript safe integer range", () => {
    const document = render({
      runtime: {
        ...receipt,
        committed_reward_total_atomic: "9007199254740993",
      },
    });
    expect(fact(document, "확정된 채굴 누계")).toBe("9,007,199,254,740,993원");
    expect(fact(document, "확정된 채굴 누계")).not.toContain(
      "9,007,199,254,740,992",
    );
  });

  it.each([
    ["0", "0%"],
    ["1", "0.01%"],
    ["10", "0.1%"],
    ["100", "1%"],
    ["9950", "99.5%"],
    ["10000", "100%"],
  ])(
    "formats authoritative allocation %s without inventing activity",
    (allocation_bps, expected) => {
      const document = render({ runtime: { ...receipt, allocation_bps } });
      expect(fact(document, "채굴 배분 비율")).toBe(expected);
      expect(document.body.textContent).not.toMatch(
        /채굴 중|정상 가동|비활성|중지/,
      );
    },
  );

  it.each([
    ["0", "1", "0원"],
    ["1", "3", "1원 미만"],
    ["1", "1000000000000000000", "1원 미만"],
    ["7500", "3", "2,500원"],
    ["7501", "3", "약 2,500원"],
    ["9007199254740993123", "1000", "약 9,007,199,254,740,993원"],
  ])(
    "bounds conditional amount %s/%s and never rounds it into spendable money",
    (numerator, denominator, expected) => {
      const document = render({
        runtime: {
          ...receipt,
          conditional_maintenance: {
            ...receipt.conditional_maintenance,
            numerator,
            denominator,
          },
        },
      });
      expect(conditional(document).textContent).toContain(expected);
      expect(conditional(document).textContent).toContain(
        "아직 확정된 금액이 아니에요.",
      );
      expect(fact(document, "확정된 채굴 누계")).toBe("12,500원");
    },
  );

  it("shows a fractional carry only when present and does not add it to confirmed credits", () => {
    expect(render({ runtime: receipt }).body.textContent).toContain(
      "1원 미만의 남은 금액은 누계에 포함되지 않았어요.",
    );
    const document = render({
      runtime: {
        ...receipt,
        reward_carry: { numerator: "0", denominator: "1", unit: "KRW" },
      },
    });
    expect(document.body.textContent).not.toContain("1원 미만의 남은 금액");
    expect(fact(document, "확정된 채굴 누계")).toBe("12,500원");
  });

  it("keeps accepted and queried timestamps distinct, with exact original instants and Korean display", () => {
    const document = render({ runtime: receipt });
    const timestamps = Array.from(document.querySelectorAll("time"));
    expect(
      timestamps.map((element) => element.getAttribute("datetime")),
    ).toEqual([receipt.accepted_cursor_at, receipt.evaluated_at]);
    expect(fact(document, "기록 반영 시각")).toContain("오후 04:45:00");
    expect(fact(document, "조회 시각")).toContain("오후 04:46:30");
    expect(document.body.textContent).toContain("한국 시간 기준");
    expect(document.body.textContent).not.toMatch(
      /정산 완료 시각|출금 완료 시각/,
    );
  });

  it.each([undefined, null])(
    "uses unknown for absent proof %s, never a zero balance or active session",
    (runtime) => {
      const document = render({ runtime });
      expect(
        document
          .querySelector("section")
          ?.getAttribute("data-funded-runtime-state"),
      ).toBe("unknown");
      expect(document.body.textContent).toContain(
        "실제 채굴 기록을 확인할 수 없어요.",
      );
      expect(document.body.textContent).not.toMatch(
        /0원|0%|채굴 중|시작 전|확정 기록/,
      );
      expect(
        document.querySelector('button[type="button"]')?.textContent,
      ).toContain("다시 확인");
    },
  );

  it.each([
    { ...receipt, runtime_version: 1 },
    { ...receipt, allocation_bps: "10001" },
    { ...receipt, allocation_bps: "-1" },
    { ...receipt, committed_reward_total_atomic: "12.5" },
    { ...receipt, committed_reward_total_atomic: 12500 },
    { ...receipt, accepted_cursor_at: undefined },
    { ...receipt, accepted_cursor_at: "2026-10-06T07:45:00.123Z" },
    { ...receipt, accepted_cursor_at: "2026-10-06T07:47:00.000000Z" },
    {
      ...receipt,
      reward_carry: { numerator: "4", denominator: "4", unit: "KRW" },
    },
    {
      ...receipt,
      conditional_maintenance: {
        ...receipt.conditional_maintenance,
        qualification: "QUALIFIED",
      },
    },
    {
      ...receipt,
      conditional_maintenance: {
        ...receipt.conditional_maintenance,
        denominator: "0",
      },
    },
    { ...receipt, spendable_balance: "500000" },
    {
      available: true,
      pending_micro_krw: "12500000000",
      speed_multiplier_bps: "10000",
    },
  ])("fails closed for malformed or legacy proof %#", (runtime) => {
    const document = render({ runtime: runtime as FundedRuntimeDisplay });
    expect(
      document
        .querySelector("section")
        ?.getAttribute("data-funded-runtime-state"),
    ).toBe("unknown");
    expect(document.querySelector("dl")).toBeNull();
    expect(document.querySelector("time")).toBeNull();
    expect(document.body.textContent).not.toMatch(/12,500|500,000|채굴 중|0원/);
  });

  it("withholds an old valid receipt while loading and exposes an accessible bounded placeholder", () => {
    const document = render({ runtime: receipt, loading: true, error: true });
    expect(
      document
        .querySelector("section")
        ?.getAttribute("data-funded-runtime-state"),
    ).toBe("loading");
    expect(document.querySelector("section")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(
      document.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("채굴 기록 불러오는 중");
    expect(document.querySelector("dl")).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /12,500|약 562|확정 기록|불러오지 못/,
    );
  });

  it("withholds stale data after a failed read and offers a real read-only reload", () => {
    const document = render({ runtime: receipt, error: true });
    expect(
      document
        .querySelector("section")
        ?.getAttribute("data-funded-runtime-state"),
    ).toBe("error");
    expect(document.body.textContent).toContain(
      "채굴 기록을 불러오지 못했어요.",
    );
    expect(
      document.querySelector('button[type="button"]')?.textContent,
    ).toContain("다시 확인");
    expect(document.querySelector("dl")).toBeNull();
    expect(document.body.textContent).not.toContain("12,500");
  });

  it.each(["home", "mining"] as const)(
    "keeps the same receipt and real destinations in %s placement",
    (placement) => {
      const document = render({ runtime: receipt, placement });
      expect(
        document.querySelector("section")?.getAttribute("data-placement"),
      ).toBe(placement);
      expect(fact(document, "확정된 채굴 누계")).toBe("12,500원");
      const navigation = document.querySelector(
        'nav[aria-label="채굴 기록 관련 화면"]',
      )!;
      expect(
        Array.from(navigation.querySelectorAll("a")).map((link) => [
          link.textContent,
          link.getAttribute("href"),
        ]),
      ).toEqual([
        ["자산 확인", "/wallet"],
        ["상품 선택", "/products/allocation"],
      ]);
      expect(document.querySelector("button")).toBeNull();
      expect(document.querySelector("form")).toBeNull();
    },
  );
});
