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
import {
  finalizeWithdrawalLedgerAction,
  recordKrwExternalSendAction,
} from "@/app/(control)/withdrawals/krw-bank/actions";
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
  initialReceipt: unknown = null,
) {
  const rpc = vi.fn().mockResolvedValue({ data: sendId, error: rpcError });
  const filters: [string, unknown][] = [];
  let singleReads = 0;
  const from = vi.fn(() => {
    const query = {
      select: () => query,
      eq: (field: string, value: unknown) => {
        filters.push([field, value]);
        return query;
      },
      limit: () => Promise.resolve({ data: receipt, error: readError }),
      maybeSingle: () =>
        Promise.resolve({
          data: singleReads++ === 0 ? initialReceipt : (receipt?.[0] ?? null),
          error: readError,
        }),
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

function finalizeForm() {
  const data = new FormData();
  data.set("withdrawalId", withdrawal);
  data.set("confirmation", "FINALIZE_LEDGER");
  return data;
}

function finalizeRequest() {
  return new Request(
    "https://admin.mining.putduk.com/api/v1/admin/withdrawals/command",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "FINALIZE_LEDGER",
        withdrawalId: withdrawal,
        stepUpToken: "fresh-single-use-step-up",
        idempotencyKey: "send-binding-key-01",
      }),
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

  it.each([
    "KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST",
    "WITHDRAWAL_KRW_PAYOUT_AMOUNT_MISMATCH",
  ])(
    "KRW action exposes %s without confirming a failed manual send",
    async (code) => {
      const db = client({ message: `22023: ${code}` }, []);
      const result = await recordKrwExternalSendAction(null, form("KRW"));
      expect(result).toMatchObject({ ok: false, code });
      expect(result.message).toContain("요청 금액 전액");
      expect(result.message).toContain("수수료 없이 수동 송금");
      expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
        "record_krw_external_send",
        {
          p_withdrawal_id: withdrawal,
          p_bank_reference: "BANK-REF-01",
          p_actual_krw_amount: "5000",
          p_actor: owner,
          p_sent_at: "2026-10-02T15:15:00.000Z",
          p_idempotency_key: "send-binding-key-01",
        },
      );
      expect(db.from).not.toHaveBeenCalled();
    },
  );

  it.each([
    "KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST",
    "WITHDRAWAL_KRW_PAYOUT_AMOUNT_MISMATCH",
  ])("KRW API exposes %s as conflict without a false receipt", async (code) => {
    const db = client({ message: code }, []);
    const response = await POST(request("KRW"));
    expect(response.status).toBe(409);
    const result = await response.json();
    expect(result).toMatchObject({ ok: false, code });
    expect(result.message).toContain("요청 금액 전액");
    expect(result).not.toHaveProperty("sendId");
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each([
    "KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST",
    "WITHDRAWAL_KRW_PAYOUT_AMOUNT_MISMATCH",
  ])(
    "completion action exposes %s without another financial command",
    async (code) => {
      const db = client({ message: `55000: ${code}` }, []);
      const result = await finalizeWithdrawalLedgerAction(null, finalizeForm());
      expect(result).toMatchObject({ ok: false, code });
      expect(result.message).toContain("완료 처리할 수 없습니다");
      expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
        "finalize_withdrawal_ledger",
        {
          p_withdrawal_id: withdrawal,
          p_actor: owner,
          p_idempotency_key: "send-binding-key-01",
        },
      );
      // Only the existing pre-read ran. A rejected command cannot be confirmed
      // through a follow-up read or trigger another adapter-side financial RPC.
      expect(db.from).toHaveBeenCalledExactlyOnceWith("withdrawal_requests");
    },
  );

  it.each([
    "KRW_SEND_AMOUNT_MUST_EQUAL_REQUEST",
    "WITHDRAWAL_KRW_PAYOUT_AMOUNT_MISMATCH",
  ])(
    "completion API exposes %s as conflict without false completion",
    async (code) => {
      const db = client({ message: code }, []);
      const response = await POST(finalizeRequest());
      expect(response.status).toBe(409);
      const result = await response.json();
      expect(result).toMatchObject({ ok: false, code });
      expect(result.message).toContain("완료 처리할 수 없습니다");
      expect(result).not.toHaveProperty("ledgerTransactionId");
      expect(db.rpc).toHaveBeenCalledTimes(1);
      expect(db.from).not.toHaveBeenCalled();
    },
  );

  it("completion API confirms the requested completed ledger before success", async () => {
    const db = client(null, [
      {
        id: withdrawal,
        status: "COMPLETED",
        finalize_ledger_transaction_id: sendId,
      },
    ]);
    const response = await POST(finalizeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ledgerTransactionId: sendId,
      status: "COMPLETED",
    });
    expect(db.from).toHaveBeenCalledExactlyOnceWith("withdrawal_requests");
    expect(db.filters).toContainEqual(["id", withdrawal]);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    {
      id: otherWithdrawal,
      status: "COMPLETED",
      finalize_ledger_transaction_id: sendId,
    },
    {
      id: withdrawal,
      status: "EXTERNAL_SENT",
      finalize_ledger_transaction_id: sendId,
    },
    {
      id: withdrawal,
      status: "COMPLETED",
      finalize_ledger_transaction_id: otherWithdrawal,
    },
  ])(
    "completion API cannot confirm a missing or unrelated completed ledger: %j",
    async (receipt) => {
      client(null, receipt ? [receipt] : []);
      const response = await POST(finalizeRequest());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
    },
  );

  it("completion API keeps an unreadable completed result unconfirmed", async () => {
    client(
      null,
      [
        {
          id: withdrawal,
          status: "COMPLETED",
          finalize_ledger_transaction_id: sendId,
        },
      ],
      { message: "read failed" },
    );
    const response = await POST(finalizeRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
  });

  it("completion API cannot report a null RPC result as completed", async () => {
    const db = client(null, []);
    db.rpc.mockResolvedValue({ data: null, error: null });
    const response = await POST(finalizeRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "UNCONFIRMED" });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("completion action confirms the recorded finalized ledger", async () => {
    const db = client(null, [
      {
        id: withdrawal,
        status: "COMPLETED",
        finalize_ledger_transaction_id: sendId,
      },
    ]);
    expect(
      await finalizeWithdrawalLedgerAction(null, finalizeForm()),
    ).toMatchObject({ ok: true });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledTimes(2);
  });

  it("completion action keeps an unconfirmed ledger result unresolved", async () => {
    const db = client(null, []);
    expect(
      await finalizeWithdrawalLedgerAction(null, finalizeForm()),
    ).toMatchObject({ ok: false, code: "UNCONFIRMED" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.from).toHaveBeenCalledTimes(2);
  });

  it("completion API preserves a bound legacy terminal replay and its actual status", async () => {
    const db = client(null, [
      {
        id: withdrawal,
        status: "LEDGER_FINALIZED",
        finalize_ledger_transaction_id: sendId,
      },
    ]);
    const response = await POST(finalizeRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      ledgerTransactionId: sendId,
      status: "LEDGER_FINALIZED",
    });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "finalize_withdrawal_ledger",
      {
        p_withdrawal_id: withdrawal,
        p_actor: owner,
        p_idempotency_key: "send-binding-key-01",
      },
    );
  });

  it.each(["COMPLETED", "LEDGER_FINALIZED"])(
    "completion action preserves an already confirmed %s ledger without rerunning payment",
    async (status) => {
      const db = client(null, [], null, {
        id: withdrawal,
        status,
        finalize_ledger_transaction_id: sendId,
      });
      const result = await finalizeWithdrawalLedgerAction(null, finalizeForm());
      expect(result).toEqual({
        ok: true,
        message: "출금 원장은 이미 확정되어 있습니다.",
      });
      expect(db.rpc).not.toHaveBeenCalled();
      expect(db.from).toHaveBeenCalledExactlyOnceWith("withdrawal_requests");
    },
  );

  it("completion action accepts authoritative legacy replay without claiming promotion", async () => {
    const db = client(null, [
      {
        id: withdrawal,
        status: "LEDGER_FINALIZED",
        finalize_ledger_transaction_id: sendId,
      },
    ]);
    expect(await finalizeWithdrawalLedgerAction(null, finalizeForm())).toEqual({
      ok: true,
      message: "출금 원장은 이미 확정되어 있습니다.",
    });
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
      "finalize_withdrawal_ledger",
      {
        p_withdrawal_id: withdrawal,
        p_actor: owner,
        p_idempotency_key: "send-binding-key-01",
      },
    );
  });

  it.each([
    {
      id: withdrawal,
      status: "PENDING",
      finalize_ledger_transaction_id: sendId,
    },
    {
      id: otherWithdrawal,
      status: "COMPLETED",
      finalize_ledger_transaction_id: sendId,
    },
    { status: "COMPLETED", finalize_ledger_transaction_id: sendId },
    {
      id: withdrawal,
      status: "COMPLETED",
      finalize_ledger_transaction_id: "not-a-uuid",
    },
  ])(
    "completion action cannot confirm an invalid initial stored ledger: %j",
    async (initialReceipt) => {
      const db = client(null, [], null, initialReceipt);
      expect(
        await finalizeWithdrawalLedgerAction(null, finalizeForm()),
      ).toMatchObject({
        ok: false,
        code: "UNCONFIRMED",
      });
      expect(db.rpc).toHaveBeenCalledExactlyOnceWith(
        "finalize_withdrawal_ledger",
        {
          p_withdrawal_id: withdrawal,
          p_actor: owner,
          p_idempotency_key: "send-binding-key-01",
        },
      );
      expect(db.from).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    {
      id: withdrawal,
      status: "PENDING",
      finalize_ledger_transaction_id: sendId,
    },
    {
      id: otherWithdrawal,
      status: "COMPLETED",
      finalize_ledger_transaction_id: sendId,
    },
    { status: "COMPLETED", finalize_ledger_transaction_id: sendId },
    {
      id: withdrawal,
      status: "COMPLETED",
      finalize_ledger_transaction_id: "not-a-uuid",
    },
    {
      id: withdrawal,
      status: "COMPLETED",
      finalize_ledger_transaction_id: otherWithdrawal,
    },
  ])(
    "completion action rejects an unbound RPC/read ledger result: %j",
    async (receipt) => {
      const db = client(null, [receipt]);
      expect(
        await finalizeWithdrawalLedgerAction(null, finalizeForm()),
      ).toMatchObject({
        ok: false,
        code: "UNCONFIRMED",
      });
      expect(db.rpc).toHaveBeenCalledTimes(1);
      expect(db.from).toHaveBeenCalledTimes(2);
    },
  );

  it("completion action cannot confirm an unreadable finalized record", async () => {
    const db = client(
      null,
      [
        {
          id: withdrawal,
          status: "COMPLETED",
          finalize_ledger_transaction_id: sendId,
        },
      ],
      { message: "read failed" },
    );
    expect(
      await finalizeWithdrawalLedgerAction(null, finalizeForm()),
    ).toMatchObject({ ok: false, code: "UNCONFIRMED" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("completion action cannot confirm a null returned ledger id", async () => {
    const db = client(null, []);
    db.rpc.mockResolvedValue({ data: null, error: null });
    expect(
      await finalizeWithdrawalLedgerAction(null, finalizeForm()),
    ).toMatchObject({ ok: false, code: "UNCONFIRMED" });
    expect(db.from).toHaveBeenCalledExactlyOnceWith("withdrawal_requests");
  });

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
