import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

import { WithdrawalForm } from "@/components/product/withdrawal-form";
import { WITHDRAWAL_BANKS } from "@/lib/wallet/withdrawal-banks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const account = {
  availableBalanceAtomic: "1000000",
  heldBalanceAtomic: "0",
  id: "wallet-account",
};

const policy = {
  allowedDestinations: ["KB"],
  feeAtomic: "0",
  id: "policy-krw",
  method: "KRW_BANK" as const,
  minimumAmountAtomic: "1000",
  version: 1,
};

function markup(
  destinations: {
    displayHint: string;
    id: string;
    method: "KRW_BANK";
    protectionActive: boolean;
  }[],
) {
  return renderToStaticMarkup(
    createElement(WithdrawalForm, {
      account,
      destinations,
      policies: [policy],
      ownerId: "11111111-1111-4111-8111-111111111111",
    }),
  );
}

describe("출금 폼 서버 마크업", () => {
  it("허용된 19개 은행을 키보드로 선택할 수 있는 네 그룹으로 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(WithdrawalForm, {
        account,
        destinations: [],
        policies: [
          {
            ...policy,
            allowedDestinations: [
              ...WITHDRAWAL_BANKS.map((bank) => bank.code),
              "UNKNOWN",
            ],
          },
        ],
        ownerId: "11111111-1111-4111-8111-111111111111",
      }),
    );
    const select = html.match(/<select name="bankCode"[\s\S]*?<\/select>/)?.[0];
    expect(select).toBeDefined();
    expect(select).toContain("required");
    for (const label of ["시중은행", "지방은행", "인터넷은행", "특수은행"]) {
      expect(select).toContain(`<optgroup label="${label}">`);
    }
    for (const bank of WITHDRAWAL_BANKS) {
      expect(select).toContain(
        `<option value="${bank.code}">${bank.name}</option>`,
      );
    }
    expect(select).not.toContain("UNKNOWN");
    expect(select?.match(/<option value="[^\"]+"/g)).toHaveLength(19);
  });

  it("제목과 버튼을 잘못된 부모 안에 넣지 않는다", () => {
    const html = markup([
      {
        displayHint: "국민 ****1234",
        id: "destination-1",
        method: "KRW_BANK",
        protectionActive: false,
      },
    ]);

    expect(html).not.toMatch(/<span[^>]*>\s*<h2/);
    expect(html).not.toMatch(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?<button/);
    expect(html).toMatch(
      /<div class="[^"]*formNoticeBody[^"]*">등록된 목적지: 국민 \*\*\*\*1234<button/,
    );
  });

  it("새 계좌 선택값은 서버와 클라이언트가 같은 빈 값으로 시작한다", () => {
    const html = markup([]);

    expect(html).toContain('name="bankCode"');
    expect(html).toContain('value=""');
    expect(html).not.toContain("defaultValue");
  });

  it("KRW 잔액 출금 문구를 유지하고 USDT 잔액 표현을 쓰지 않는다", () => {
    const html = markup([]);

    expect(html).toContain("사용 가능한 원화에서만 출금할 수 있어요.");
    expect(html).toContain("USDT를 따로 보관하지 않습니다.");
    expect(html).not.toContain("USDT 잔액");
    expect(html).not.toContain("USDT 지갑");
    expect(html).not.toContain("보유 USDT");
  });
});
