import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import DepositError from "@/app/(product)/wallet/deposit/error";
import DepositLoading from "@/app/(product)/wallet/deposit/loading";
import { classifyDepositRead } from "@/domain/wallet/deposit-read";
import {
  formatSentUsdtDisplay,
  isPositiveUsdtSentAmount,
  normalizeUsdtSentAmount,
  sanitizeUsdtSentAmountInput,
} from "@/domain/wallet/usdt-manual-deposit";

describe("USDT manual deposit amount", () => {
  it("rejects malformed, zero, and over-scale amounts without float math", () => {
    expect(sanitizeUsdtSentAmountInput("1.2.3원")).toBe("1.2.3");
    expect(normalizeUsdtSentAmount("1.2.3")).toBeNull();
    expect(normalizeUsdtSentAmount("0")).toBeNull();
    expect(normalizeUsdtSentAmount("0.0")).toBeNull();
    expect(normalizeUsdtSentAmount("1.")).toBeNull();
    expect(normalizeUsdtSentAmount("1.1234567")).toBeNull();
    expect(normalizeUsdtSentAmount("00.10")).toBe("0.10");
    expect(normalizeUsdtSentAmount("10")).toBe("10");
    expect(isPositiveUsdtSentAmount("0")).toBe(false);
    expect(isPositiveUsdtSentAmount("1.2.3")).toBe(false);
    expect(isPositiveUsdtSentAmount("0.000001")).toBe(true);
  });

  it("displays a numeric string without converting through float", () => {
    expect(formatSentUsdtDisplay("0007.654321000")).toBe("7.654321");
    expect(formatSentUsdtDisplay("1.2.3")).toBe("수량 확인 중");
    expect(formatSentUsdtDisplay(Number.NaN)).toBe("수량 확인 중");
  });
});

describe("deposit read states", () => {
  it("keeps query failure distinct from an empty history", () => {
    expect(classifyDepositRead({ count: 0, error: false })).toBe("empty");
    expect(classifyDepositRead({ count: 0, error: true })).toBe("error");
    expect(classifyDepositRead({ count: 2, error: false })).toBe("ready");
  });
});

describe("deposit route feedback", () => {
  it("shows a Korean loading label", () => {
    const html = renderToStaticMarkup(createElement(DepositLoading));
    expect(html).toContain("입금 화면 불러오는 중");
    expect(html).toContain('role="status"');
  });

  it("shows recovery copy without the technical error", () => {
    const html = renderToStaticMarkup(
      createElement(DepositError, {
        error: Object.assign(new Error("DEPOSIT_SECRET_STACK"), {
          digest: "digest-hidden",
        }),
        reset: () => undefined,
      }),
    );
    expect(html).toContain("입금 화면을 열지 못했어요");
    expect(html).toContain("다시 시도");
    expect(html).toContain("실제 잔액에는 영향이 없습니다");
    expect(html).not.toContain("DEPOSIT_SECRET_STACK");
    expect(html).not.toContain("digest-hidden");
  });
});

describe("deposit submission boundary", () => {
  it("does not call the privileged RPC from the browser form", () => {
    const form = readFileSync(
      "components/product/usdt-manual-deposit-form.tsx",
      "utf8",
    );
    const page = readFileSync("app/(product)/wallet/deposit/page.tsx", "utf8");
    expect(form).not.toContain("createSupabaseBrowserClient");
    expect(form).not.toContain("submit_usdt_manual_deposit");
    expect(form).not.toContain("p_user_id");
    expect(form).toContain("/api/v1/deposits/usdt");
    expect(page).toContain("usdt_manual_deposits");
    expect(page).toContain("deposit_address");
    expect(page).not.toContain("usdt_manual_deposit_requests");
    expect(page).not.toContain('select("address, network');
  });
});
