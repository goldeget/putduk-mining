import { describe, expect, it } from "vitest";

import { buildReviewKycRpcArgs } from "../../apps/admin/app/(control)/kyc/review-rpc";
import {
  kycRiskLabel,
  kycStatusLabel,
} from "../../apps/admin/app/(control)/_lib/format";

describe("admin KYC review contract", () => {
  it("maps UI decision fields onto review_kyc_case RPC names", () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    const args = buildReviewKycRpcArgs({
      caseId: "22222222-2222-4222-8222-222222222222",
      decision: "REJECTED",
      reason: "서류가 부족해 반려합니다.",
      actorUserId: "33333333-3333-4333-8333-333333333333",
      requestId,
    });

    expect(args).toEqual({
      p_case_id: "22222222-2222-4222-8222-222222222222",
      p_actor: "33333333-3333-4333-8333-333333333333",
      p_to_status: "REJECTED",
      p_reason: "서류가 부족해 반려합니다.",
      p_request_id: requestId,
    });
    expect(args).not.toHaveProperty("p_decision");
    expect(args).not.toHaveProperty("p_idempotency_key");
    expect(args).not.toHaveProperty("p_view_submission_id");
  });

  it("never requests document view audit from the approved review surface", () => {
    const args = buildReviewKycRpcArgs({
      caseId: "22222222-2222-4222-8222-222222222222",
      decision: "APPROVED",
      reason: "상태 요약만으로 승인합니다.",
      actorUserId: "33333333-3333-4333-8333-333333333333",
      requestId: "44444444-4444-4444-8444-444444444444",
    });
    expect(args).not.toHaveProperty("p_view_submission_id");
  });

  it("keeps Korean status and risk labels for existing enum values only", () => {
    expect(kycStatusLabel("REQUIRES_RESUBMISSION")).toBe("재제출 필요");
    expect(kycRiskLabel("UNASSESSED")).toBe("미평가");
    expect(kycRiskLabel("HIGH")).toBe("높음");
    expect(kycRiskLabel("CUSTOM_POLICY")).toBe("CUSTOM_POLICY");
  });
});
