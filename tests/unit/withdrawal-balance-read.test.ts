import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WithdrawalPage from "@/app/(product)/wallet/withdraw/page";

const wallet = vi.hoisted(() => ({
  data: null as null | Record<string, string>,
  error: null as null | { message: string },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/components/product/withdrawal-form", () => ({
  WithdrawalForm: () => "WITHDRAWAL_FORM",
}));
vi.mock("@/components/product/welcome-withdrawal-action", () => ({
  WelcomeWithdrawalAction: () => "WELCOME_ACTION",
}));
function query(table: string) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle() {
      return builder;
    },
    in() {
      return builder;
    },
    is() {
      return builder;
    },
    lte() {
      return builder;
    },
    or() {
      return builder;
    },
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve(
        table === "wallet_balance_snapshots"
          ? wallet
          : {
              data: table === "trial_reward_conversions" ? null : [],
              error: null,
            },
      ).then(resolve);
    },
  };
  return builder;
}
vi.mock("@/lib/auth/session", () => ({
  requirePageUser: async () => ({ userId: "owner", supabase: { from: query } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: query }),
}));
beforeEach(() => {
  wallet.data = null;
  wallet.error = null;
});
async function html() {
  return renderToStaticMarkup(await WithdrawalPage());
}
function balanceText(rendered: string) {
  return new DOMParser()
    .parseFromString(rendered, "text/html")
    .querySelector('section[aria-label="출금 잔액"]')!
    .textContent!.replace(/\s+/g, " ")
    .trim();
}
describe("withdrawal balance read truth", () => {
  it("shows unknown instead of zero when the wallet snapshot fails", async () => {
    wallet.error = { message: "snapshot unavailable" };
    const rendered = await html();
    expect(balanceText(rendered)).toContain("출금 가능 금액확인할 수 없음");
    expect(balanceText(rendered)).toContain("출금 보류 확인할 수 없음");
    expect(rendered).toContain("출금 정보를 불러오지 못했어요");
    expect(rendered).not.toContain("WITHDRAWAL_FORM");
  });
  it("does not trust a stale row returned alongside a query error", async () => {
    wallet.data = {
      wallet_account_id: "wallet",
      available_balance_atomic: "8000",
      balance_atomic: "10000",
    };
    wallet.error = { message: "partial failure" };
    expect(balanceText(await html())).not.toContain("8,000");
  });
  it("preserves authoritative zero and positive held balances after a successful read", async () => {
    wallet.data = {
      wallet_account_id: "wallet",
      available_balance_atomic: "0",
      balance_atomic: "0",
    };
    expect(balanceText(await html())).toContain("출금 가능 금액0원");
    wallet.data = {
      wallet_account_id: "wallet",
      available_balance_atomic: "8000",
      balance_atomic: "10000",
    };
    const rendered = await html();
    expect(balanceText(rendered)).toContain("출금 가능 금액8,000원");
    expect(balanceText(rendered)).toContain("출금 보류 2,000원");
  });
  it("does not turn an absent wallet into an asserted zero balance", async () => {
    const rendered = await html();
    expect(balanceText(rendered)).toContain("출금 가능 금액확인할 수 없음");
    expect(rendered).not.toContain("WITHDRAWAL_FORM");
  });
});
// @vitest-environment jsdom
