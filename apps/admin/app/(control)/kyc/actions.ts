"use server";

import { z } from "zod";

import {
  mapRpcFailure,
  newIdempotencyKey,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { createAdminServiceClient } from "@/lib/supabase/service";

const reviewSchema = z.object({
  caseId: z.uuid(),
  decision: z.enum([
    "APPROVED",
    "REJECTED",
    "ON_HOLD",
    "REQUIRES_RESUBMISSION",
    "IN_REVIEW",
  ]),
  reason: z.string().trim().min(10).max(500),
  confirmation: z.literal("REVIEW_KYC"),
});

export async function reviewKycCaseAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal();
  if (!access.ok) return access.result;

  const parsed = reviewSchema.safeParse({
    caseId: formData.get("caseId"),
    decision: formData.get("decision"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "본인 확인 검토 입력값을 확인해 주세요.",
    };
  }

  const { error } = await createAdminServiceClient().rpc("review_kyc_case", {
    p_case_id: parsed.data.caseId,
    p_decision: parsed.data.decision,
    p_reason: parsed.data.reason,
    p_actor: access.principal.userId,
    p_idempotency_key: newIdempotencyKey("kyc"),
  });

  if (error) {
    return mapRpcFailure(
      error.message,
      "본인 확인 검토를 저장하지 못했습니다.",
    );
  }
  return { ok: true, message: "본인 확인 검토 결과를 저장했습니다." };
}
