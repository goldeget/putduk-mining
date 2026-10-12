import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const gate = vi.hoisted(() => vi.fn());
const service = vi.hoisted(() => vi.fn());
vi.mock("@/app/(control)/_lib/command-gate", () => ({
  requireHighImpactPrincipal: gate,
  mapRpcFailure: (message: string) => ({
    ok: false,
    code: "COMMAND_FAILED",
    message,
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: service,
}));
import {
  reviewKycCaseAction,
  reviewKycCaseFromFields,
} from "@/app/(control)/kyc/actions";
import { buildReviewKycRpcArgs } from "@/app/(control)/kyc/review-rpc";
const caseId = "7caa0000-0000-4000-8000-000000000001",
  submission = "7caa0000-0000-4000-8000-000000000002",
  requestId = "7caa0000-0000-4000-8000-000000000003";
const rpc = vi.fn();
const fields = {
  caseId,
  decision: "APPROVED",
  reason: "서류 내용을 확인하고 심사합니다.",
  confirmation: "REVIEW_KYC",
  stepUpToken: "ephemeral-test-step-up-token",
} as const;
beforeEach(() => {
  vi.resetAllMocks();
  gate.mockResolvedValue({
    ok: true,
    requestId,
    principal: { userId: caseId },
  });
  const query = {
    eq: vi.fn().mockReturnThis(),
    limit: vi
      .fn()
      .mockResolvedValue({ data: [{ case_id: caseId }], error: null }),
  };
  service.mockReturnValue({ from: () => ({ select: () => query }), rpc });
  rpc.mockResolvedValue({ error: null });
});
describe("explicit content acknowledgment to review linkage", () => {
  it("preserves omitted-view policy and ignores a legacy metadata field", async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("viewSubmissionId", submission);
    expect((await reviewKycCaseAction(null, form)).ok).toBe(true);
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty("p_view_submission_id");
  });
  it("forwards only the explicit acknowledged ID through fields/action/RPC args", async () => {
    expect(
      (
        await reviewKycCaseFromFields({
          ...fields,
          acknowledgedSubmissionId: submission,
        })
      ).ok,
    ).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "review_kyc_case",
      expect.objectContaining({
        p_view_submission_id: submission,
        p_case_id: caseId,
        p_request_id: requestId,
      }),
    );
  });
  it("a forged or stale acknowledged ID rejected by SQL cannot become review success", async () => {
    rpc.mockResolvedValue({ error: { message: "KYC_CONTENT_ACK_REQUIRED" } });
    expect(
      await reviewKycCaseFromFields({
        ...fields,
        acknowledgedSubmissionId: submission,
      }),
    ).toMatchObject({ ok: false });
  });
  it("malformed explicit ACK identity does not reach the review RPC", async () => {
    expect(
      (
        await reviewKycCaseFromFields({
          ...fields,
          acknowledgedSubmissionId: "metadata-id",
        })
      ).ok,
    ).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("metadata input never becomes an implicit view argument", () => {
    const args = buildReviewKycRpcArgs({
      ...fields,
      actorUserId: caseId,
      requestId,
      ...{ viewSubmissionId: submission },
    });
    expect(args).not.toHaveProperty("p_view_submission_id");
  });
});
