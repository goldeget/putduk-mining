import { requireHighImpactPrincipal } from "../../../../../(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "../../../../../../lib/auth/command-families";
import { createAdminServiceClient } from "../../../../../../lib/supabase/service";
import {
  KYC_UUID,
  readKycForm,
} from "../../../../../../../../domain/kyc/evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Records the reviewer's explicit assertion after complete, hashed client bytes. */
export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  try {
    const form = await readKycForm(request, 4096, 10_000);
    if (!form || form.get("confirmation") !== "CONFIRM_KYC_CONTENT_REVIEWED")
      return denied(400);
    const receiptId = form.get("receiptId"),
      hash = form.get("contentSha256");
    const { submissionId } = await context.params;
    if (
      typeof receiptId !== "string" ||
      !KYC_UUID.test(receiptId) ||
      !KYC_UUID.test(submissionId) ||
      typeof hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(hash)
    )
      return denied(400);
    const access = await requireHighImpactPrincipal(
      ADMIN_COMMAND_FAMILIES.KYC_REVIEW,
      form,
    );
    if (!access.ok) return denied(403);
    const db = createAdminServiceClient();
    const result = await db.rpc("acknowledge_kyc_evidence", {
      p_receipt_id: receiptId,
      p_submission_id: submissionId,
      p_actor: access.principal.userId,
      p_admin_session_id: access.principal.adminSessionId,
      p_auth_session_id: access.principal.sessionId,
      p_content_sha256: hash,
      p_request_id: access.requestId,
    });
    if (result.error || result.data !== receiptId) return denied(503);
    return Response.json(
      { data: { receiptId, submissionId, state: "ACKNOWLEDGED" } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return denied(503);
  }
}
function denied(status: number) {
  return Response.json(
    {
      error: {
        code: "KYC_CONTENT_REVIEW_UNCONFIRMED",
        message:
          "서류 내용 확인 기록을 저장하지 못했어요. 작업 확인 후 다시 확인해 주세요.",
      },
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
