"use server";

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

const SAFE_SAVE_FAILURE =
  "예외 확인을 저장하지 못했습니다. 자동 수정은 하지 않습니다.";

function mapAcknowledgementFailure(detail: string): CommandActionResult {
  if (detail.includes("ADMIN_ROLE_REQUIRED")) {
    return {
      ok: false,
      code: "ROLE_FORBIDDEN",
      message: "현재 역할로는 이 작업을 할 수 없습니다.",
    };
  }
  if (detail.includes("STALE_OR_CLOSED")) {
    return {
      ok: false,
      code: "STALE_OR_CLOSED",
      message:
        "이미 처리됐거나 목록에서 사라진 예외입니다. 새로고침 후 다시 확인해 주세요.",
    };
  }
  if (detail.includes("ALREADY_INVESTIGATING")) {
    return {
      ok: false,
      code: "ALREADY_INVESTIGATING",
      message:
        "이미 조사 중인 예외입니다. 조사 완료나 차이 인정만 저장할 수 있어요.",
    };
  }
  if (detail.includes("MISMATCH_NOT_FOUND")) {
    return {
      ok: false,
      code: "MISMATCH_NOT_FOUND",
      message: "해당 예외를 찾지 못했습니다. 목록을 새로고침해 주세요.",
    };
  }
  if (detail.includes("AUDIT_WRITE_FAILED")) {
    return {
      ok: false,
      code: "AUDIT_WRITE_FAILED",
      message:
        "예외 확인을 저장하지 못했습니다. 상태는 바뀌지 않았습니다. 자동으로 숫자를 고치지 않았습니다.",
    };
  }
  if (detail.includes("INVALID_RECONCILIATION_ACK")) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "확인 사유(10자 이상)와 결과를 확인해 주세요.",
    };
  }
  return mapRpcFailure(detail, SAFE_SAVE_FAILURE);
}

function acknowledgementPayload(data: unknown): {
  code: string | null;
  status: string | null;
} {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { code: null, status: null };
  const record = row as { code?: unknown; status?: unknown };
  return {
    code: typeof record.code === "string" ? record.code : null,
    status: typeof record.status === "string" ? record.status : null,
  };
}

/**
 * 대사 예외 확인만 한다. 상태 변경과 성공 감사는 DB 함수 한 트랜잭션이다.
 * 원장·잔액·투영을 고치지 않는다. 단계 상승 확인은 이 호출 전에 끝난다.
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

  const db = createAdminServiceClient();
  const { data, error } = await db.rpc("acknowledge_reconciliation_mismatch", {
    p_mismatch_id: parsed.data.mismatchId,
    p_actor: access.principal.userId,
    p_result: parsed.data.result,
    p_reason: parsed.data.reason,
    p_request_id: access.requestId,
  });

  if (error) {
    const detail = [error.message, error.code, error.details]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join(" ");
    const failure = mapAcknowledgementFailure(detail);
    // 종료·경합 실패는 상태 변경이 없다. 시도 감사만 따로 남긴다.
    if (
      !failure.ok &&
      (failure.code === "STALE_OR_CLOSED" ||
        failure.code === "ALREADY_INVESTIGATING")
    ) {
      await db.from("audit_logs").insert({
        actor_user_id: access.principal.userId,
        actor_role: access.principal.role,
        action: "RECONCILIATION_EXCEPTION_ACK_ATTEMPT",
        target_type: "RECONCILIATION_MISMATCH",
        target_id: parsed.data.mismatchId,
        reason: parsed.data.reason,
        request_id: access.requestId,
        metadata: {
          result: parsed.data.result,
          outcome: failure.code,
          auto_repair: false,
        },
      });
    }
    return failure;
  }

  const payload = acknowledgementPayload(data);
  if (
    payload.code !== "ACKNOWLEDGED" &&
    payload.code !== "ACKNOWLEDGED_REPLAY"
  ) {
    return {
      ok: false,
      code: "COMMAND_FAILED",
      message: SAFE_SAVE_FAILURE,
    };
  }

  const outcome = payload.status ?? parsed.data.result;
  if (outcome === "INVESTIGATING") {
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
