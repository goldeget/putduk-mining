"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  mapRpcFailure,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { createAdminServiceClient } from "@/lib/supabase/service";

const acknowledgeSchema = z.object({
  mismatchId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
  result: z.enum(["INVESTIGATING", "RESOLVED", "ACCEPTED"]),
  confirmation: z.literal("ACK_EXCEPTION"),
});

export async function acknowledgeReconciliationExceptionAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal();
  if (!access.ok) return access.result;

  const parsed = acknowledgeSchema.safeParse({
    mismatchId: formData.get("mismatchId"),
    reason: formData.get("reason"),
    result: formData.get("result"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "예외 확인 입력값을 확인해 주세요.",
    };
  }

  // 자동 수리는 금지. 상태·사유만 남긴다.
  const db = createAdminServiceClient();
  const { error } = await db
    .from("reconciliation_mismatches")
    .update({
      status: parsed.data.result,
      resolution_reason: parsed.data.reason,
      resolved_by:
        parsed.data.result === "INVESTIGATING" ? null : access.principal.userId,
      resolved_at:
        parsed.data.result === "INVESTIGATING"
          ? null
          : new Date().toISOString(),
    })
    .eq("id", parsed.data.mismatchId)
    .in("status", ["OPEN", "INVESTIGATING"]);

  if (error) {
    // 도메인 명령이 생기면 대체. 현재는 감사 로그라도 남긴다.
    await db.from("audit_logs").insert({
      actor_user_id: access.principal.userId,
      actor_role: access.principal.role,
      action: "RECONCILIATION_EXCEPTION_ACK_ATTEMPT",
      target_type: "RECONCILIATION_MISMATCH",
      target_id: parsed.data.mismatchId,
      reason: parsed.data.reason,
      request_id: randomUUID(),
      metadata: {
        result: parsed.data.result,
        update_error: error.message,
      },
    });
    return mapRpcFailure(
      error.message,
      "예외 확인을 저장하지 못했습니다. 자동 수정은 하지 않습니다.",
    );
  }

  await db.from("audit_logs").insert({
    actor_user_id: access.principal.userId,
    actor_role: access.principal.role,
    action: "RECONCILIATION_EXCEPTION_ACK",
    target_type: "RECONCILIATION_MISMATCH",
    target_id: parsed.data.mismatchId,
    reason: parsed.data.reason,
    request_id: randomUUID(),
    metadata: { result: parsed.data.result, auto_repair: false },
  });

  return {
    ok: true,
    message: "예외를 확인했습니다. 자동으로 숫자를 고치지 않았습니다.",
  };
}
