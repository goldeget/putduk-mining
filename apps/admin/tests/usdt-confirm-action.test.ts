import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(control)/_lib/command-gate", () => ({
  prepareMoneyAttempt: vi.fn(() => ({
    ok: true,
    idempotencyKey: "usdt_test_operation_01",
  })),
  requireHighImpactPrincipal: vi.fn(),
  mapRpcFailure: vi.fn((_message: string, fallback: string) => ({
    ok: false,
    code: "COMMAND_FAILED",
    message: fallback,
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));

import { confirmUsdtManualDepositAction } from "@/app/(control)/deposits/usdt/actions";
import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import { createAdminServiceClient } from "@/lib/supabase/service";

const depositId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const transactionId = "33333333-3333-4333-8333-333333333333";
const walletId = "44444444-4444-4444-8444-444444444444";
const actorId = "55555555-5555-4555-8555-555555555555";
const authorize = vi.mocked(requireHighImpactPrincipal);
const service = vi.mocked(createAdminServiceClient);

function form(amount = "50000") {
  const data = new FormData();
  data.set("depositId", depositId);
  data.set("creditedKrw", amount);
  data.set("reason", "외부 이체를 확인한 뒤 원화로 반영합니다.");
  data.set("confirmation", "CONFIRM_USDT_DEPOSIT");
  return data;
}

function client(
  options: {
    amount?: string;
    walletAmount?: string;
    journalReference?: string;
    missingLink?: boolean;
    readError?: boolean;
    rpcError?: boolean;
    transportLost?: boolean;
  } = {},
) {
  const amount = options.amount ?? "50000";
  const rows: Record<string, unknown> = {
    usdt_manual_deposits: {
      id: depositId,
      user_id: memberId,
      status: "CONFIRMED",
      credited_krw: amount,
      ledger_transaction_id: options.missingLink ? null : transactionId,
      wallet_ledger_id: walletId,
    },
    ledger_transactions: {
      id: transactionId,
      category: "DEPOSIT",
      currency: "KRW",
      reference_type: "usdt_manual_deposit",
      reference_id: options.journalReference ?? depositId,
      member_user_id: memberId,
    },
    wallet_ledger: {
      id: walletId,
      user_id: memberId,
      direction: "CREDIT",
      entry_type: "DEPOSIT",
      amount_atomic: options.walletAmount ?? amount,
      reference_type: "usdt_manual_deposit",
      reference_id: depositId,
    },
  };
  const rpc = vi.fn().mockResolvedValue({
    data: transactionId,
    error: options.rpcError ? { message: "REJECTED" } : null,
  });
  if (options.transportLost)
    rpc.mockRejectedValue(new Error("CONNECTION_LOST"));
  const calls: string[] = [];
  service.mockReturnValue({
    rpc,
    from(table: string) {
      calls.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: rows[table] ?? null,
            error: options.readError ? { message: "READ_FAILED" } : null,
          }),
      };
      return query;
    },
  } as never);
  return { rpc, calls };
}

describe("USDT 입금 승인 결과 확인", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({
      ok: true,
      requestId: transactionId,
      principal: {
        userId: actorId,
        role: "ADMIN",
        sessionId: "session",
        adminSessionId: "admin-session",
        aal: "aal2",
        amr: [],
        supabase: {} as never,
      },
    });
  });

  it("잘못된 금액은 작업 확인을 소비하거나 명령을 호출하기 전에 거절한다", async () => {
    expect(
      await confirmUsdtManualDepositAction(null, form("1.5")),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });

  it("권한이 없으면 데이터베이스를 호출하지 않는다", async () => {
    authorize.mockResolvedValue({
      ok: false,
      result: {
        ok: false,
        code: "ROLE_FORBIDDEN",
        message: "권한이 없습니다.",
      },
    });
    expect(await confirmUsdtManualDepositAction(null, form())).toMatchObject({
      ok: false,
      code: "ROLE_FORBIDDEN",
    });
    expect(service).not.toHaveBeenCalled();
  });

  it("같은 금액의 실제 연결된 기록을 확인한 뒤에만 성공을 표시한다", async () => {
    const db = client();
    expect(await confirmUsdtManualDepositAction(null, form())).toEqual({
      ok: true,
      message: "입금을 확인했습니다. 원화 50,000원이 반영됐습니다.",
    });
    expect(db.rpc).toHaveBeenCalledWith(
      "confirm_usdt_manual_deposit",
      expect.objectContaining({
        p_deposit_id: depositId,
        p_credited_krw: "50000",
        p_actor: actorId,
        p_idempotency_key: "usdt_test_operation_01",
      }),
    );
    expect(db.calls).toEqual([
      "usdt_manual_deposits",
      "ledger_transactions",
      "wallet_ledger",
    ]);
  });

  it("이미 다른 금액으로 승인된 입금을 이번 금액의 성공으로 표시하지 않는다", async () => {
    client({ amount: "40000" });
    expect(await confirmUsdtManualDepositAction(null, form())).toMatchObject({
      ok: false,
      code: "AMOUNT_MISMATCH",
    });
  });

  it.each([
    { missingLink: true },
    { journalReference: memberId },
    { walletAmount: "40000" },
    { readError: true },
  ])(
    "누락·다른 입금·금액 불일치·조회 실패는 결과 미확인으로 남긴다: %j",
    async (options) => {
      client(options);
      expect(await confirmUsdtManualDepositAction(null, form())).toMatchObject({
        ok: false,
        code: "UNCONFIRMED",
      });
    },
  );

  it("명령 오류를 상태 조회로 성공으로 바꾸지 않는다", async () => {
    const db = client({ rpcError: true });
    expect(await confirmUsdtManualDepositAction(null, form())).toMatchObject({
      ok: false,
      code: "COMMAND_FAILED",
    });
    expect(db.calls).toEqual([]);
  });

  it("명령 응답이 끊기면 실패를 단정하지 않고 같은 요청으로 다시 확인하도록 한다", async () => {
    const db = client({ transportLost: true });
    expect(await confirmUsdtManualDepositAction(null, form())).toMatchObject({
      ok: false,
      code: "UNCONFIRMED",
    });
    expect(db.calls).toEqual([]);
  });
});
