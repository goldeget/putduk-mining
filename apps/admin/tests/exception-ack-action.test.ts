import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/(control)/_lib/command-gate", () => ({
  requireHighImpactPrincipal: vi.fn(),
  mapRpcFailure: vi.fn((message: string | undefined, fallback: string) => ({
    ok: false as const,
    code: "COMMAND_FAILED",
    message: fallback || message || "실패",
  })),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: vi.fn(),
}));

import { acknowledgeReconciliationExceptionAction } from "@/app/(control)/exceptions/actions";
import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { createAdminServiceClient } from "@/lib/supabase/service";

const authorize = vi.mocked(requireHighImpactPrincipal);
const service = vi.mocked(createAdminServiceClient);

const MISMATCH_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const AUDIT_ROLLBACK_COPY =
  "예외 확인을 저장하지 못했습니다. 상태는 바뀌지 않았습니다. 자동으로 숫자를 고치지 않았습니다.";

function form(result = "ACCEPTED") {
  const data = new FormData();
  data.set("mismatchId", MISMATCH_ID);
  data.set("reason", "차이를 확인합니다. 자동 수리는 하지 않습니다.");
  data.set("result", result);
  data.set("confirmation", "ACK_EXCEPTION");
  data.set("stepUpToken", "step-up-token-value-32chars");
  return data;
}

function installClient(options: {
  rpcResult: { data: unknown; error: { message: string; code?: string } | null };
  auditError?: { message: string } | null;
}) {
  const calls: string[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const rpcArgs: unknown[] = [];
  service.mockReturnValue({
    rpc(name: string, args: unknown) {
      calls.push(name);
      rpcArgs.push(args);
      return Promise.resolve(options.rpcResult);
    },
    from(table: string) {
      calls.push(table);
      if (table !== "audit_logs") {
        throw new Error(`UNEXPECTED_TABLE:${table}`);
      }
      return {
        insert(row: Record<string, unknown>) {
          audits.push(row);
          return Promise.resolve({ error: options.auditError ?? null });
        },
      };
    },
  } as never);
  return { calls, audits, rpcArgs };
}

describe("대사 예외 확인 감사 기록", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({
      ok: true,
      requestId: REQUEST_ID,
      principal: {
        userId: USER_ID,
        role: "ADMIN",
        sessionId: "session",
        adminSessionId: "admin-session",
        aal: "aal2",
        amr: [],
        supabase: {} as never,
      },
    });
  });

  it("고위험 주체와 RECONCILIATION_ACK 확인 뒤에만 같은 요청으로 명령을 호출한다", async () => {
    const db = installClient({
      rpcResult: {
        data: {
          ok: true,
          code: "ACKNOWLEDGED",
          status: "ACCEPTED",
          mismatch_id: MISMATCH_ID,
          request_id: REQUEST_ID,
        },
        error: null,
      },
    });

    const result = await acknowledgeReconciliationExceptionAction(null, form());

    expect(authorize).toHaveBeenCalledWith(
      ADMIN_COMMAND_FAMILIES.RECONCILIATION_ACK,
      expect.any(FormData),
    );
    expect(result).toEqual({
      ok: true,
      message: "예외를 확인했습니다. 자동으로 숫자를 고치지 않았습니다.",
    });
    expect(db.calls).toEqual(["acknowledge_reconciliation_mismatch"]);
    expect(db.rpcArgs[0]).toEqual({
      p_mismatch_id: MISMATCH_ID,
      p_actor: USER_ID,
      p_result: "ACCEPTED",
      p_reason: "차이를 확인합니다. 자동 수리는 하지 않습니다.",
      p_request_id: REQUEST_ID,
    });
    expect(db.calls).not.toContain("reconciliation_mismatches");
    expect(db.calls).not.toContain("ledger_transactions");
    expect(db.calls).not.toContain("ledger_entries");
    expect(db.calls).not.toContain("wallet_ledger");
    expect(db.calls).not.toContain("wallet_accounts");
  });

  it("조사 중 성공은 증거를 유지하는 안내만 보여 준다", async () => {
    installClient({
      rpcResult: {
        data: { ok: true, code: "ACKNOWLEDGED", status: "INVESTIGATING" },
        error: null,
      },
    });

    const result = await acknowledgeReconciliationExceptionAction(
      null,
      form("INVESTIGATING"),
    );

    expect(result).toEqual({
      ok: true,
      message:
        "조사 중으로 남겼습니다. 차이 증거는 그대로 보이며 숫자는 고치지 않았습니다.",
    });
  });

  it("감사 기록 삽입이 실패하면 성공으로 보고하지 않고 상태 변경도 없다고 안내한다", async () => {
    const db = installClient({
      rpcResult: {
        data: null,
        error: { message: "AUDIT_WRITE_FAILED", code: "P0001" },
      },
    });

    const result = await acknowledgeReconciliationExceptionAction(null, form());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUDIT_WRITE_FAILED");
      expect(result.message).toBe(AUDIT_ROLLBACK_COPY);
      expect(result.message).not.toMatch(/postgres|service_role|audit_logs/i);
    }
    expect(db.calls).toEqual(["acknowledge_reconciliation_mismatch"]);
    expect(db.calls).not.toContain("ledger_transactions");
    expect(db.calls).not.toContain("ledger_entries");
    expect(db.calls).not.toContain("wallet_ledger");
    expect(db.calls).not.toContain("wallet_accounts");
  });

  it("이미 닫힌 예외는 실패하고 원장을 고치지 않는다", async () => {
    const db = installClient({
      rpcResult: {
        data: null,
        error: { message: "STALE_OR_CLOSED" },
      },
    });

    const result = await acknowledgeReconciliationExceptionAction(null, form());

    expect(result).toMatchObject({
      ok: false,
      code: "STALE_OR_CLOSED",
    });
    expect(db.audits[0]).toMatchObject({
      action: "RECONCILIATION_EXCEPTION_ACK_ATTEMPT",
      request_id: REQUEST_ID,
      metadata: { outcome: "STALE_OR_CLOSED", auto_repair: false },
    });
    expect(db.calls).toEqual([
      "acknowledge_reconciliation_mismatch",
      "audit_logs",
    ]);
    expect(db.calls).not.toContain("ledger_transactions");
    expect(db.calls).not.toContain("wallet_accounts");
  });

  it("이미 조사 중이면 사유를 덮어쓰지 않는 안내를 보여 준다", async () => {
    const db = installClient({
      rpcResult: {
        data: null,
        error: { message: "ALREADY_INVESTIGATING" },
      },
    });

    const result = await acknowledgeReconciliationExceptionAction(
      null,
      form("INVESTIGATING"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ALREADY_INVESTIGATING");
      expect(result.message).toBe(
        "이미 조사 중인 예외입니다. 조사 완료나 차이 인정만 저장할 수 있어요.",
      );
      expect(result.message).not.toMatch(/ALREADY_INVESTIGATING/);
    }
    expect(db.audits[0]).toMatchObject({
      action: "RECONCILIATION_EXCEPTION_ACK_ATTEMPT",
      metadata: { outcome: "ALREADY_INVESTIGATING", auto_repair: false },
    });
  });

  it("권한이 없으면 예외 행을 바꾸지 않는다", async () => {
    authorize.mockResolvedValue({
      ok: false,
      result: {
        ok: false,
        code: "STEP_UP_REQUIRED",
        message: "고위험 작업입니다. 인증 앱으로 다시 확인한 뒤 시도해 주세요.",
      },
    });

    const result = await acknowledgeReconciliationExceptionAction(null, form());

    expect(result.ok).toBe(false);
    expect(service).not.toHaveBeenCalled();
  });
});
