import { describe, expect, it, vi } from "vitest";
import type { VerifiedIdentity } from "@/lib/auth/session";
import { readWorkroomCashActivity } from "@/lib/wallet/read-workroom-cash-activity.server";

describe("own workroom cash request history", () => {
  it("merges pending original deposits and withdrawal receipts without colliding IDs or losing USDT precision", async () => {
    const source = {
      deposit_requests: [
        {
          id: "same",
          amount_atomic: "100000",
          status: "AWAITING_TRANSFER",
          requested_at: "2026-11-11T01:00:00Z",
        },
      ],
      transaction_receipts: [
        {
          id: "same",
          amount_atomic: "30000",
          status: "HELD",
          requested_at: "2026-11-11T02:00:00Z",
        },
      ],
      usdt_manual_deposits: [
        {
          id: "same",
          sent_usdt_amount: "12.345678",
          status: "SUBMITTED",
          created_at: "2026-11-11T03:00:00Z",
        },
      ],
    };
    const eq = vi.fn();
    const supabase = {
      from: (table: keyof typeof source) => {
        const query = {
          select: () => query,
          eq: (...args: unknown[]) => {
            eq(table, ...args);
            return query;
          },
          order: () => query,
          limit: () => Promise.resolve({ data: source[table], error: null }),
        };
        return query;
      },
    };
    const result = await readWorkroomCashActivity(
      { userId: "verified-owner", supabase } as unknown as VerifiedIdentity,
      6,
    );
    expect(result.failed).toBe(false);
    expect(result.items.map((item) => item.id)).toEqual([
      "usdt:same",
      "withdrawal:same",
      "deposit:same",
    ]);
    expect(result.items[0]).toMatchObject({
      currency: "USDT",
      amount: "12.345678",
      status: "SUBMITTED",
    });
    expect(eq.mock.calls.filter((call) => call[1] === "user_id")).toEqual([
      ["deposit_requests", "user_id", "verified-owner"],
      ["transaction_receipts", "user_id", "verified-owner"],
      ["usdt_manual_deposits", "user_id", "verified-owner"],
    ]);
  });
});
