"use server";

import { revalidatePath } from "next/cache";

import {
  mapRpcFailure,
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
  // 역할·스텝업·세션을 먼저 검사한다. 안전 모드/플래그는 인가가 아니다.
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.SAFE_MODE,
    formData,
    SAFE_MODE_MUTATION_ROLES,
  );
  if (!access.ok) return access.result;

  const parsed = parseSafeModeFormInput({
    component: formData.get("component"),
    pause: formData.get("pause"),
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
    reviewAt: formData.get("reviewAt"),
  });
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      message: parsed.message,
    };
  }

  const isPaused = parsed.data.pause === "true";
  const db = createAdminServiceClient();
  const { error } = await db.from("safe_mode_controls").upsert(
    {
      component: parsed.data.component,
      is_paused: isPaused,
      reason: parsed.data.reason,
      starts_at: new Date().toISOString(),
      review_at: parsed.data.reviewAt,
      changed_by: access.principal.userId,
      request_id: access.requestId,
    },
    { onConflict: "component" },
  );

  if (error) {
    return mapRpcFailure(error.message, "안전 모드를 저장하지 못했습니다.");
  }

  // 감사 기록은 같은 request_id로 남긴다. 실패 시 성공으로 보고하지 않는다.
  const { error: auditError } = await db.from("audit_logs").insert({
    actor_user_id: access.principal.userId,
    actor_role: access.principal.role,
    action: safeModeAuditAction(isPaused),
    target_type: "SAFE_MODE",
    target_id: parsed.data.component,
    reason: parsed.data.reason,
    request_id: access.requestId,
    metadata: {
      component: parsed.data.component,
      is_paused: isPaused,
      review_at: parsed.data.reviewAt,
    },
  });

  if (auditError) {
    return {
      ok: false,
      code: "AUDIT_WRITE_FAILED",
      message:
        "제한은 반영됐을 수 있으나 감사 기록을 남기지 못했습니다. 다시 확인한 뒤 재시도해 주세요.",
    };
  }

  revalidatePath("/restrictions");

  return {
    ok: true,
    message: safeModeSuccessMessage(parsed.data.component, isPaused),
  };
}
