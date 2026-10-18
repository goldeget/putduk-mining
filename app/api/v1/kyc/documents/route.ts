import {
  inspectKycEvidence,
  KYC_EVIDENCE_BUCKET,
  KYC_UUID,
  kycEvidencePath,
  readKycForm,
  type KycDocumentPayload,
} from "@/domain/kyc/evidence";
import { apiError, apiSuccess } from "@/lib/api/http";
import {
  claimKycOperation,
  confirmedKycId,
  getVerifiedKycIdentity,
  isKycConflict,
} from "@/lib/kyc/operations";
import { hasKycOrigin } from "@/lib/kyc/request";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recovery returns only this owner's key receipt, never Storage metadata. */
export async function GET(request: Request) {
  const requestId = request.headers.get("Idempotency-Key");
  if (requestId !== null && !KYC_UUID.test(requestId)) return invalid();
  try {
    const identity = await getVerifiedKycIdentity();
    if (!identity) return unauthenticated();
    const db = createSupabaseAdminClient();
    if (requestId === null) {
      const pending = await db
        .from("kyc_operation_receipts")
        .select("request_id,request_payload,created_at", { count: "exact" })
        .eq("user_id", identity.userId)
        .eq("operation", "SUBMIT")
        .is("result_id", null)
        .is("resolution", null)
        .order("created_at", { ascending: false })
        .order("request_id", { ascending: false })
        .limit(50);
      if (pending.error || pending.count === null)
        throw new Error("KYC_RECOVERY_UNCONFIRMED");
      const mapped = (pending.data ?? []).map((row) => {
        const payload = row.request_payload as { case_id?: unknown };
        if (
          !confirmedKycId(row.request_id) ||
          !confirmedKycId(payload?.case_id) ||
          typeof row.created_at !== "string"
        )
          throw new Error("KYC_RECOVERY_UNCONFIRMED");
        return {
          requestId: row.request_id,
          caseId: payload.case_id,
          createdAt: row.created_at,
          state: "PENDING" as const,
        };
      });
      const cases = mapped.length
        ? await identity.supabase
            .from("kyc_cases")
            .select("id,status")
            .eq("user_id", identity.userId)
            .in("id", [...new Set(mapped.map((row) => row.caseId))])
        : { data: [], error: null };
      if (cases.error) throw new Error("KYC_RECOVERY_UNCONFIRMED");
      const attempts = mapped.map((row) => {
        const owned = cases.data?.find((item) => item.id === row.caseId);
        if (!owned) throw new Error("KYC_RECOVERY_UNCONFIRMED");
        return {
          ...row,
          closed: ["APPROVED", "REJECTED"].includes(owned.status),
        };
      });
      return apiSuccess({
        attempts,
        incomplete: pending.count > attempts.length,
      });
    }
    const requestedCase = request.headers.get("Kyc-Case-Id");
    if (requestedCase !== null) {
      if (!KYC_UUID.test(requestedCase)) return invalid();
      const ownCase = await identity.supabase
        .from("kyc_cases")
        .select("id")
        .eq("user_id", identity.userId)
        .eq("id", requestedCase.toLowerCase())
        .maybeSingle();
      if (ownCase.error) throw ownCase.error;
      if (!ownCase.data)
        return apiError({
          code: "KYC_REQUEST_NOT_OWNED",
          message: "현재 계정의 제출 요청이 아니에요.",
          status: 404,
        });
    }
    const { data, error } = await db
      .from("kyc_operation_receipts")
      .select("result_id,request_payload,resolution")
      .eq("user_id", identity.userId)
      .eq("operation", "SUBMIT")
      .eq("request_id", requestId.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    const payload = data?.request_payload as { case_id?: unknown } | undefined;
    if (
      data &&
      (!confirmedKycId(payload?.case_id) ||
        !(data.result_id === null || confirmedKycId(data.result_id)) ||
        !(data.resolution === null || data.resolution === "CASE_CLOSED") ||
        (data.result_id !== null && data.resolution !== null))
    )
      throw new Error("KYC_RECOVERY_UNCONFIRMED");
    if (
      requestedCase &&
      data &&
      (!confirmedKycId(payload?.case_id) ||
        payload.case_id !== requestedCase.toLowerCase())
    )
      return apiError({
        code: "KYC_REQUEST_CASE_MISMATCH",
        message: "이전 요청의 본인 확인 신청을 다시 확인해 주세요.",
        status: 409,
      });
    const lookupCase =
      requestedCase?.toLowerCase() ??
      (confirmedKycId(payload?.case_id) ? payload.case_id : null);
    // Server RPC matches only the four verified historical identities and fails
    // closed on ambiguity. This read never adopts/mutates an operation receipt.
    const accepted = lookupCase
      ? await db.rpc("lookup_kyc_submission", {
          p_user_id: identity.userId,
          p_case_id: lookupCase,
          p_request_id: requestId.toLowerCase(),
        })
      : { data: null, error: null };
    if (accepted.error) throw accepted.error;
    if (accepted.data !== null) {
      if (
        !confirmedKycId(accepted.data?.id) ||
        accepted.data.case_id !== lookupCase ||
        data?.resolution === "CASE_CLOSED" ||
        (confirmedKycId(data?.result_id) && data.result_id !== accepted.data.id)
      )
        throw new Error("KYC_RECOVERY_UNCONFIRMED");
      return apiSuccess({
        receipt: {
          state: "CONFIRMED",
          submissionId: accepted.data.id,
          caseId: accepted.data.case_id,
        },
      });
    }
    if (confirmedKycId(data?.result_id))
      throw new Error("KYC_RECOVERY_UNCONFIRMED");
    return apiSuccess({
      receipt:
        confirmedKycId(payload?.case_id) && data?.resolution === "CASE_CLOSED"
          ? { state: "CLOSED", caseId: payload.case_id }
          : null,
    });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request) {
  if (!hasKycOrigin(request))
    return apiError({
      code: "ORIGIN_DENIED",
      message: "화면을 다시 열고 시도해 주세요.",
      status: 403,
    });
  const requestId = request.headers.get("Idempotency-Key") ?? "";
  if (!KYC_UUID.test(requestId)) return invalid();
  try {
    const identity = await getVerifiedKycIdentity();
    if (!identity) return unauthenticated();
    const form = await readKycForm(request);
    const caseId = form?.get("caseId");
    const kind = form?.get("documentKind");
    const file = form?.get("file");
    if (
      typeof caseId !== "string" ||
      !KYC_UUID.test(caseId) ||
      kind !== "IDENTITY_DOCUMENT" ||
      !(file instanceof File)
    )
      return invalid();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const evidence = inspectKycEvidence(bytes);
    if (!evidence) return invalid();
    const { data: owned, error: ownerError } = await identity.supabase
      .from("kyc_cases")
      .select("id,status")
      .eq("id", caseId)
      .eq("user_id", identity.userId)
      .maybeSingle();
    if (ownerError) throw ownerError;
    if (!owned)
      return apiError({
        code: "KYC_NOT_FOUND",
        message: "본인 확인 신청을 다시 확인해 주세요.",
        status: 404,
      });
    const db = createSupabaseAdminClient();
    const path = kycEvidencePath(identity.userId, caseId, requestId);
    const payload: KycDocumentPayload = {
      case_id: caseId.toLowerCase(),
      document_kind: kind,
      path,
      content_sha256: evidence.sha256,
      mime_type: evidence.contentType,
      size_bytes: evidence.sizeBytes,
    };
    const receipt = await claimKycOperation(db, {
      userId: identity.userId,
      authSessionId: identity.authSessionId,
      operation: "SUBMIT",
      requestId,
      payload,
    });
    if (confirmedKycId(receipt.result_id))
      return apiSuccess({ submissionId: receipt.result_id }, 200);
    if (receipt.resolution === "CASE_CLOSED") return closed();
    if (
      !["PENDING", "REQUIRES_RESUBMISSION", "ON_HOLD", "IN_REVIEW"].includes(
        owned.status,
      )
    )
      return apiError({
        code: "KYC_CASE_CLOSED",
        message: "현재 본인 확인 상태를 확인해 주세요.",
        status: 409,
      });
    if (request.signal.aborted) throw new Error("KYC_REQUEST_ABORTED");
    const storage = db.storage.from(KYC_EVIDENCE_BUCKET);
    const upload = await storage.upload(path, bytes, {
      contentType: evidence.contentType,
      upsert: false,
    });
    if (upload.error) {
      const stored = await storage.download(path);
      const verified =
        stored.data && !stored.error
          ? inspectKycEvidence(new Uint8Array(await stored.data.arrayBuffer()))
          : null;
      if (
        !verified ||
        verified.sha256 !== evidence.sha256 ||
        verified.contentType !== evidence.contentType ||
        verified.sizeBytes !== evidence.sizeBytes
      )
        throw new Error("KYC_UPLOAD_UNCONFIRMED");
    }
    // Never remove an object after an unknown RPC result: it may back a committed receipt.
    const { data, error } = await db.rpc("submit_kyc_documents", {
      p_case_id: caseId.toLowerCase(),
      p_user_id: identity.userId,
      p_document_kind: kind,
      p_protected_storage_path: path,
      p_content_sha256: evidence.sha256,
      p_request_id: requestId.toLowerCase(),
    });
    if (error || !confirmedKycId(data))
      throw new Error(error?.message ?? "KYC_SUBMIT_UNCONFIRMED");
    return apiSuccess({ submissionId: data }, 201);
  } catch (error) {
    if (isKycConflict(error))
      return apiError({
        code: "KYC_IDEMPOTENCY_CONFLICT",
        message:
          "이 요청에는 다른 서류를 제출할 수 없어요. 현재 상태를 먼저 확인해 주세요.",
        status: 409,
      });
    return unavailable();
  }
}
function invalid() {
  return apiError({
    code: "INVALID_KYC_DOCUMENT",
    message: "5MB 이하의 사진(JPG·PNG) 또는 PDF를 선택해 주세요.",
    status: 400,
  });
}
function unauthenticated() {
  return apiError({
    code: "UNAUTHENTICATED",
    message: "로그인이 필요합니다.",
    status: 401,
  });
}
function unavailable() {
  return apiError({
    code: "KYC_SUBMISSION_UNCONFIRMED",
    message:
      "서류 제출 결과를 확인하지 못했어요. 같은 서류로 현재 결과를 확인해 주세요.",
    status: 503,
  });
}
function closed() {
  return apiError({
    code: "KYC_REQUEST_CLOSED",
    message:
      "이 요청의 서류는 접수되지 않았고 신청이 종료됐어요. 현재 상태를 확인해 주세요.",
    status: 409,
  });
}
