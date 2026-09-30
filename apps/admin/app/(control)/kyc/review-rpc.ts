import { randomUUID } from "node:crypto";

/** review_kyc_case RPC 인자. 문서 원문 조회 키는 넣지 않는다. */
export function buildReviewKycRpcArgs(input: {
  caseId: string;
  decision:
    "APPROVED" | "REJECTED" | "ON_HOLD" | "REQUIRES_RESUBMISSION" | "IN_REVIEW";
  reason: string;
  actorUserId: string;
  requestId: string;
}) {
  // p_view_submission_id 를 null 로내면 PostgREST가 기본값을 깨뜨릴 수 있어 생략한다.
  return {
    p_case_id: input.caseId,
    p_actor: input.actorUserId,
    p_to_status: input.decision,
    p_reason: input.reason,
    p_request_id: input.requestId,
  };
}

export function newKycRequestId(): string {
  return randomUUID();
}
