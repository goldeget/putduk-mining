import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(control)/_lib/command-gate", () => ({
  prepareMoneyAttempt: vi.fn(() => ({
    ok: true,
    idempotencyKey: "send_test_operation_01",
  })),
  requireHighImpactPrincipal: vi.fn(),
  mapRpcFailure: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));

import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import { recordKrwExternalSendAction } from "@/app/(control)/withdrawals/krw-bank/actions";
import { recordUsdtExternalSendAction } from "@/app/(control)/withdrawals/usdt/actions";
import { createAdminServiceClient } from "@/lib/supabase/service";

const authorize = vi.mocked(requireHighImpactPrincipal);
const service = vi.mocked(createAdminServiceClient);
const owner = "11111111-1111-4111-8111-111111111111";
const withdrawal = "22222222-2222-4222-8222-222222222222";

function form(method: "KRW" | "USDT", sentAt: string) {
  const data = new FormData();
  data.set("withdrawalId", withdrawal);
  data.set("sentAt", sentAt);
  if (method === "KRW") {
    data.set("bankReference", "BANK-REF-01");
    data.set("actualKrw", "5000");
    data.set("confirmation", "RECORD_KRW_SEND");
  } else {
    data.set("network", "TRON");
    data.set("txHash", "transfer-hash-0123456789");
    data.set("actualUsdt", "5.5");
    data.set("confirmation", "RECORD_USDT_SEND");
  }
  return data;
}

describe("외부 송금 시각", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({
      ok: true,
      requestId: withdrawal,
      principal: {
        userId: owner,
        role: "ADMIN",
        sessionId: "session",
        adminSessionId: "admin-session",
        aal: "aal2",
        amr: [],
        supabase: {} as never,
      },
    });
  });

  for (const [method, action, command] of [
    ["KRW", recordKrwExternalSendAction, "record_krw_external_send"],
    ["USDT", recordUsdtExternalSendAction, "record_usdt_external_send"],
  ] as const) {
    it(`${method} 송금 시각을 한국 시간에서 UTC로 변환해 기존 명령에 전달한다`, async () => {
      let reads = 0;
      const rpc = vi.fn().mockResolvedValue({ error: null });
      service.mockReturnValue({
        rpc,
        from() {
          const query = {
            select: () => query,
            eq: () => query,
            limit: () =>
              Promise.resolve({
                data: ++reads === 1 ? [] : [{ id: withdrawal }],
                error: null,
              }),
          };
          return query;
        },
      } as never);
      expect((await action(null, form(method, "2026-10-03T00:15"))).ok).toBe(
        true,
      );
      expect(rpc).toHaveBeenCalledWith(
        command,
        expect.objectContaining({
          p_sent_at: "2026-10-02T15:15:00.000Z",
          p_idempotency_key: "send_test_operation_01",
        }),
      );
    });

    it(`${method}의 없는 날짜는 작업 확인을 소비하기 전에 거절한다`, async () => {
      expect(
        await action(null, form(method, "2026-02-30T12:00")),
      ).toMatchObject({
        ok: false,
        code: "INVALID_SENT_AT",
      });
      expect(authorize).not.toHaveBeenCalled();
      expect(service).not.toHaveBeenCalled();
    });
  }
});
