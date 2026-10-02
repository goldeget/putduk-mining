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

/**
 * 클라이언트가 일반 객체로 step-up 토큰을 넘긴다.
 * DOM FormData 에서 hidden stepUpToken 이 빠지는 CI 경로를 우회하며,
 * 게이트·소비·RPC 규칙은 reviewKycCaseAction 과 동일하다.
 */
export async function reviewKycCaseFromFields(input: {
  caseId: string;
  decision: string;
  reason: string;
  confirmation: string;
  stepUpToken: string;
}): Promise<CommandActionResult> {
  const formData = new FormData();
  formData.set("caseId", input.caseId);
  formData.set("decision", input.decision);
  formData.set("reason", input.reason);
  formData.set("confirmation", input.confirmation);
  const token = input.stepUpToken.trim();
  if (token.length >= 16) {
    formData.set("stepUpToken", token);
  }
  return reviewKycCaseAction(null, formData);
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

  const db = createAdminServiceClient();
  // 역할·step-up 소비 이후에만 조회한다. 조회 실패는 심사 RPC를 호출하지 않는다.
  // 실제 0건(error 없음)은 기존처럼 심사할 수 있다.
  let submissionError: { message?: string } | null = null;
  try {
    const submissionRead = await db
      .from("kyc_submissions")
      .select("case_id")
      .eq("case_id", parsed.data.caseId)
      .limit(1);
    submissionError = submissionRead.error;
  } catch {
    submissionError = { message: "KYC_SUBMISSIONS_UNAVAILABLE" };
  }
  if (submissionError) {
    return {
      ok: false,
      code: "EVIDENCE_UNAVAILABLE",
      message:
        "제출 서류를 확인하지 못했습니다. 자료를 다시 확인한 뒤 검토해 주세요.",
    };
  }

  const rpcArgs = buildReviewKycRpcArgs({
    caseId: parsed.data.caseId,
    decision: parsed.data.decision,
    reason: parsed.data.reason,
    actorUserId: access.principal.userId,
    requestId: access.requestId,
  });

  const { error } = await db.rpc("review_kyc_case", rpcArgs);

  if (error) {
    return mapKycReviewFailure(error.message);
  }

  revalidatePath("/kyc");
  return { ok: true, message: "본인 확인 검토 결과를 저장했습니다." };
}
