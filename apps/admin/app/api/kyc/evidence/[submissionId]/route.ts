import { requireHighImpactPrincipal } from "../../../../(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "../../../../../lib/auth/command-families";
import { createAdminServiceClient } from "../../../../../lib/supabase/service";
import {
  inspectKycEvidence,
  KYC_EVIDENCE_BUCKET,
  KYC_UUID,
  readKycForm,
} from "../../../../../../../domain/kyc/evidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Protected access attempt is audited before Storage. Delivery is not a view attestation. */
export async function POST(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  try {
    const form = await readKycForm(request, 4096, 10_000);
    if (!form || form.get("confirmation") !== "VIEW_KYC_EVIDENCE")
      return denied(400);
    const reason = form.get("reason");
    if (
      typeof reason !== "string" ||
      reason.trim().length < 10 ||
      reason.trim().length > 500
    )
      return denied(400);
    const access = await requireHighImpactPrincipal(
      ADMIN_COMMAND_FAMILIES.KYC_REVIEW,
      form,
    );
    if (!access.ok) return denied(403);
    const { submissionId } = await context.params;
    if (!KYC_UUID.test(submissionId)) return denied(404);
    const db = createAdminServiceClient();
    const { data, error } = await db
      .from("kyc_submissions")
      .select("id,case_id,user_id,protected_storage_path,content_sha256")
      .eq("id", submissionId)
      .maybeSingle();
    if (error || !data) return denied(404);
    if (
      !KYC_UUID.test(data.user_id) ||
      !KYC_UUID.test(data.case_id) ||
      !KYC_UUID.test(data.id)
    )
      return denied(503);
    const prefix = `${data.user_id.toLowerCase()}/${data.case_id.toLowerCase()}/`;
    const suffix = data.protected_storage_path?.slice(prefix.length);
    if (
      !data.protected_storage_path?.startsWith(prefix) ||
      typeof suffix !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.(png|jpg|pdf))?$/.test(
        suffix,
      )
    )
      return denied(503);
    const activity = await db.from("audit_logs").insert({
      actor_user_id: access.principal.userId,
      actor_role: access.principal.role,
      action: "KYC_EVIDENCE_ACCESS_ATTEMPT",
      target_type: "KYC_SUBMISSION",
      target_id: data.id,
      reason: reason.trim(),
      request_id: access.requestId,
      metadata: {
        case_id: data.case_id,
        delivery: "protected_attachment",
        outcome: "ATTEMPTED",
      },
    });
    if (activity.error) return denied(503);
    const stored = await db.storage
      .from(KYC_EVIDENCE_BUCKET)
      .download(data.protected_storage_path);
    if (stored.error || !stored.data) return denied(503);
    const bytes = new Uint8Array(await stored.data.arrayBuffer());
    const evidence = inspectKycEvidence(bytes);
    if (!evidence || evidence.sha256 !== data.content_sha256.toLowerCase())
      return denied(503);
    // Prepared bytes do not prove response receipt or a person's examination.
    const prepared = await db.from("audit_logs").insert({
      actor_user_id: access.principal.userId,
      actor_role: access.principal.role,
      action: "KYC_EVIDENCE_BYTES_PREPARED",
      target_type: "KYC_SUBMISSION",
      target_id: data.id,
      reason: reason.trim(),
      request_id: access.requestId,
      metadata: {
        case_id: data.case_id,
        delivery: "protected_attachment",
        outcome: "BYTES_VERIFIED",
      },
    });
    if (prepared.error) return denied(503);
    const receipt = await db
      .from("kyc_evidence_delivery_receipts")
      .insert({
        submission_id: data.id,
        case_id: data.case_id,
        owner_user_id: data.user_id,
        reviewer_user_id: access.principal.userId,
        admin_session_id: access.principal.adminSessionId,
        auth_session_id: access.principal.sessionId,
        content_sha256: evidence.sha256,
        prepare_request_id: access.requestId,
      })
      .select("id,expires_at")
      .single();
    if (
      receipt.error ||
      !KYC_UUID.test(receipt.data?.id ?? "") ||
      !Number.isFinite(Date.parse(receipt.data?.expires_at ?? ""))
    )
      return denied(503);
    return new Response(bytes, {
      headers: {
        "Content-Type": evidence.contentType,
        "Content-Disposition": `attachment; filename="identity-document.${evidence.extension}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Referrer-Policy": "no-referrer",
        "Kyc-Delivery-Receipt": receipt.data.id,
        "Kyc-Evidence-Sha256": evidence.sha256,
        "Kyc-Delivery-Expires": receipt.data.expires_at,
      },
    });
  } catch {
    return denied(503);
  }
}
function denied(status: number) {
  return Response.json(
    {
      error: {
        code: "KYC_EVIDENCE_UNAVAILABLE",
        message: "제출 서류를 확인하지 못했습니다. 다시 확인해 주세요.",
      },
    },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
