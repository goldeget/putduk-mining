import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: mocks.identity }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.admin,
}));

import { POST } from "@/app/api/v1/withdrawals/hold/route";
import { memberWithdrawalSubmitMessage } from "@/components/product/member-withdrawal-errors";
import { classifyWithdrawalHoldResponse } from "@/lib/wallet/withdrawal-logical-request";
import {
  WITHDRAWAL_SOURCE_UNAVAILABLE_CODE,
  WITHDRAWAL_SOURCE_UNAVAILABLE_COPY,
} from "@/lib/wallet/withdrawal-source-status";

const userId = "11111111-1111-4111-8111-111111111111";
const destinationId = "22222222-2222-4222-8222-222222222222";
const withdrawalId = "33333333-3333-4333-8333-333333333333";
function request(extra: Record<string, unknown> = {}) {
  return new Request("https://mining.putduk.com/api/v1/withdrawals/hold", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "source-route-logical-key",
    },
    body: JSON.stringify({
      method: "KRW_BANK",
      destinationId,
      amountKrw: "1000",
      ...extra,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ userId });
  mocks.admin.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("source-aware withdrawal HTTP boundary", () => {
  it("keeps unauthorized callers outside request parsing and money commands", async () => {
    mocks.identity.mockResolvedValue(null);
    const input = request({ source: "PRINCIPAL" });
    const response = await POST(input);
    expect(response.status).toBe(401);
    expect(input.bodyUsed).toBe(false);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { source: "PRINCIPAL" },
    { source: "MINING_REWARD", sourceComplete: true },
    { welcomeRewardConversionId: withdrawalId },
    { ownerId: "44444444-4444-4444-8444-444444444444" },
  ])(
    "rejects uncontracted browser authority %j before the RPC",
    async (extra) => {
      const response = await POST(request(extra));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(
        "INVALID_WITHDRAWAL_REQUEST",
      );
      expect(mocks.admin).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("maps a rolled-back source guard to recoverable Korean copy without exposing SQL", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE DETAIL app_private.source_secret",
      },
    });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload).toEqual({
      error: {
        code: WITHDRAWAL_SOURCE_UNAVAILABLE_CODE,
        message: WITHDRAWAL_SOURCE_UNAVAILABLE_COPY,
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(/app_private|LIFECYCLE|DETAIL/);
    expect(memberWithdrawalSubmitMessage(payload)).toBe(
      WITHDRAWAL_SOURCE_UNAVAILABLE_COPY,
    );
    expect(
      classifyWithdrawalHoldResponse({
        bodyParsed: true,
        ok: false,
        payload,
        status: 409,
      }),
    ).toBe("definitive_rejection");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "hold_withdrawal_logical_request",
      {
        p_user_id: userId,
        p_method: "KRW_BANK",
        p_destination_id: destinationId,
        p_amount_krw: "1000",
        p_idempotency_key: "source-route-logical-key",
      },
    );
  });

  it("retains the original success receipt and does not fabricate source data", async () => {
    mocks.rpc.mockResolvedValue({ data: withdrawalId, error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { withdrawalId } });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("keeps an unrelated database failure uncertain without leaking its message", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "relation private_money does not exist" },
    });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(JSON.stringify(payload)).not.toContain("private_money");
    expect(
      classifyWithdrawalHoldResponse({
        bodyParsed: true,
        ok: false,
        payload,
        status: 503,
      }),
    ).toBe("uncertain");
  });
});
