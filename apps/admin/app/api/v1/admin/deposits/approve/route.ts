import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_COMMAND_FAMILIES } from "@/lib/auth/command-families";
import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { consumeAdminStepUpGrant } from "@/lib/auth/step-up";
import { createAdminServiceClient } from "@/lib/supabase/service";

const bodySchema = z.object({
  confirmation: z.literal("APPROVE_DEPOSIT"),
  depositRequestId: z.uuid(),
  reason: z.string().trim().min(10).max(500),
  receivedAmountAtomic: z.string().regex(/^[1-9][0-9]{0,23}$/),
  stepUpToken: z.string().min(16),
});
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/;

function error(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
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
  if (commandError) {
    const conflict =
      commandError.message.includes("DEPOSIT_REQUEST_NOT_APPROVABLE") ||
      commandError.message.includes("DEPOSIT_REQUEST_NOT_FOUND");
    return error(
      conflict ? "DEPOSIT_NOT_APPROVABLE" : "DEPOSIT_APPROVAL_FAILED",
      conflict
        ? "현재 상태에서는 이 요청을 승인할 수 없습니다."
        : "입금 승인을 완료하지 못했습니다.",
      conflict ? 409 : 503,
    );
  }
  return NextResponse.json(
    { data: { ledgerId: data } },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
