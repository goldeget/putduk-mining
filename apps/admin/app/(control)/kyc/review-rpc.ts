import { randomUUID } from "node:crypto";

/** Metadata is never a view. Only the explicit ACK hint opts into the SQL attestation guard. */
export function buildReviewKycRpcArgs(input: {
  caseId: string;
  decision:
    "APPROVED" | "REJECTED" | "ON_HOLD" | "REQUIRES_RESUBMISSION" | "IN_REVIEW";
  reason: string;
  actorUserId: string;
  requestId: string;
  acknowledgedSubmissionId?: string;
}) {
  // Preserve omitted/default-null policy unless explicit ACK was supplied.
  // SQL validates durable receipt, reviewer, current session, hash and expiry.
  return {
    p_case_id: input.caseId,
    p_actor: input.actorUserId,
    p_to_status: input.decision,
    p_reason: input.reason,
    p_request_id: input.requestId,
    ...(input.acknowledgedSubmissionId
      ? { p_view_submission_id: input.acknowledgedSubmissionId }
      : {}),
  };
}

export function newKycRequestId(): string {
  return randomUUID();
}
