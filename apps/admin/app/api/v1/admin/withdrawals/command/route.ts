import { randomUUID } from "node:crypto";
import { z } from "zod";

import { HIGH_IMPACT_ROLES } from "@/lib/auth/policy";
import { requireAdminCommand } from "@/lib/auth/principal";
import { consumeAdminStepUpGrant } from "@/lib/auth/step-up";
import { requestDeclaredOffline } from "@/lib/money/logical-operation";
import { createAdminServiceClient } from "@/lib/supabase/service";

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("RECORD_KRW_SEND"),
      withdrawalId: z.string().uuid(),
      bankReference: z.string().trim().min(4).max(200),
      actualKrwAmount: z.string().regex(/^[1-9][0-9]{0,14}$/),
      sentAt: z.string().datetime(),
      stepUpToken: z.string().min(16),
      idempotencyKey: z.string().min(8).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal("RECORD_USDT_SEND"),
      withdrawalId: z.string().uuid(),
      network: z.enum(["TRC20", "ERC20", "BEP20"]),
      txHash: z.string().trim().min(8).max(128),
      actualUsdtAmount: z.string().regex(/^[0-9]+(\.[0-9]{1,6})?$/),
      conversionEvidence: z.record(z.string(), z.unknown()).optional(),
      sentAt: z.string().datetime(),
      stepUpToken: z.string().min(16),
      idempotencyKey: z.string().min(8).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal("FINALIZE_LEDGER"),
      withdrawalId: z.string().uuid(),
      stepUpToken: z.string().min(16),
      idempotencyKey: z.string().min(8).max(200),
    })
    .strict(),
  z
    .object({
      action: z.literal("RELEASE_HOLD"),
      withdrawalId: z.string().uuid(),
      reason: z.string().trim().min(4).max(500),
      disposition: z.enum(["REJECTED", "CANCELLED"]),
      stepUpToken: z.string().min(16),
      idempotencyKey: z.string().min(8).max(200),
    })
    .strict(),
]);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await requireAdminCommand(request, HIGH_IMPACT_ROLES);
  if (!access.ok) {
    return Response.json(
      { ok: false, code: access.code },
      { status: access.status },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { ok: false, code: "INVALID_COMMAND" },
      { status: 400 },
    );
  }
  if (requestDeclaredOffline(request)) {
    return Response.json(
      { ok: false, code: "OFFLINE_BLOCKED" },
      { status: 409 },
    );
  }

  const requestId = randomUUID();
  const stepUpOk = await consumeAdminStepUpGrant({
    userId: access.principal.userId,
    adminSessionId: access.principal.adminSessionId,
    token: parsed.data.stepUpToken,
    commandFamily: "WITHDRAWAL_OPERATOR",
    requestId,
  });
  if (!stepUpOk) {
    return Response.json(
      { ok: false, code: "STEP_UP_REQUIRED" },
      { status: 403 },
    );
  }

  const db = createAdminServiceClient();
  const body = parsed.data;

  if (body.action === "RECORD_KRW_SEND") {
    const { data, error } = await db.rpc("record_krw_external_send", {
      p_withdrawal_id: body.withdrawalId,
      p_bank_reference: body.bankReference,
      p_actual_krw_amount: body.actualKrwAmount,
      p_actor: access.principal.userId,
      p_sent_at: body.sentAt,
      p_idempotency_key: body.idempotencyKey,
    });
    if (error) {
      return Response.json(
        { ok: false, code: "COMMAND_FAILED" },
        { status: 503 },
      );
    }
    return Response.json({ ok: true, sendId: data }, { status: 200 });
  }

  if (body.action === "RECORD_USDT_SEND") {
    const { data, error } = await db.rpc("record_usdt_external_send", {
      p_withdrawal_id: body.withdrawalId,
      p_network: body.network,
      p_tx_hash: body.txHash,
      p_actual_usdt_amount: body.actualUsdtAmount,
      p_conversion_evidence: body.conversionEvidence ?? null,
      p_actor: access.principal.userId,
      p_sent_at: body.sentAt,
      p_idempotency_key: body.idempotencyKey,
    });
    if (error) {
      return Response.json(
        { ok: false, code: "COMMAND_FAILED" },
        { status: 503 },
      );
    }
    return Response.json({ ok: true, sendId: data }, { status: 200 });
  }

  if (body.action === "FINALIZE_LEDGER") {
    const { data, error } = await db.rpc("finalize_withdrawal_ledger", {
      p_withdrawal_id: body.withdrawalId,
      p_actor: access.principal.userId,
      p_idempotency_key: body.idempotencyKey,
    });
    if (error) {
      return Response.json(
        { ok: false, code: "COMMAND_FAILED" },
        { status: 503 },
      );
    }
    return Response.json(
      { ok: true, ledgerTransactionId: data },
      { status: 200 },
    );
  }

  const { data, error } = await db.rpc("release_withdrawal_hold", {
    p_withdrawal_id: body.withdrawalId,
    p_actor: access.principal.userId,
    p_reason: body.reason,
    p_idempotency_key: body.idempotencyKey,
    p_disposition: body.disposition,
  });
  if (error) {
    return Response.json(
      { ok: false, code: "COMMAND_FAILED" },
      { status: 503 },
    );
  }
  return Response.json(
    {
      ok: true,
      releaseLedgerTransactionId: data,
      disposition: body.disposition,
    },
    { status: 200 },
  );
}
