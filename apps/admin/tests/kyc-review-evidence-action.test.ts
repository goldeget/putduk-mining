import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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

import { reviewKycCaseAction } from "@/app/(control)/kyc/actions";
import { requireHighImpactPrincipal } from "@/app/(control)/_lib/command-gate";
import { createAdminServiceClient } from "@/lib/supabase/service";

const authorize = vi.mocked(requireHighImpactPrincipal);
const service = vi.mocked(createAdminServiceClient);

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function form() {
  const data = new FormData();
  data.set("caseId", CASE_ID);
  data.set("decision", "APPROVED");
  data.set("reason", "서류를 확인한 뒤 승인합니다.");
  data.set("confirmation", "REVIEW_KYC");
  data.set("stepUpToken", "step-up-token-value-32chars");
  return data;
}

function installClient(submissionError: { message: string } | null) {
  const calls: string[] = [];
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    limit() {
      calls.push("kyc_submissions");
      return Promise.resolve({
        data: submissionError ? null : [],
        error: submissionError,
      });
    },
  };
  service.mockReturnValue({
    from(table: string) {
      if (table !== "kyc_submissions") {
        throw new Error(`UNEXPECTED_TABLE:${table}`);
      }
      return query;
    },
    rpc(name: string) {
      calls.push(name);
      return Promise.resolve({ error: null });
    },
  } as never);
  return calls;
}

describe("KYC 심사 서버 증거 조회", () => {
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

  it("제출 조회가 실패하면 심사 RPC를 호출하지 않는다", async () => {
    const calls = installClient({ message: "timeout" });
    const result = await reviewKycCaseAction(null, form());
    expect(result).toMatchObject({
      ok: false,
      code: "EVIDENCE_UNAVAILABLE",
    });
    expect(calls).toEqual(["kyc_submissions"]);
  });

  it("제출이 실제로 0건이면 기존 심사 RPC를 호출한다", async () => {
    const calls = installClient(null);
    const result = await reviewKycCaseAction(null, form());
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["kyc_submissions", "review_kyc_case"]);
  });

  it("권한 거절 뒤에는 제출 조회와 심사 RPC를 하지 않는다", async () => {
    authorize.mockResolvedValue({
      ok: false,
      result: {
        ok: false,
        code: "STEP_UP_REQUIRED",
        message: "고위험 작업입니다. 인증 앱으로 다시 확인한 뒤 시도해 주세요.",
      },
    });
    const calls = installClient(null);
    const result = await reviewKycCaseAction(null, form());
    expect(result).toMatchObject({ ok: false, code: "STEP_UP_REQUIRED" });
    expect(calls).toEqual([]);
  });
});
