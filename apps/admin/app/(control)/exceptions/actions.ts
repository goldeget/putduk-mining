"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  mapRpcFailure,
  requireHighImpactPrincipal,
  type CommandActionResult,
} from "@/app/(control)/_lib/command-gate";
import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { createAdminServiceClient } from "@/lib/supabase/service";

const acknowledgeSchema = z.object({
  mismatchId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
  result: z.enum(["INVESTIGATING", "RESOLVED", "ACCEPTED"]),
  confirmation: z.literal("ACK_EXCEPTION"),
});

const OPEN_QUEUE_STATUSES = ["OPEN", "INVESTIGATING"] as const;

/**
 * 대사 예외 확인만 한다. 원장·잔액·투영을 고치지 않는다.
 * 동시 처리·이미 닫힌 건은 0건 갱신으로 실패 처리한다.
 */
export async function acknowledgeReconciliationExceptionAction(
  _prev: CommandActionResult | null,
  formData: FormData,
): Promise<CommandActionResult> {
  const access = await requireHighImpactPrincipal(
    ADMIN_COMMAND_FAMILIES.RECONCILIATION_ACK,
    formData,
  );
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
      message: "확인 사유(10자 이상)와 결과를 확인해 주세요.",
    };
  }

  const nowIso = new Date().toISOString();
  const terminal =
    parsed.data.result === "RESOLVED" || parsed.data.result === "ACCEPTED";

  // 자동 수리는 금지. 상태·사유·감사만 남긴다.
  const db = createAdminServiceClient();
  const { data: updated, error } = await db
    .from("reconciliation_mismatches")
    .update({
      status: parsed.data.result,
      resolution_reason: parsed.data.reason,
      resolved_by: terminal ? access.principal.userId : null,
      resolved_at: terminal ? nowIso : null,
    })
    .eq("id", parsed.data.mismatchId)
    .in("status", [...OPEN_QUEUE_STATUSES])
    .select("id, status, expected_value, actual_value")
    .maybeSingle();

  if (error) {
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
        auto_repair: false,
      },
    });
    return mapRpcFailure(
      error.message,
      "예외 확인을 저장하지 못했습니다. 자동 수정은 하지 않습니다.",
    );
  }

  if (!updated) {
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
        outcome: "STALE_OR_CLOSED",
        auto_repair: false,
      },
    });
    return {
      ok: false,
      code: "STALE_OR_CLOSED",
      message:
        "이미 처리됐거나 목록에서 사라진 예외입니다. 새로고침 후 다시 확인해 주세요.",
    };
  }

  const { error: auditError } = await db.from("audit_logs").insert({
    actor_user_id: access.principal.userId,
    actor_role: access.principal.role,
    action: "RECONCILIATION_EXCEPTION_ACK",
    target_type: "RECONCILIATION_MISMATCH",
    target_id: parsed.data.mismatchId,
    reason: parsed.data.reason,
    request_id: access.requestId,
    metadata: {
      result: parsed.data.result,
      auto_repair: false,
      expected_value: updated.expected_value ?? null,
      actual_value: updated.actual_value ?? null,
    },
  });

  // 상태 변경과 감사 기록은 별도 요청이다. 감사 실패를 성공으로 숨기지 않고,
  // 애플리케이션에서 행을 되돌리지 않는다. 원장 자동 수리도 하지 않는다.
  if (auditError) {
    return {
      ok: false,
      code: "AUDIT_WRITE_FAILED",
      message:
        "예외 상태는 반영됐을 수 있지만 감사 기록을 남기지 못했습니다. 목록을 새로고침해 현재 상태를 확인한 뒤 다시 처리해 주세요. 원장이나 잔액은 자동으로 고치지 않았습니다.",
    };
  }

  if (parsed.data.result === "INVESTIGATING") {
    return {
      ok: true,
      message:
        "조사 중으로 남겼습니다. 차이 증거는 그대로 보이며 숫자는 고치지 않았습니다.",
    };
  }

  return {
    ok: true,
    message: "예외를 확인했습니다. 자동으로 숫자를 고치지 않았습니다.",
  };
}
