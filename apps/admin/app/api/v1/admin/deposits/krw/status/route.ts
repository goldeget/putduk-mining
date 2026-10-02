import { NextResponse } from "next/server";
import { z } from "zod";

import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { krwDepositJournalIdempotencyKey } from "@/lib/deposits/krw-approve-state";
import { loadKrwDepositReceipt } from "@/lib/deposits/krw-queue";
import { parseLogicalOperationKey } from "@/lib/money/logical-operation";
import { createAdminServiceClient } from "@/lib/supabase/service";

const bodySchema = z
  .object({
    depositRequestId: z.uuid(),
    logicalOperationKey: z.string().trim().min(8).max(180),
  })
  .strict();

export const dynamic = "force-dynamic";

function jsonError(code: string, message: string, status: number) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}

/**
 * 이 논리 작업 키로 기록된 분개 id만 찾는다.
 * 계좌나 주소는 조회하지 않는다.
 */
async function linkedLedgerTransactionId(
  depositRequestId: string,
  logicalOperationKey: string,
): Promise<string | null> {
  const journalKey = krwDepositJournalIdempotencyKey(logicalOperationKey);
  const { data, error } = await createAdminServiceClient()
    .from("ledger_transactions")
    .select("id, reference_id, reference_type")
    .eq("idempotency_key", journalKey)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id?: unknown;
    reference_id?: unknown;
    reference_type?: unknown;
  };
  if (row.reference_type !== "deposit_request") return null;
  if (row.reference_id !== depositRequestId) return null;
  return typeof row.id === "string" ? row.id : null;
}

export async function POST(request: Request) {
  const access = await requireAdminCommand(request, HIGH_IMPACT_ROLES);
  if (!access.ok) {
    return jsonError(
      access.code,
      "이 작업을 실행할 수 없습니다.",
      access.status,
    );
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(
      "INVALID_APPROVAL_REQUEST",
      "입금 요청을 확인해 주세요.",
      400,
    );
  }
  const logicalKey = parseLogicalOperationKey(parsed.data.logicalOperationKey);
  if (!logicalKey) {
    return jsonError(
      "INVALID_APPROVAL_REQUEST",
      "입금 요청을 확인해 주세요.",
      400,
    );
  }
  const receipt = await loadKrwDepositReceipt(parsed.data.depositRequestId);
  if (!receipt) {
    return jsonError(
      "DEPOSIT_NOT_APPROVABLE",
      "입금 상태를 확인하지 못했습니다.",
      404,
    );
  }
  const linked = await linkedLedgerTransactionId(
    parsed.data.depositRequestId,
    logicalKey,
  );
  return NextResponse.json(
    {
      data: {
        ...receipt,
        logicalOperationKey: logicalKey,
        linkedLedgerTransactionId: linked,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
