import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { consumeAdminStepUpGrant } from "@/lib/auth/step-up";
import { requestDeclaredOffline } from "@/lib/money/logical-operation";
import { createAdminServiceClient } from "@/lib/supabase/service";

const bodySchema = z
  .object({
    confirmation: z.literal("APPROVE_DEPOSIT"),
    depositRequestId: z.uuid(),
    reason: z.string().trim().min(10).max(500),
    receivedAmountAtomic: z.string().regex(/^[1-9][0-9]{0,23}$/),
    stepUpToken: z.string().min(16),
  })
  .strict();
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/;

function error(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

function approvalFailure(message: string) {
  if (message.includes("IDEMPOTENCY_PAYLOAD_MISMATCH")) {
    return error(
      "IDEMPOTENCY_PAYLOAD_MISMATCH",
      "이전 요청과 금액이나 사유가 다릅니다. 처음 보낸 내용으로 다시 확인해 주세요.",
      409,
    );
  }
  if (message.includes("DEPOSIT_APPROVAL_IN_PROGRESS")) {
    return error(
      "DEPOSIT_APPROVAL_IN_PROGRESS",
      "결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.",
      503,
    );
  }
  const conflict =
    message.includes("DEPOSIT_REQUEST_NOT_APPROVABLE") ||
    message.includes("DEPOSIT_REQUEST_NOT_FOUND") ||
    message.includes("DEPOSIT_CURRENCY_NOT_APPROVABLE");
  return error(
    conflict ? "DEPOSIT_NOT_APPROVABLE" : "DEPOSIT_APPROVAL_FAILED",
    conflict
      ? "현재 상태에서는 이 요청을 승인할 수 없습니다."
      : "입금 승인을 완료하지 못했습니다.",
    conflict ? 409 : 503,
  );
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requireAdminCommand(request, HIGH_IMPACT_ROLES);
  if (!access.ok)
    return error(access.code, "이 작업을 실행할 수 없습니다.", access.status);

  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
  if (!idempotencyKey || !idempotencyPattern.test(idempotencyKey)) {
    return error(
      "INVALID_IDEMPOTENCY_KEY",
      "요청 식별자를 확인해 주세요.",
      400,
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return error(
      "INVALID_APPROVAL_REQUEST",
      "승인 입력값을 확인해 주세요.",
      400,
    );
  if (requestDeclaredOffline(request)) {
    return error(
      "OFFLINE_BLOCKED",
      "연결이 끊긴 상태에서는 입금을 반영하지 않습니다. 다시 연결된 뒤 직접 눌러 주세요.",
      409,
    );
  }

  const requestId = randomUUID();
  const stepUpOk = await consumeAdminStepUpGrant({
    userId: access.principal.userId,
    adminSessionId: access.principal.adminSessionId,
    token: parsed.data.stepUpToken,
    commandFamily: ADMIN_COMMAND_FAMILIES.DEPOSIT_APPROVE,
    requestId,
  });
  if (!stepUpOk) {
    return error(
      "STEP_UP_REQUIRED",
      "고위험 작업입니다. 인증 앱으로 다시 확인한 뒤 시도해 주세요.",
      403,
    );
  }

  const { data, error: commandError } = await createAdminServiceClient().rpc(
    "approve_deposit_request",
    {
      p_deposit_request_id: parsed.data.depositRequestId,
      p_ledger_idempotency_key: idempotencyKey,
      p_operator_id: access.principal.userId,
      p_reason: parsed.data.reason,
      p_received_amount_atomic: parsed.data.receivedAmountAtomic,
      p_request_id: requestId,
    },
  );
  if (commandError) return approvalFailure(commandError.message);
  return NextResponse.json(
    { data: { ledgerId: data } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
