import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { JSDOM } from "jsdom";

import {
  DepositForm,
  releaseDuplicateDepositAmount,
} from "@/components/product/deposit-form";
import {
  KRW_DEPOSIT_INSTRUCTION_ENV,
  parseKrwDepositInstruction,
} from "@/domain/wallet/krw-deposit-instruction";

const root = resolve(__dirname, "../..");
const valid = {
  [KRW_DEPOSIT_INSTRUCTION_ENV.bankName]: "테스트은행",
  [KRW_DEPOSIT_INSTRUCTION_ENV.accountNumber]: "123-456-789012",
  [KRW_DEPOSIT_INSTRUCTION_ENV.accountHolder]: "퍼뜩운영",
};

describe("KRW deposit instruction (operator configuration)", () => {
  it("parses a complete configuration", () => {
    expect(parseKrwDepositInstruction(valid)).toEqual({
      accountHolder: "퍼뜩운영",
      accountNumber: "123-456-789012",
      bankName: "테스트은행",
    });
  });

  it.each([
    {},
    { ...valid, [KRW_DEPOSIT_INSTRUCTION_ENV.bankName]: "" },
    { ...valid, [KRW_DEPOSIT_INSTRUCTION_ENV.accountHolder]: " " },
    { ...valid, [KRW_DEPOSIT_INSTRUCTION_ENV.accountNumber]: "12-34" },
    { ...valid, [KRW_DEPOSIT_INSTRUCTION_ENV.accountNumber]: "abc-123-456789" },
    { ...valid, [KRW_DEPOSIT_INSTRUCTION_ENV.accountNumber]: "123--456789012" },
    {
      ...valid,
      [KRW_DEPOSIT_INSTRUCTION_ENV.accountNumber]: "<script>1234567</script>",
    },
  ])("returns null for an incomplete or malformed configuration: %j", (env) => {
    expect(parseKrwDepositInstruction(env)).toBeNull();
  });

  it("normalizes whitespace and control characters", () => {
    expect(
      parseKrwDepositInstruction({
        ...valid,
        [KRW_DEPOSIT_INSTRUCTION_ENV.bankName]: "  테스트\n은행  ",
      })?.bankName,
    ).toBe("테스트 은행");
  });

  it("renders the account as HTML text when configured", () => {
    const html = renderToStaticMarkup(
      createElement(DepositForm, {
        instruction: parseKrwDepositInstruction(valid),
      }),
    );
    expect(html).toContain('data-krw-instruction="ready"');
    expect(html).toContain("테스트은행");
    expect(html).toContain("123-456-789012");
    expect(html).toContain("퍼뜩운영");
    expect(html).toContain("운영자가 확인하면 원화");
    expect(html).not.toContain('data-krw-instruction="missing"');
    expect(html).not.toMatch(/USDT 잔액|내 USDT/);
  });

  it("renders a single deposit amount control", () => {
    const html = renderToStaticMarkup(createElement(DepositForm, {}));
    expect(html.match(/id="deposit-amount"/g)).toEqual(['id="deposit-amount"']);
    expect(html.match(/name="amount"/g)).toEqual(['name="amount"']);
  });

  it("drops the amount id from the hidden stream copy", () => {
    const dom = new JSDOM(`<!doctype html><body>
      <div hidden id="S:0">
        <label for="deposit-amount">
          <span>입금 요청 금액</span>
          <input id="deposit-amount" name="amount" />
        </label>
      </div>
      <form>
        <label for="deposit-amount">
          <span>입금 요청 금액</span>
          <input id="deposit-amount" name="amount" />
        </label>
      </form>
    </body>`);
    releaseDuplicateDepositAmount(dom.window.document);
    const remaining = [
      ...dom.window.document.querySelectorAll("#deposit-amount"),
    ];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.closest("form")).not.toBeNull();
    expect(remaining[0]?.closest("[hidden]")).toBeNull();
    expect(
      dom.window.document
        .querySelector("div[hidden] label")
        ?.getAttribute("for"),
    ).toBeNull();
    expect(
      dom.window.document.querySelector("form label")?.getAttribute("for"),
    ).toBe("deposit-amount");
  });

  it("says plainly that no account is shown yet when it is not configured", () => {
    const html = renderToStaticMarkup(createElement(DepositForm, {}));
    expect(html).toContain('data-krw-instruction="missing"');
    expect(html).toContain("입금 계좌를 준비하고 있어요");
    expect(html).not.toContain('data-krw-instruction="ready"');
  });

  it("never hard-codes an account in React or source", () => {
    for (const file of [
      "components/product/deposit-form.tsx",
      "components/product/wallet-deposit-view.tsx",
      "app/(product)/wallet/deposit/page.tsx",
    ]) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source, file).not.toMatch(/\d{3,}-\d{2,}-\d{4,}/);
    }
    const page = readFileSync(
      resolve(root, "app/(product)/wallet/deposit/page.tsx"),
      "utf8",
    );
    expect(page).toContain("readKrwDepositInstruction()");
    const example = readFileSync(resolve(root, ".env.example"), "utf8");
    for (const key of Object.values(KRW_DEPOSIT_INSTRUCTION_ENV)) {
      expect(example).toMatch(new RegExp(`^${key}=$`, "m"));
    }
  });
});
