"use server";

import { revalidatePath } from "next/cache";

import {
  mapRpcFailure,
  prepareMoneyAttempt,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { createAdminServiceClient } from "@/lib/supabase/service";

import {
  parseSafeModeFormInput,
  SAFE_MODE_MUTATION_ROLES,
  safeModeAuditAction,
  safeModeSuccessMessage,
} from "./safe-mode-policy";

export async function setSafeModeAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  // Pure input checks do not consume the operator's one-time confirmation.
  const attempt = prepareMoneyAttempt(formData);
  if (!attempt.ok) return attempt.result;
  const parsed = parseSafeModeFormInput({
    component: formData.get("component"),
    pause: formData.get("pause"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
    reviewAt: formData.get("reviewAt"),
    expectedRequestId: formData.get("expectedRequestId"),
  });
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      message: parsed.message,
    };
  }

  // A valid input never replaces current role, AAL2, session, origin or step-up.
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.SAFE_MODE,
    formData,
    SAFE_MODE_MUTATION_ROLES,
  );
  if (!access.ok) return access.result;

  const isPaused = parsed.data.pause === "true";
  const db = createAdminServiceClient();
  // A private DB trigger applies this versioned command in the audit INSERT's
  // transaction. No separate state write can survive a failed audit or event.
  const { error } = await db.from("audit_logs").insert({
    actor_user_id: access.principal.userId,
    actor_role: access.principal.role,
    action: safeModeAuditAction(isPaused),
    target_type: "SAFE_MODE",
    target_id: parsed.data.component,
    reason: parsed.data.reason,
    request_id: access.requestId,
    metadata: {
      command_version: 1,
      idempotency_key: attempt.idempotencyKey,
      expected_request_id: parsed.data.expectedRequestId,
      component: parsed.data.component,
      is_paused: isPaused,
      review_at: parsed.data.reviewAt,
    },
  });

  if (error) {
    if (error.message?.includes("SAFE_MODE_STATE_CHANGED"))
      return {
        ok: false,
        code: "STATE_CHANGED",
        message:
          "다른 운영 작업으로 상태가 바뀌었습니다. 다시 불러와 확인해 주세요.",
      };
    return mapRpcFailure(
      error.message,
      "안전 모드를 저장하지 못했습니다. 현재 상태를 다시 확인해 주세요.",
    );
  }
  // A successful transport or a missing trigger is not a command receipt.
  const receipt = await db
    .from("audit_logs")
    .select(
      "id,actor_user_id,action,target_id,reason,request_id,after_state,metadata",
    )
    .eq("target_type", "SAFE_MODE")
    .eq("metadata->>command_version", "1")
    .eq("metadata->>idempotency_key", attempt.idempotencyKey)
    .maybeSingle();
  if (
    receipt.error ||
    !receipt.data ||
    receipt.data.actor_user_id !== access.principal.userId ||
    receipt.data.action !== safeModeAuditAction(isPaused) ||
    receipt.data.target_id !== parsed.data.component ||
    receipt.data.reason !== parsed.data.reason ||
    typeof receipt.data.metadata?.request_hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(receipt.data.metadata.request_hash) ||
    typeof receipt.data.after_state?.id !== "string" ||
    receipt.data.after_state?.changed_by !== access.principal.userId ||
    receipt.data.after_state?.request_id !== receipt.data.request_id ||
    receipt.data.after_state?.component !== parsed.data.component ||
    receipt.data.after_state?.is_paused !== isPaused
  ) {
    return {
      ok: false,
      code: "RECEIPT_UNVERIFIED",
      message:
        "처리 결과를 확인하지 못했습니다. 현재 상태를 다시 확인해 주세요.",
    };
  }

  revalidatePath("/restrictions");

  return {
    ok: true,
    message: safeModeSuccessMessage(parsed.data.component, isPaused),
  };
}
