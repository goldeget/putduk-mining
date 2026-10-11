import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({ requireAdminCommand: vi.fn() }));
vi.mock("@/lib/auth/step-up", () => ({ consumeAdminStepUpGrant: vi.fn() }));
vi.mock("@/app/(control)/_lib/command-gate", () => ({
  prepareMoneyAttempt: vi.fn(() => ({
    ok: true,
    idempotencyKey: "send-binding-key-01",
  })),
  requireHighImpactPrincipal: vi.fn(),
  mapRpcFailure: vi.fn(() => ({
    ok: false,
    code: "COMMAND_FAILED",
    message: "failed",
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));

import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import { recordKrwExternalSendAction } from "@/app/(control)/withdrawals/krw-bank/actions";
import { recordUsdtExternalSendAction } from "@/app/(control)/withdrawals/usdt/actions";
import { POST } from "@/app/api/v1/admin/withdrawals/command/route";
import { requireAdminCommand } from "@/lib/auth/principal";
import { consumeAdminStepUpGrant } from "@/lib/auth/step-up";
import { createAdminServiceClient } from "@/lib/supabase/service";

const owner = "11111111-1111-4111-8111-111111111111";
const withdrawal = "22222222-2222-4222-8222-222222222222";
const sendId = "33333333-3333-4333-8333-333333333333";
const otherWithdrawal = "44444444-4444-4444-8444-444444444444";
const principal = {
  userId: owner,
  role: "ADMIN" as const,
  sessionId: "session",
  adminSessionId: "admin-session",
  aal: "aal2" as const,
  amr: [],
  supabase: {} as never,
};

function client(
  rpcError: { message: string } | null,
  receipt: unknown[] | null,
  readError: unknown = null,
) {
  const rpc = vi.fn().mockResolvedValue({ data: sendId, error: rpcError });
  const filters: [string, unknown][] = [];
  const from = vi.fn(() => {
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => {
        filters.push([field, value]);
        return query;
      },
      limit: () => Promise.resolve({ data: receipt, error: readError }),
    };
    return query;
  });
  vi.mocked(createAdminServiceClient).mockReturnValue({ rpc, from } as never);
  return { rpc, from, filters };
}

function form(method: "KRW" | "USDT") {
  const data = new FormData();
  data.set("withdrawalId", withdrawal);
  data.set("sentAt", "2026-10-03T00:15");
  data.set(
    "confirmation",
    method === "KRW" ? "RECORD_KRW_SEND" : "RECORD_USDT_SEND",
  );
  if (method === "KRW") {
    data.set("bankReference", "BANK-REF-01");
    data.set("actualKrw", "5000");
  } else {
    data.set("network", "TRC20");
    data.set("txHash", "transfer-hash-0123456789");
    data.set("actualUsdt", "5.5");
  }
  return data;
}

function request(method: "KRW" | "USDT") {
  const common = {
    withdrawalId: withdrawal,
    sentAt: "2026-10-02T15:15:00.000Z",
    stepUpToken: "fresh-single-use-step-up",
    idempotencyKey: "send-binding-key-01",
  };
  const body =
    method === "KRW"
      ? {
          ...common,
          action: "RECORD_KRW_SEND",
          bankReference: "BANK-REF-01",
          actualKrwAmount: "5000",
        }
      : {
          ...common,
          action: "RECORD_USDT_SEND",
          network: "TRC20",
          txHash: "transfer-hash-0123456789",
          actualUsdtAmount: "5.5",
        };
  return new Request(
    "https://admin.mining.putduk.com/api/v1/admin/withdrawals/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("external send result binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireHighImpactPrincipal).mockResolvedValue({
      ok: true,
      requestId: withdrawal,
      principal,
    });
    vi.mocked(requireAdminCommand).mockResolvedValue({ ok: true, principal });
    vi.mocked(consumeAdminStepUpGrant).mockResolvedValue(true);
  });

  for (const [method, action, destination] of [
    ["KRW", recordKrwExternalSendAction, "KRW_BANK"],
    ["USDT", recordUsdtExternalSendAction, "USDT_ADDRESS"],
  ] as const) {
    it.each(["IDEMPOTENCY_KEY_REUSED", "EXTERNAL_SEND_PAYLOAD_MISMATCH"])(
      `${method} action validates an existing send through RPC and rejects %s`,
      async (code) => {
        const db = client({ message: code }, [
          { id: sendId, withdrawal_id: withdrawal, method: destination },
        ]);
        expect(await action(null, form(method))).toMatchObject({
          ok: false,
          code,
        });
        expect(db.rpc).toHaveBeenCalledTimes(1);
        expect(db.from).not.toHaveBeenCalled();
      },
    );
    it(`${method} action rejects an unrelated send returned as successful`, async () => {
      client(null, [
        { id: sendId, withdrawal_id: otherWithdrawal, method: destination },
      ]);
      expect(await action(null, form(method))).toMatchObject({
        ok: false,
        code: "UNCONFIRMED",
      });
    });
    it(`${method} action confirms only the returned send bound to the requested withdrawal`, async () => {
      const db = client(null, [
        { id: sendId, withdrawal_id: withdrawal, method: destination },
      ]);
      expect(await action(null, form(method))).toMatchObject({ ok: true });
      expect(db.filters).toEqual(
        expect.arrayContaining([
          ["id", sendId],
          ["withdrawal_id", withdrawal],
          ["method", destination],
        ]),
      );
    });
    it.each(["IDEMPOTENCY_KEY_REUSED", "EXTERNAL_SEND_PAYLOAD_MISMATCH"])(
      `${method} API exposes conflict %s without success or a receipt lookup`,
      async (code) => {
        const db = client({ message: code }, []);
        const response = await POST(request(method));
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ ok: false, code });
        expect(db.from).not.toHaveBeenCalled();
      },
    );
    it(`${method} API fails closed for another withdrawal's send`, async () => {
      client(null, [
        { id: sendId, withdrawal_id: otherWithdrawal, method: destination },
      ]);
      const response = await POST(request(method));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
    });
    it(`${method} API confirms the bound receipt and preserves its response contract`, async () => {
      const db = client(null, [
        { id: sendId, withdrawal_id: withdrawal, method: destination },
      ]);
      const response = await POST(request(method));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, sendId });
      expect(db.filters).toEqual(
        expect.arrayContaining([
          ["id", sendId],
          ["withdrawal_id", withdrawal],
          ["method", destination],
        ]),
      );
    });
    it(`${method} API does not confirm an unreadable receipt`, async () => {
      client(null, null, { message: "read failed" });
      const response = await POST(request(method));
      expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
    });
  }

  it("denied API access creates no service client or step-up consumption", async () => {
    vi.mocked(requireAdminCommand).mockResolvedValue({
      ok: false,
      code: "ROLE_REQUIRED",
      status: 403,
    });
    const response = await POST(request("KRW"));
    expect(response.status).toBe(403);
    expect(createAdminServiceClient).not.toHaveBeenCalled();
    expect(consumeAdminStepUpGrant).not.toHaveBeenCalled();
  });

  it("the USDT API rejects zero before consuming a one-use step-up", async () => {
    const original = await request("USDT").json();
    const input = new Request(
      "https://admin.mining.putduk.com/api/v1/admin/withdrawals/command",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...original, actualUsdtAmount: "0.000000" }),
      },
    );
    const response = await POST(input);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      code: "INVALID_COMMAND",
    });
    expect(consumeAdminStepUpGrant).not.toHaveBeenCalled();
    expect(createAdminServiceClient).not.toHaveBeenCalled();
  });

  it.each([
    ["KRW", "bankReference", "AB"],
    ["USDT", "network", "TRON"],
    ["USDT", "txHash", "a".repeat(129)],
    ["USDT", "actualUsdt", "1.0000001"],
    ["USDT", "actualUsdt", "0.000000"],
  ] as const)(
    "%s action rejects invalid %s before consuming step-up",
    async (method, field, value) => {
      client(null, []);
      const input = form(method);
      input.set(field, value);
      const action =
        method === "KRW"
          ? recordKrwExternalSendAction
          : recordUsdtExternalSendAction;
      expect(await action(null, input)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(requireHighImpactPrincipal).not.toHaveBeenCalled();
      expect(createAdminServiceClient).not.toHaveBeenCalled();
    },
  );
});
