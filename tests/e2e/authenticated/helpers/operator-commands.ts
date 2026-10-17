import { randomUUID } from "node:crypto";

import { createLocalServiceRoleClient } from "../../fixtures/local-auth";

/**
 * Operator money commands via production RPCs.
 * Browser admin session + step-up UI remains Agent A ownership.
 */
export async function recordKrwExternalSend(input: {
  actorId: string;
  withdrawalId: string;
  bankReference: string;
  actualKrwAmount: number;
  idempotencyKey?: string;
  sentAt?: string;
}) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client.rpc("record_krw_external_send", {
    p_withdrawal_id: input.withdrawalId,
    p_bank_reference: input.bankReference,
    p_actual_krw_amount: input.actualKrwAmount,
    p_actor: input.actorId,
    p_sent_at: input.sentAt ?? new Date().toISOString(),
    p_idempotency_key: input.idempotencyKey ?? `ws05-krw-send-${randomUUID()}`,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

export async function recordUsdtExternalSend(input: {
  actorId: string;
  withdrawalId: string;
  network: "TRC20" | "ERC20" | "BEP20";
  txHash: string;
  actualUsdtAmount: string;
  conversionEvidence?: Record<string, unknown> | null;
  idempotencyKey?: string;
  sentAt?: string;
}) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client.rpc("record_usdt_external_send", {
    p_withdrawal_id: input.withdrawalId,
    p_network: input.network,
    p_tx_hash: input.txHash,
    p_actual_usdt_amount: input.actualUsdtAmount,
    p_conversion_evidence: input.conversionEvidence ?? null,
    p_actor: input.actorId,
    p_sent_at: input.sentAt ?? new Date().toISOString(),
    p_idempotency_key: input.idempotencyKey ?? `ws05-usdt-send-${randomUUID()}`,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

export async function finalizeWithdrawalLedger(input: {
  actorId: string;
  withdrawalId: string;
  idempotencyKey?: string;
}) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client.rpc("finalize_withdrawal_ledger", {
    p_withdrawal_id: input.withdrawalId,
    p_actor: input.actorId,
    p_idempotency_key: input.idempotencyKey ?? `ws05-finalize-${randomUUID()}`,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}

export async function releaseWithdrawalHold(input: {
  actorId: string;
  withdrawalId: string;
  reason: string;
  disposition: "REJECTED" | "CANCELLED";
  idempotencyKey?: string;
}) {
  const client = createLocalServiceRoleClient();
  const { data, error } = await client.rpc("release_withdrawal_hold", {
    p_withdrawal_id: input.withdrawalId,
    p_actor: input.actorId,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey ?? `ws05-release-${randomUUID()}`,
    p_disposition: input.disposition,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as string;
}
