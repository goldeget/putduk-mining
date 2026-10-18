import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/(control)/_lib/command-gate", () => ({
  prepareMoneyAttempt: vi.fn(() => ({
    ok: true,
    idempotencyKey: "usdt_addr_test_operation_01",
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

import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import { setUsdtDepositInstructionAction } from "@/app/(control)/deposits/usdt/instruction-actions";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import {
  isValidUsdtAddress,
  usdtInstructionInput,
} from "@/lib/deposits/usdt-instruction-input";
import { createAdminServiceClient } from "@/lib/supabase/service";

const TRON = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const OTHER_TRON = "TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy";
const instructionId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const authorize = vi.mocked(requireHighImpactPrincipal);
const service = vi.mocked(createAdminServiceClient);

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const values: Record<string, string> = {
    network: "TRC20",
    address: TRON,
    addressRepeat: TRON,
    reason: "수신 지갑을 새 주소로 바꿉니다.",
    confirmation: "SET_USDT_DEPOSIT_ADDRESS",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

/** reads: 순서대로 돌려줄 활성 행(현재, 저장 뒤). */
function client(
  options: {
    reads?: unknown[];
    rpcError?: string;
    readError?: boolean;
    transportLost?: boolean;
  } = {},
) {
  const reads = [...(options.reads ?? [])];
  const rpc = vi.fn();
  if (options.transportLost) rpc.mockRejectedValue(new Error("LOST"));
  else if (options.rpcError)
    rpc.mockResolvedValue({ data: null, error: { message: options.rpcError } });
  else rpc.mockResolvedValue({ data: instructionId, error: null });
  service.mockReturnValue({
    rpc,
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: () =>
          Promise.resolve({
            data: reads.shift() ?? null,
            error: options.readError ? { message: "READ_FAILED" } : null,
          }),
      };
      return query;
    },
  } as never);
  return { rpc };
}

function row(address: string, overrides: Record<string, unknown> = {}) {
  return {
    id: instructionId,
    network: "TRC20",
    deposit_address: address,
    is_active: true,
    set_by: actorId,
    request_id: requestId,
    ...overrides,
  };
}

describe("USDT 입금 주소 설정", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({
      ok: true,
      requestId,
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

  it("주소 형식은 네트워크별로 확인한다", () => {
    expect(isValidUsdtAddress("TRC20", TRON)).toBe(true);
    expect(isValidUsdtAddress("TRC20", "0x" + "a".repeat(40))).toBe(false);
    expect(isValidUsdtAddress("ERC20", "0x" + "a".repeat(40))).toBe(true);
    expect(isValidUsdtAddress("BEP20", "0x" + "a".repeat(39))).toBe(false);
    expect(
      usdtInstructionInput.safeParse({
        network: "TRC20",
        address: TRON,
        addressRepeat: OTHER_TRON,
        reason: "수신 지갑을 새 주소로 바꿉니다.",
        confirmation: "SET_USDT_DEPOSIT_ADDRESS",
      }).success,
    ).toBe(false);
  });

  it.each([
    { addressRepeat: OTHER_TRON },
    { address: "TRC20-not-an-address", addressRepeat: "TRC20-not-an-address" },
    { reason: "짧음" },
    { confirmation: "NO" },
    { network: "SOL" },
  ])(
    "잘못된 입력은 작업 확인을 소비하거나 명령을 호출하기 전에 거절한다: %j",
    async (override) => {
      expect(
        await setUsdtDepositInstructionAction(null, form(override)),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(authorize).not.toHaveBeenCalled();
      expect(service).not.toHaveBeenCalled();
    },
  );

  it("권한이 없으면 데이터베이스를 호출하지 않는다", async () => {
    authorize.mockResolvedValue({
      ok: false,
      result: { ok: false, code: "ROLE_FORBIDDEN", message: "권한 없음" },
    });
    expect(await setUsdtDepositInstructionAction(null, form())).toMatchObject({
      ok: false,
      code: "ROLE_FORBIDDEN",
    });
    expect(service).not.toHaveBeenCalled();
  });

  it("전용 step-up 묶음과 기본 고위험 역할로 권한을 확인한다", async () => {
    client({ reads: [null, row(TRON)] });
    await setUsdtDepositInstructionAction(null, form());
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize.mock.calls[0]?.[0]).toBe(
      ADMIN_COMMAND_FAMILIES.DEPOSIT_INSTRUCTION,
    );
    // 역할 목록을 넘기지 않으면 SUPER_ADMIN/ADMIN만 허용된다.
    expect(authorize.mock.calls[0]?.[2]).toBeUndefined();
  });

  it("저장한 활성 행을 다시 읽어 확인한 뒤에만 성공을 표시한다", async () => {
    const db = client({ reads: [row(OTHER_TRON), row(TRON)] });
    expect(await setUsdtDepositInstructionAction(null, form())).toMatchObject({
      ok: true,
    });
    expect(db.rpc).toHaveBeenCalledWith("set_usdt_deposit_instructions", {
      p_address: TRON,
      p_network: "TRC20",
      p_actor: actorId,
      p_reason: "수신 지갑을 새 주소로 바꿉니다.",
      p_request_id: requestId,
    });
  });

  it("같은 주소를 다시 보내면 새 버전을 만들지 않는다", async () => {
    const db = client({ reads: [row(TRON)] });
    expect(await setUsdtDepositInstructionAction(null, form())).toMatchObject({
      ok: true,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["다른 주소", row(OTHER_TRON)],
    ["다른 요청", row(TRON, { request_id: actorId })],
    ["다른 행", row(TRON, { id: actorId })],
    ["다른 운영자", row(TRON, { set_by: requestId })],
    ["행 없음", null],
  ])("저장 뒤 확인이 맞지 않으면 결과 미확인으로 남긴다: %s", async (_n, after) => {
    client({ reads: [null, after] });
    expect(await setUsdtDepositInstructionAction(null, form())).toMatchObject({
      ok: false,
      code: "UNCONFIRMED",
    });
  });

  it("안전 모드로 입금이 멈춰 있으면 이유를 알려 준다", async () => {
    client({ reads: [null], rpcError: "SAFE_MODE_ACTIVE" });
    expect(await setUsdtDepositInstructionAction(null, form())).toMatchObject({
      ok: false,
      code: "SAFE_MODE_ACTIVE",
    });
  });

  it("명령 오류와 끊긴 응답을 성공으로 바꾸지 않는다", async () => {
    client({ reads: [null], rpcError: "ADMIN_ROLE_REQUIRED" });
    expect(await setUsdtDepositInstructionAction(null, form())).toMatchObject({
      ok: false,
      code: "COMMAND_FAILED",
    });
    client({ reads: [null], transportLost: true });
    expect(await setUsdtDepositInstructionAction(null, form())).toMatchObject({
      ok: false,
      code: "UNCONFIRMED",
    });
    client({ readError: true });
    expect(await setUsdtDepositInstructionAction(null, form())).toMatchObject({
      ok: false,
      code: "UNCONFIRMED",
    });
  });
});
