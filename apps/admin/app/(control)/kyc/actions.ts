"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  mapRpcFailure,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { createAdminServiceClient } from "@/lib/supabase/service";

import { buildReviewKycRpcArgs } from "./review-rpc";

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

function mapKycReviewFailure(message: string | undefined): CommandActionResult {
  const text = message ?? "";
  if (text.includes("ADMIN_ROLE_REQUIRED")) {
    return {
      ok: false,
      code: "ROLE_FORBIDDEN",
      message: "현재 역할로는 이 작업을 할 수 없습니다.",
    };
  }
  if (text.includes("KYC_CASE_NOT_FOUND")) {
    return {
      ok: false,
      code: "KYC_CASE_NOT_FOUND",
      message: "해당 본인 확인 건을 찾지 못했습니다. 목록을 새로고침해 주세요.",
    };
  }
  if (
    text.includes("INVALID_KYC_REVIEW") ||
    text.includes("INVALID_KYC_STATUS")
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "본인 확인 검토 입력값을 확인해 주세요.",
    };
  }
  return mapRpcFailure(
    message,
    "본인 확인 검토를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  );
}

export async function reviewKycCaseAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.KYC_REVIEW,
    formData,
  );
  if (!access.ok) return access.result;

  const parsed = reviewSchema.safeParse({
    caseId: formData.get("caseId"),
    decision: formData.get("decision"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    const reasonIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === "reason",
    );
    if (reasonIssue) {
      return {
        ok: false,
        code: "REASON_REQUIRED",
        message: "결정 사유는 10자 이상 적어 주세요.",
      };
    }
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "본인 확인 검토 입력값을 확인해 주세요.",
    };
  }

  const rpcArgs = buildReviewKycRpcArgs({
    caseId: parsed.data.caseId,
    decision: parsed.data.decision,
    reason: parsed.data.reason,
    actorUserId: access.principal.userId,
    requestId: access.requestId,
  });

  const { error } = await createAdminServiceClient().rpc(
    "review_kyc_case",
    rpcArgs,
  );

  if (error) {
    return mapKycReviewFailure(error.message);
  }

  revalidatePath("/kyc");
  return { ok: true, message: "본인 확인 검토 결과를 저장했습니다." };
}
