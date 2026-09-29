import { randomUUID } from "node:crypto";

/** review_kyc_case RPC 인자. 문서 원문 조회는 UI에서 허용하지 않는다. */
export function buildReviewKycRpcArgs(input: {
  caseId: string;
  decision:
    | "APPROVED"
    | "REJECTED"
    | "ON_HOLD"
    | "REQUIRES_RESUBMISSION"
    | "IN_REVIEW";
  reason: string;
  actorUserId: string;
  requestId: string;
}) {
  return {
    p_case_id: input.caseId,
    p_actor: input.actorUserId,
    p_to_status: input.decision,
    p_reason: input.reason,
    p_request_id: input.requestId,
    // 승인된 표면은 상태·사유만. 원문 조회·감사 삽입은 호출하지 않는다.
    p_view_submission_id: null as string | null,
  };
}

export function newKycRequestId(): string {
  return randomUUID();
}
