import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/(control)/_lib/command-gate", () => ({
  prepareMoneyAttempt: vi.fn(() => ({
    ok: true,
    idempotencyKey: "bank_test_1234",
  })),
  requireHighImpactPrincipal: vi.fn(),
  mapRpcFailure: vi.fn(() => ({
    ok: false,
    code: "RPC_ERROR",
    message: "저장 실패",
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));
import { setKrwDepositSettingsAction } from "@/app/(control)/deposits/krw/instruction-actions";
import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import { createAdminServiceClient } from "@/lib/supabase/service";
const actor = "33333333-3333-4333-8333-333333333333";
const authorize = vi.mocked(requireHighImpactPrincipal),
  service = vi.mocked(createAdminServiceClient);
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    mode: "ACCOUNT",
    bank_name: "검증은행",
    account_number: "123-45678901",
    account_holder: "검증회사",
    contact_message: "1:1 상담 후 계좌 발급",
    version: "1",
    reason: "회원 원화 입금 계좌 안내 변경",
    confirmation: "SET_KRW_DEPOSIT_SETTINGS",
    ...overrides,
  }))
    data.set(key, value);
  return data;
}
function client(
  options: {
    error?: string;
    row?: Record<string, unknown>;
    lost?: boolean;
  } = {},
) {
  const rpc = options.lost
    ? vi.fn().mockRejectedValue(new Error("LOST"))
    : vi.fn().mockResolvedValue({
        data: 2,
        error: options.error ? { message: options.error } : null,
      });
  const query = {
    select: () => query,
    eq: () => query,
    single: () =>
      Promise.resolve({
        data: options.row ?? {
          mode: "ACCOUNT",
          bank_name: "검증은행",
          account_number: "123-45678901",
          account_holder: "검증회사",
          contact_message: "1:1 상담 후 계좌 발급",
          version: 2,
          updated_by: actor,
        },
        error: null,
      }),
  };
  service.mockReturnValue({ rpc, from: () => query } as never);
  return rpc;
}
beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({
    ok: true,
    requestId: "22222222-2222-4222-8222-222222222222",
    principal: {
      userId: actor,
      sessionId: "auth-session",
      adminSessionId: "admin-session",
      aal: "aal2",
      role: "ADMIN",
      amr: [],
      supabase: {} as never,
    },
  });
});
describe("원화 입금 안내 관리자 명령", () => {
  it("불완전한 계좌 또는 확인 누락은 추가 인증을 소비하지 않는다", async () => {
    for (const invalid of [
      { account_number: "123" },
      { account_holder: "" },
      { bank_name: "" },
      { confirmation: "" },
      { mode: "UNKNOWN" },
    ])
      expect((await setKrwDepositSettingsAction(null, form(invalid))).ok).toBe(
        false,
      );
    expect(authorize).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });
  it("권한 또는 추가 인증 거부 후 DB에 접근하지 않는다", async () => {
    authorize.mockResolvedValue({
      ok: false,
      result: {
        ok: false,
        code: "STEP_UP_REQUIRED",
        message: "추가 인증 필요",
      },
    });
    expect(await setKrwDepositSettingsAction(null, form())).toMatchObject({
      ok: false,
      code: "STEP_UP_REQUIRED",
    });
    expect(service).not.toHaveBeenCalled();
  });
  it("실제 읽기 결과가 저장 요청과 일치할 때만 성공한다", async () => {
    const rpc = client();
    expect((await setKrwDepositSettingsAction(null, form())).ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "set_krw_deposit_settings",
      expect.objectContaining({
        p_actor: actor,
        p_expected_version: 1,
        p_mode: "ACCOUNT",
        p_account_number: "123-45678901",
      }),
    );
    client({ row: { version: 2, updated_by: actor, mode: "CONTACT" } });
    expect(await setKrwDepositSettingsAction(null, form())).toMatchObject({
      ok: false,
      code: "UNCONFIRMED",
    });
  });
  it("상담 전환시 과거 계좌를 명령에 남기지 않는다", async () => {
    const rpc = client({
      row: {
        mode: "CONTACT",
        bank_name: "",
        account_number: "",
        account_holder: "",
        contact_message: "1:1 상담 후 계좌 발급",
        version: 2,
        updated_by: actor,
      },
    });
    expect(
      (await setKrwDepositSettingsAction(null, form({ mode: "CONTACT" }))).ok,
    ).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "set_krw_deposit_settings",
      expect.objectContaining({
        p_bank_name: "",
        p_account_number: "",
        p_account_holder: "",
      }),
    );
  });
  it("동시 수정이나 연결 손실을 성공으로 표시하지 않는다", async () => {
    client({ error: "KRW_INSTRUCTION_STALE" });
    expect(await setKrwDepositSettingsAction(null, form())).toMatchObject({
      ok: false,
      code: "STALE_VERSION",
    });
    client({ lost: true });
    expect(await setKrwDepositSettingsAction(null, form())).toMatchObject({
      ok: false,
      code: "UNCONFIRMED",
    });
  });
});
