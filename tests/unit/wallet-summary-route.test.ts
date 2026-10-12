import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: vi.fn() }));
import { getVerifiedIdentity, type VerifiedIdentity } from "@/lib/auth/session";
import { GET } from "@/app/api/v1/wallet/summary/route";

const from = vi.fn();
const select = vi.fn();
const eq = vi.fn();
const order = vi.fn();
const query = { select, eq, order };
const userId = "21000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  from.mockReturnValue(query);
  select.mockReturnValue(query);
  eq.mockReturnValue(query);
  order.mockResolvedValue({ data: [], error: null });
  vi.mocked(getVerifiedIdentity).mockResolvedValue({
    userId,
    supabase: { from } as unknown as VerifiedIdentity["supabase"],
  });
});

describe("wallet summary read boundary", () => {
  it("rejects unauthenticated reads before accessing a wallet", async () => {
    vi.mocked(getVerifiedIdentity).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns exact large atomic amounts and an explicitly unknown update clock", async () => {
    order.mockResolvedValue({
      data: [
        {
          wallet_account_id: "wallet",
          currency: "KRW",
          balance_atomic: "9007199254740993",
          available_balance_atomic: "9007199254740990",
        },
      ],
      error: null,
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        accounts: [
          {
            walletAccountId: "wallet",
            currency: "KRW",
            balanceAtomic: "9007199254740993",
            availableBalanceAtomic: "9007199254740990",
            heldBalanceAtomic: "3",
            updatedAt: null,
          },
        ],
      },
    });
    expect(eq).toHaveBeenCalledWith("user_id", userId);
    expect(eq).toHaveBeenCalledWith("currency", "KRW");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("keeps a missing wallet empty rather than creating money", async () => {
    expect(await (await GET()).json()).toEqual({ data: { accounts: [] } });
  });

  it("fails closed without leaking database errors", async () => {
    order.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
  });
});
