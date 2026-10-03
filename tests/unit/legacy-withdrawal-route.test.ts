import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  walletRead: vi.fn(),
  serverEnv: vi.fn(),
  encrypt: vi.fn(),
  rpc: vi.fn(),
  admin: vi.fn(),
  idempotency: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getVerifiedIdentity: mocks.identity,
}));
vi.mock("@/lib/env/server", () => ({ getServerEnv: mocks.serverEnv }));
vi.mock("@/lib/security/encrypt-sensitive-data", () => ({
  encryptSensitiveData: mocks.encrypt,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.admin,
}));
vi.mock("@/lib/api/idempotency", () => ({
  readIdempotencyKey: mocks.idempotency,
}));

import { POST } from "@/app/api/v1/withdrawals/route";

function request(body: string, key?: string) {
  return new Request("https://mining.putduk.com/api/v1/withdrawals", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body,
  });
}

function assertNoWithdrawalEffects(input: Request) {
  expect(input.bodyUsed).toBe(false);
  expect(mocks.idempotency).not.toHaveBeenCalled();
  expect(mocks.walletRead).not.toHaveBeenCalled();
  expect(mocks.admin).not.toHaveBeenCalled();
  expect(mocks.serverEnv).not.toHaveBeenCalled();
  expect(mocks.encrypt).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue(null);
  mocks.admin.mockReturnValue({ from: mocks.walletRead, rpc: mocks.rpc });
});

describe("retired withdrawal POST", () => {
  it("keeps the unauthenticated 401 boundary without reading money or request data", async () => {
    const input = request("not-json", "old-key-unauthenticated");
    const response: Response = await Reflect.apply(POST, undefined, [input]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "로그인이 필요합니다." },
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.identity).toHaveBeenCalledOnce();
    assertNoWithdrawalEffects(input);
  });

  it.each([
    ["KRW", "new-legacy-key"],
    ["USDT", "committed-legacy-key"],
    ["malformed", undefined],
  ])(
    "returns a closed 409 and recovery guidance for authenticated %s callers",
    async (currency, key) => {
      mocks.identity.mockResolvedValue({
        userId: "11111111-1111-4111-8111-111111111111",
        supabase: { from: mocks.walletRead, rpc: mocks.rpc },
      });
      const input = request(
        currency === "malformed"
          ? "not-json"
          : JSON.stringify({
              currency,
              amountAtomic: "10000",
              walletAccountId: "22222222-2222-4222-8222-222222222222",
              policyId: "33333333-3333-4333-8333-333333333333",
              destination:
                currency === "KRW"
                  ? {
                      accountHolder: "시험 사용자",
                      accountNumber: "1234567890",
                      bankCode: "KB",
                    }
                  : {
                      address: "T123456789012345678901234567890123",
                      network: "TRC20",
                    },
            }),
        key,
      );
      const response: Response = await Reflect.apply(POST, undefined, [input]);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: {
          code: "LEGACY_WITHDRAWAL_FLOW_RETIRED",
          message:
            "출금 화면에서 정보를 다시 확인해 주세요. 이미 신청했다면 최근 출금 요청에서 결과를 확인해 주세요.",
        },
      });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(mocks.identity).toHaveBeenCalledOnce();
      assertNoWithdrawalEffects(input);
    },
  );
});
