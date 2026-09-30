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
const RECOVERY_COPY =
  "예외 상태는 반영됐을 수 있지만 감사 기록을 남기지 못했습니다. 목록을 새로고침해 현재 상태를 확인한 뒤 다시 처리해 주세요. 원장이나 잔액은 자동으로 고치지 않았습니다.";

function form() {
  const data = new FormData();
  data.set("mismatchId", MISMATCH_ID);
  data.set("reason", "차이를 확인합니다. 자동 수리는 하지 않습니다.");
  data.set("result", "ACCEPTED");
  data.set("confirmation", "ACK_EXCEPTION");
  data.set("stepUpToken", "step-up-token-value-32chars");
  return data;
}

function mismatchChain(result: {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}) {
  const chain = {
    update: () => chain,
    eq: () => chain,
    in: () => chain,
    select: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  return chain;
}

function installClient(options: {
  updateResult: {
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  };
  auditError: { message: string } | null;
}) {
  const tables: string[] = [];
  const audits: Array<Record<string, unknown>> = [];
  service.mockReturnValue({
    from(table: string) {
      tables.push(table);
      if (table === "reconciliation_mismatches") {
        return mismatchChain(options.updateResult);
      }
      if (table === "audit_logs") {
        return {
          insert(row: Record<string, unknown>) {
            audits.push(row);
            return Promise.resolve({ error: options.auditError });
          },
        };
      }
      throw new Error(`UNEXPECTED_TABLE:${table}`);
    },
  } as never);
  return { tables, audits };
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

  it("고위험 주체와 RECONCILIATION_ACK 확인 뒤에만 상태와 같은 요청 감사를 남긴다", async () => {
    const db = installClient({
      updateResult: {
        data: {
          id: MISMATCH_ID,
          status: "ACCEPTED",
          expected_value: { amount_atomic: "5000" },
          actual_value: { amount_atomic: "0" },
        },
        error: null,
      },
      auditError: null,
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
    expect(db.tables).toEqual(["reconciliation_mismatches", "audit_logs"]);
    expect(db.audits[0]).toMatchObject({
      action: "RECONCILIATION_EXCEPTION_ACK",
      actor_user_id: USER_ID,
      actor_role: "ADMIN",
      request_id: REQUEST_ID,
      target_id: MISMATCH_ID,
      metadata: {
        result: "ACCEPTED",
        auto_repair: false,
        expected_value: { amount_atomic: "5000" },
        actual_value: { amount_atomic: "0" },
      },
    });
  });

  it("감사 기록 삽입이 실패하면 성공으로 보고하지 않는다", async () => {
    const db = installClient({
      updateResult: {
        data: {
          id: MISMATCH_ID,
          status: "ACCEPTED",
          expected_value: { ok: true },
          actual_value: { ok: false },
        },
        error: null,
      },
      auditError: { message: "insert failed" },
    });

    const result = await acknowledgeReconciliationExceptionAction(null, form());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("AUDIT_WRITE_FAILED");
      expect(result.message).toBe(RECOVERY_COPY);
      expect(result.message).not.toMatch(/postgres|service_role|audit_logs/i);
    }
    expect(db.tables).not.toContain("ledger_transactions");
    expect(db.tables).not.toContain("ledger_entries");
    expect(db.tables).not.toContain("wallet_ledger");
    expect(db.tables).not.toContain("wallet_accounts");
  });

  it("이미 닫힌 예외는 실패하고 원장을 고치지 않는다", async () => {
    const db = installClient({
      updateResult: { data: null, error: null },
      auditError: null,
    });

    const result = await acknowledgeReconciliationExceptionAction(null, form());

    expect(result).toMatchObject({
      ok: false,
      code: "STALE_OR_CLOSED",
    });
    expect(db.audits[0]).toMatchObject({
      action: "RECONCILIATION_EXCEPTION_ACK_ATTEMPT",
      metadata: { outcome: "STALE_OR_CLOSED", auto_repair: false },
    });
    expect(db.tables).toEqual(["reconciliation_mismatches", "audit_logs"]);
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
