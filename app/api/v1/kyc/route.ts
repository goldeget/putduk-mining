import { KYC_UUID } from "@/domain/kyc/evidence";
import { apiError, apiSuccess } from "@/lib/api/http";
import {
  claimKycOperation,
  confirmedKycId,
  getVerifiedKycIdentity,
} from "@/lib/kyc/operations";
import { hasKycOrigin } from "@/lib/kyc/request";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const identity = await getVerifiedKycIdentity();
    if (!identity) return unauthenticated();
    const { data, error } = await identity.supabase
      .from("kyc_cases")
      .select("id,status,opened_at")
      .eq("user_id", identity.userId)
      .order("opened_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return apiSuccess({ case: data });
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
  if (!KYC_UUID.test(requestId))
    return apiError({
      code: "INVALID_KYC_REQUEST",
      message: "현재 상태를 확인한 뒤 다시 시도해 주세요.",
      status: 400,
    });
  try {
    const identity = await getVerifiedKycIdentity();
    if (!identity) return unauthenticated();
    const db = createSupabaseAdminClient();
    const receipt = await claimKycOperation(db, {
      userId: identity.userId,
      authSessionId: identity.authSessionId,
      operation: "OPEN",
      requestId,
      payload: {},
    });
    if (confirmedKycId(receipt.result_id))
      return apiSuccess({ caseId: receipt.result_id }, 200);
    const { data, error } = await db.rpc("open_kyc_case", {
      p_user_id: identity.userId,
      p_request_id: requestId.toLowerCase(),
    });
    if (error || !confirmedKycId(data))
      throw error ?? new Error("KYC_OPEN_UNCONFIRMED");
    return apiSuccess({ caseId: data }, 201);
  } catch {
    return unavailable();
  }
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
    code: "KYC_UNCONFIRMED",
    message:
      "본인 확인 결과를 확인하지 못했어요. 현재 상태를 확인한 뒤 다시 시도해 주세요.",
    status: 503,
  });
}
