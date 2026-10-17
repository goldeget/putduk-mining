import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  read: vi.fn(),
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
const key = "source-route-logical-key";
function holdReceipt(extra: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    idempotency_key: key,
    method: "KRW_BANK",
    destination_id: destinationId,
    amount_krw: "1000",
    withdrawal_id: withdrawalId,
    ...extra,
  };
}
function request(extra: Record<string, unknown> = {}) {
  return new Request("https://mining.putduk.com/api/v1/withdrawals/hold", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
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
  const query = {
    select: mocks.select,
    eq: mocks.eq,
    maybeSingle: mocks.read,
  };
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  mocks.admin.mockReturnValue({ rpc: mocks.rpc, from: mocks.from });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.read.mockResolvedValue({ data: holdReceipt(), error: null });
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
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith(
      "withdrawal_logical_requests",
    );
    expect(mocks.eq.mock.calls).toEqual([
      ["user_id", userId],
      ["idempotency_key", key],
      ["withdrawal_id", withdrawalId],
    ]);
  });

  it.each(["KRW_BANK", "USDT_ADDRESS"])(
    "accepts the bound original %s receipt without interpreting payout currency",
    async (method) => {
      mocks.rpc.mockResolvedValue({ data: withdrawalId, error: null });
      mocks.read.mockResolvedValue({
        data: holdReceipt({ method, amount_krw: 1000 }),
        error: null,
      });
      const response = await POST(request({ method }));
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ data: { withdrawalId } });
    },
  );

  it("retains the same response and owner/key binding on a committed replay", async () => {
    mocks.rpc.mockResolvedValue({ data: withdrawalId, error: null });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await POST(request());
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ data: { withdrawalId } });
    }
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(
      mocks.rpc.mock.calls.every(
        ([command]) => command === "hold_withdrawal_logical_request",
      ),
    ).toBe(true);
  });

  it("compares UUID values across the database's canonical lowercase representation", async () => {
    const destination = "abcdefab-cdef-4def-8def-abcdefabcdef";
    mocks.rpc.mockResolvedValue({ data: withdrawalId, error: null });
    mocks.read.mockResolvedValue({
      data: holdReceipt({ destination_id: destination }),
      error: null,
    });
    const response = await POST(
      request({ destinationId: destination.toUpperCase() }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { withdrawalId } });
  });

  it.each([null, {}, [], { withdrawalId }, 1, "", "unverified-original"])(
    "keeps malformed success %j uncertain without another financial command",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      const response = await POST(request());
      const payload = await response.json();
      expect(response.status).toBe(503);
      expect(payload.error.code).toBe("WITHDRAWAL_RECONCILIATION_REQUIRED");
      expect(
        classifyWithdrawalHoldResponse({
          bodyParsed: true,
          ok: false,
          payload,
          status: response.status,
        }),
      ).toBe("uncertain");
      expect(mocks.rpc).toHaveBeenCalledOnce();
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it.each([
    { user_id: "44444444-4444-4444-8444-444444444444" },
    { idempotency_key: "different-original-key" },
    { method: "USDT_ADDRESS" },
    { destination_id: "44444444-4444-4444-8444-444444444444" },
    { amount_krw: "1001" },
    { amount_krw: Number.MAX_SAFE_INTEGER + 1 },
    { withdrawal_id: "44444444-4444-4444-8444-444444444444" },
  ])("does not confirm a different or imprecise binding %j", async (extra) => {
    mocks.rpc.mockResolvedValue({ data: withdrawalId, error: null });
    mocks.read.mockResolvedValue({ data: holdReceipt(extra), error: null });
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("WITHDRAWAL_RECONCILIATION_REQUIRED");
    expect(
      classifyWithdrawalHoldResponse({
        bodyParsed: true,
        ok: false,
        payload,
        status: response.status,
      }),
    ).toBe("uncertain");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it.each([
    { data: null, error: null },
    { data: holdReceipt(), error: { message: "private_read_unavailable" } },
  ])("keeps missing or failed readback uncertain", async (read) => {
    mocks.rpc.mockResolvedValue({ data: withdrawalId, error: null });
    mocks.read.mockResolvedValue(read);
    const response = await POST(request());
    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload.error.code).toBe("WITHDRAWAL_RECONCILIATION_REQUIRED");
    expect(JSON.stringify(payload)).not.toContain("private_read_unavailable");
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("keeps lost RPC or readback responses uncertain without reissuing HOLD", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("private_transport_failure"));
    const lost = await POST(request());
    expect(lost.status).toBe(503);
    expect(JSON.stringify(await lost.json())).not.toContain(
      "private_transport",
    );
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: withdrawalId, error: null });
    mocks.read.mockRejectedValueOnce(new Error("private_read_failure"));
    const unread = await POST(request());
    expect(unread.status).toBe(503);
    expect((await unread.json()).error.code).toBe(
      "WITHDRAWAL_RECONCILIATION_REQUIRED",
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("bounds oversized declared bodies before the financial RPC", async () => {
    const input = request();
    input.headers.set("Content-Length", "2049");
    const response = await POST(input);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(
      "INVALID_WITHDRAWAL_REQUEST",
    );
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "bounds an otherwise valid chunked body with misleading length=%s",
    async (misleadingLength) => {
      const body =
        JSON.stringify({
          method: "KRW_BANK",
          destinationId,
          amountKrw: "1000",
        }) + " ".repeat(2048);
      const bytes = new TextEncoder().encode(body);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, 1100));
          controller.enqueue(bytes.slice(1100));
          controller.close();
        },
      });
      const init = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          ...(misleadingLength ? { "Content-Length": "1" } : {}),
        },
        body: stream,
        duplex: "half",
      };
      const input = new Request(
        "https://mining.putduk.com/api/v1/withdrawals/hold",
        init,
      );
      const response = await POST(input);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(
        "INVALID_WITHDRAWAL_REQUEST",
      );
      expect(mocks.admin).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

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
