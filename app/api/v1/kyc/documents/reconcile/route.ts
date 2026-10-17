import {
  KYC_UUID,
  readKycForm,
  type KycDocumentPayload,
} from "@/domain/kyc/evidence";
import { apiError, apiSuccess } from "@/lib/api/http";
import {
  claimKycOperation,
  confirmedKycId,
  getVerifiedKycIdentity,
} from "@/lib/kyc/operations";
import { hasKycOrigin } from "@/lib/kyc/request";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Explicit recovery, never a client-dismiss operation. The DB proves closure. */
export async function POST(request: Request) {
  if (!hasKycOrigin(request)) return failure(403);
  try {
    const body = await readKycForm(request, 4096, 10_000);
    const key = body?.get("requestId");
    const caseId = body?.get("caseId");
    if (
      typeof key !== "string" ||
      !KYC_UUID.test(key) ||
      typeof caseId !== "string" ||
      !KYC_UUID.test(caseId)
    )
      return failure(400);
    const identity = await getVerifiedKycIdentity();
    if (!identity) return failure(401);
    const db = createSupabaseAdminClient();
    const read = await db
      .from("kyc_operation_receipts")
      .select("request_payload,result_id,resolution")
      .eq("user_id", identity.userId)
      .eq("operation", "SUBMIT")
      .eq("request_id", key.toLowerCase())
      .maybeSingle();
    if (read.error) return failure(503);
    if (!read.data) {
      const owned = await identity.supabase
        .from("kyc_cases")
        .select("id,status")
        .eq("user_id", identity.userId)
        .eq("id", caseId.toLowerCase())
        .maybeSingle();
      if (owned.error) return failure(503);
      if (!owned.data) return failure(404);
      const accepted = await db.rpc("lookup_kyc_submission", {
        p_user_id: identity.userId,
        p_case_id: caseId.toLowerCase(),
        p_request_id: key.toLowerCase(),
      });
      if (accepted.error) return failure(503);
      if (accepted.data !== null) {
        if (
          !confirmedKycId(accepted.data?.id) ||
          accepted.data.case_id !== caseId.toLowerCase()
        )
          return failure(503);
        return apiSuccess({
          state: "CONFIRMED",
          submissionId: accepted.data.id,
          caseId: caseId.toLowerCase(),
        });
      }
      if (!["APPROVED", "REJECTED"].includes(owned.data.status))
        return apiSuccess({ state: "PENDING", caseId: caseId.toLowerCase() });
      const missing = await db.rpc("resolve_missing_kyc_attempt", {
        p_user_id: identity.userId,
        p_case_id: caseId.toLowerCase(),
        p_request_id: key.toLowerCase(),
        p_auth_session_id: identity.authSessionId,
      });
      if (missing.error || typeof missing.data !== "boolean")
        return failure(503);
      return apiSuccess({
        state: missing.data ? "CLOSED" : "PENDING",
        caseId: caseId.toLowerCase(),
      });
    }
    const payload = read.data.request_payload as KycDocumentPayload;
    if (
      !confirmedKycId(payload?.case_id) ||
      payload.case_id !== caseId.toLowerCase()
    )
      return failure(503);
    if (confirmedKycId(read.data.result_id))
      return apiSuccess({
        state: "CONFIRMED",
        submissionId: read.data.result_id,
        caseId: payload.case_id,
      });
    if (read.data.resolution === "CASE_CLOSED")
      return apiSuccess({ state: "CLOSED", caseId: payload.case_id });
    const owned = await identity.supabase
      .from("kyc_cases")
      .select("id,status")
      .eq("user_id", identity.userId)
      .eq("id", payload.case_id)
      .maybeSingle();
    if (owned.error || !owned.data) return failure(503);
    const adopted = await claimKycOperation(db, {
      userId: identity.userId,
      authSessionId: identity.authSessionId,
      operation: "SUBMIT",
      requestId: key,
      payload,
    });
    if (confirmedKycId(adopted.result_id))
      return apiSuccess({
        state: "CONFIRMED",
        submissionId: adopted.result_id,
        caseId: payload.case_id,
      });
    if (adopted.resolution === "CASE_CLOSED")
      return apiSuccess({ state: "CLOSED", caseId: payload.case_id });
    if (!["APPROVED", "REJECTED"].includes(owned.data.status))
      return apiSuccess({ state: "PENDING", caseId: payload.case_id });
    // The frozen RPC locks owner/case and first recovers an existing submission.
    // Only no-submission + closed case becomes immutable CASE_CLOSED.
    const result = await db.rpc("submit_kyc_documents", {
      p_case_id: payload.case_id,
      p_user_id: identity.userId,
      p_document_kind: payload.document_kind,
      p_protected_storage_path: payload.path,
      p_content_sha256: payload.content_sha256,
      p_request_id: key.toLowerCase(),
    });
    if (result.error) return failure(503);
    if (confirmedKycId(result.data))
      return apiSuccess({
        state: "CONFIRMED",
        submissionId: result.data,
        caseId: payload.case_id,
      });
    const receipt = await db
      .from("kyc_operation_receipts")
      .select("resolution,result_id")
      .eq("user_id", identity.userId)
      .eq("operation", "SUBMIT")
      .eq("request_id", key.toLowerCase())
      .single();
    if (
      receipt.error ||
      receipt.data?.resolution !== "CASE_CLOSED" ||
      receipt.data.result_id !== null
    )
      return failure(503);
    return apiSuccess({ state: "CLOSED", caseId: payload.case_id });
  } catch {
    return failure(503);
  }
}
function failure(status: number) {
  return apiError({
    code: "KYC_RECOVERY_UNCONFIRMED",
    message:
      "이전 제출 결과를 확인하지 못했어요. 현재 상태를 다시 확인해 주세요.",
    status,
  });
}
