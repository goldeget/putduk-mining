import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  userId: "00000000-0000-4000-8000-000000000001",
  requestId: "00000000-0000-4000-8000-000000000002",
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminPage: async () => ({ role: "SUPER_ADMIN", userId: "operator" }),
}));
function requestRow() {
  return {
    id: fixture.requestId,
    user_id: fixture.userId,
    amount_atomic: 1000,
    status: "REQUESTED",
    currency: "KRW",
    requested_at: "2026-11-12T00:00:00Z",
    created_at: "2026-11-12T00:00:00Z",
    approved_amount_atomic: null,
    ledger_transaction_id: null,
    destination_type: "KRW_BANK",
    destination_snapshot: { account_mask: "••••1234", network: "TRON" },
    network: "TRON",
    tx_hash: "a".repeat(64),
    sent_usdt_amount: "10",
    deposit_address_snapshot: "T".repeat(34),
    network_snapshot: "TRON",
  };
}
vi.mock("@/lib/deposits/krw-queue", () => ({
  loadKrwDepositQueue: async () => ({ ok: true, rows: [requestRow()] }),
  loadKrwDeposit: async () => ({ ok: true, row: requestRow() }),
  loadKrwDepositReceipt: async () => null,
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: () => ({
    from(table: string) {
      const data =
        table === "user_identity_profiles"
          ? [
              {
                user_id: fixture.userId,
                legal_name: "요청회원",
                login_id: "cash_member",
              },
            ]
          : table === "crypto_withdrawals"
            ? []
            : [requestRow()];
      const result = { data, error: null };
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        insert: async () => ({ error: null }),
        then: (resolve: (r: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return q;
    },
  }),
}));
vi.mock("@/app/(control)/deposits/krw/instruction-panel", () => ({
  KrwInstructionPanel: () => null,
}));
vi.mock("@/app/(control)/deposits/usdt/instruction-panel", () => ({
  UsdtInstructionPanel: () => null,
}));
vi.mock("@/app/(control)/deposits/krw/[id]/approve-form", () => ({
  KrwDepositApproveForm: () => null,
}));
vi.mock("@/app/(control)/deposits/usdt/confirm-form", () => ({
  ConfirmUsdtDepositForm: () => null,
}));
vi.mock("@/app/(control)/withdrawals/krw-bank/forms", () => ({
  FinalizeLedgerForm: () => null,
  KrwBankSendForm: () => null,
  ReleaseHoldForm: () => null,
}));
vi.mock("@/app/(control)/withdrawals/usdt/forms", () => ({
  UsdtFinalizeForm: () => null,
  UsdtReleaseForm: () => null,
  UsdtSendForm: () => null,
}));
import KrwQueue from "@/app/(control)/deposits/krw/page";
import KrwDetail from "@/app/(control)/deposits/krw/[id]/page";
import UsdtQueue from "@/app/(control)/deposits/usdt/page";
import BankWithdrawals from "@/app/(control)/withdrawals/krw-bank/page";
import UsdtWithdrawals from "@/app/(control)/withdrawals/usdt/page";
describe("requesting member shown across all cash queues", () => {
  it.each([
    ["원화 입금", () => KrwQueue()],
    [
      "원화 입금 상세",
      () => KrwDetail({ params: Promise.resolve({ id: fixture.requestId }) }),
    ],
    ["USDT 입금", () => UsdtQueue()],
    ["계좌 출금", () => BankWithdrawals()],
    ["USDT 출금", () => UsdtWithdrawals()],
  ] as const)(
    "%s shows name and login linked to the request owner",
    async (_label, render) => {
      const html = renderToStaticMarkup(await render());
      expect(html).toContain("요청회원");
      expect(html).toContain("cash_member");
      expect(html).toContain(`/members?id=${fixture.userId}`);
      expect(html).toContain("신청 회원");
    },
  );
});
