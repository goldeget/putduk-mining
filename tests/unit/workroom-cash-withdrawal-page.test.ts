import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  admin: vi.fn(),
  cash: vi.fn(),
  walletFilters: vi.fn(),
  destinationColumns: vi.fn(),
  destinationReadFailed: false,
}));
vi.mock("@/lib/auth/session", () => ({ requirePageUser: mocks.identity }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.admin,
}));
vi.mock("@/lib/wallet/read-workroom-cash.server", () => ({
  readWorkroomCash: mocks.cash,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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

import CashWithdrawalPage from "@/app/(product)/workroom/cash/withdraw/page";

const ownerId = "11111111-1111-4111-8111-111111111111";
const safeDestinationColumns = new Set([
  "id",
  "destination_type",
  "display_hint",
  "verification_status",
  "verified_at",
  "protection_until",
  "replaced_at",
  "created_at",
  "updated_at",
]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.destinationReadFailed = false;
  vi.stubEnv("WITHDRAWAL_DATA_KEY", Buffer.alloc(32, 7).toString("base64"));
  mocks.cash.mockResolvedValue({
    schemaVersion: 1,
    currency: "KRW",
    source: "DIRECT_DEPOSIT",
    ready: true,
    availableKrw: "0",
    heldKrw: "0",
    depositedKrw: "0",
    withdrawnKrw: "0",
  });
  mocks.identity.mockResolvedValue({
    userId: ownerId,
    supabase: {
      from(table: string) {
        if (table === "wallet_balance_snapshots") {
          const query = {
            select: () => query,
            eq: (...args: unknown[]) => {
              mocks.walletFilters(...args);
              return query;
            },
            maybeSingle: async () => ({
              data: { wallet_account_id: "wallet-account" },
              error: null,
            }),
          };
          return query;
        }
        if (table !== "withdrawal_destinations")
          throw new Error("Unexpected member read");
        // Mirrors the deployed column grant: RLS can use user_id internally,
        // but an authenticated SELECT/WHERE cannot reference that owner column.
        let denied = false;
        const checkColumn = (column: string) => {
          if (!safeDestinationColumns.has(column)) denied = true;
        };
        const query = {
          select(columns: string) {
            mocks.destinationColumns(columns);
            columns.split(",").forEach((column) => checkColumn(column.trim()));
            return query;
          },
          eq(column: string) {
            checkColumn(column);
            return query;
          },
          in(column: string) {
            checkColumn(column);
            return query;
          },
          is(column: string) {
            checkColumn(column);
            return query;
          },
          order(column: string) {
            checkColumn(column);
            return Promise.resolve({
              data: [],
              error:
                denied || mocks.destinationReadFailed
                  ? { code: "42501", message: "permission denied" }
                  : null,
            });
          },
        };
        return query;
      },
    },
  });
  mocks.admin.mockReturnValue({
    from(table: string) {
      if (table !== "withdrawal_policies")
        throw new Error("Unexpected service read");
      const query = {
        select: () => query,
        eq: () => query,
        lte: () => query,
        or: () => query,
        order: async () => ({
          data: [
            {
              id: "policy-krw",
              version: 1,
              destination_type: "KRW_BANK",
              minimum_amount_atomic: "1000",
              fee_atomic: "0",
              destination_config: { allowed_bank_codes: ["KB"] },
            },
          ],
          error: null,
        }),
      };
      return query;
    },
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("cash withdrawal page with authenticated safe destination grants", () => {
  it("renders the actual form for a zero balance and no registered destinations without selecting the service-only owner column", async () => {
    const html = renderToStaticMarkup(await CashWithdrawalPage());
    expect(html).toContain('id="withdrawal-amount"');
    expect(html).toContain('name="bankCode"');
    expect(html).not.toContain("출금 정보를 확인하지 못했습니다");
    expect(mocks.identity).toHaveBeenCalledWith("/workroom/cash/withdraw");
    expect(mocks.walletFilters).toHaveBeenCalledWith("user_id", ownerId);
    expect(mocks.destinationColumns).toHaveBeenCalledWith(
      "id,destination_type,display_hint,verification_status,protection_until",
    );
  });

  it("keeps the unavailable-state fallback when the destination read actually fails", async () => {
    mocks.destinationReadFailed = true;
    const html = renderToStaticMarkup(await CashWithdrawalPage());
    expect(html).toContain("출금 정보를 확인하지 못했습니다");
    expect(html).not.toContain('id="withdrawal-amount"');
  });
});
