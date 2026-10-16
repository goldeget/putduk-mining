"use client";

import {
  withdrawalLogicalStorageKey,
  WithdrawalLogicalSafetyError,
  type LogicalRequestStore,
} from "@/lib/wallet/withdrawal-logical-request";
import {
  finishWithdrawalLogicalRecord,
  loadWithdrawalLogicalRecord,
  persistWithdrawalLogicalRecord,
  validateWithdrawalLogicalRecord,
  sameWithdrawalLogicalOriginal,
  type WithdrawalLogicalRecord,
} from "@/lib/wallet/withdrawal-logical-record";

export const WITHDRAWAL_INTENT_URL = "/api/v1/withdrawals/intents";
export const WITHDRAWAL_HOLD_SUBMIT_URL = "/api/v1/withdrawals/hold";
export const WITHDRAWAL_DESTINATION_REGISTER_URL =
  "/api/v1/withdrawals/destinations";
type Fetcher = typeof fetch;

async function bodyOf(response: Response) {
  return response.json().catch(() => null) as Promise<unknown>;
}

function recordOf(payload: unknown, ownerId: string, nullable = false) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Object.hasOwn(payload, "data")
  )
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const data = (payload as { data: unknown }).data;
  if (!data || typeof data !== "object" || !Object.hasOwn(data, "record"))
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const record = (data as { record: unknown }).record;
  return record === null && nullable
    ? null
    : validateWithdrawalLogicalRecord(record, ownerId);
}

export function assertWithdrawalStorageReady(
  store: LogicalRequestStore,
  ownerId: string,
) {
  const key = `${withdrawalLogicalStorageKey(ownerId)}.probe`;
  store.write(key, "durability-check-v2");
  if (store.read(key) !== "durability-check-v2")
    throw new WithdrawalLogicalSafetyError("STORAGE_UNAVAILABLE");
  store.remove(key);
}

export async function recoverWithdrawalLogicalRecord(
  ownerId: string,
  store: LogicalRequestStore,
  fetcher: Fetcher = fetch,
  legacyPresent = false,
  knownKey: string | null = null,
) {
  assertWithdrawalStorageReady(store, ownerId);
  let local: WithdrawalLogicalRecord | null = null;
  let invalid = false;
  try {
    local = loadWithdrawalLogicalRecord(store, ownerId);
  } catch (error) {
    if (
      error instanceof WithdrawalLogicalSafetyError &&
      error.code === "RECONCILIATION_REQUIRED"
    )
      invalid = true;
    else throw error;
  }
  // An already-open tab keeps its reconciliation pointer even when another tab
  // acknowledges and clears shared storage. Memory NEVER authorizes a mutation.
  if (knownKey) {
    const response = await fetcher(WITHDRAWAL_INTENT_URL, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Idempotency-Key": knownKey },
    });
    if (!response.ok)
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    const payload = await bodyOf(response);
    const known = recordOf(payload, ownerId, true);
    if (!known || known.key !== knownKey)
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    if (
      ["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(known.state)
    )
      finishWithdrawalLogicalRecord(store, known, ownerId);
    else persistWithdrawalLogicalRecord(store, known, ownerId);
    return known;
  }
  const response = await fetcher(WITHDRAWAL_INTENT_URL, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const payload = await bodyOf(response);
  const server = recordOf(payload, ownerId, true);
  if (server && (!local || server.key === local.key)) {
    const resolved = server;
    if (
      ["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(
        resolved.state,
      )
    )
      finishWithdrawalLogicalRecord(store, resolved, ownerId);
    else persistWithdrawalLogicalRecord(store, resolved, ownerId);
    return resolved;
  }
  if (local) {
    const resolved = await fetcher(WITHDRAWAL_INTENT_URL, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Idempotency-Key": local.key },
    });
    if (!resolved.ok)
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    const terminal = recordOf(await bodyOf(resolved), ownerId, true);
    if (
      !terminal ||
      terminal.key !== local.key ||
      !["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(
        terminal.state,
      )
    )
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    finishWithdrawalLogicalRecord(store, terminal, ownerId);
    return terminal; // This attempt resolves the old outcome, NEVER creates new money.
  }
  if (invalid || legacyPresent)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  return null;
}

export async function resolveWithdrawalLogicalRecord(
  ownerId: string,
  store: LogicalRequestStore,
  record: WithdrawalLogicalRecord,
  action: "CONFIRM" | "CANCEL" | "REJECT",
  withdrawalId: string | null = null,
  fetcher: Fetcher = fetch,
) {
  const response = await fetcher(WITHDRAWAL_INTENT_URL, {
    method: "PATCH",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": record.key,
    },
    body: JSON.stringify({
      action,
      withdrawalId,
      ...(record.v === 3
        ? { recordVersion: 3, confirmationId: record.source.confirmationId }
        : {}),
    }),
  });
  if (!response.ok)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const resolved = recordOf(await bodyOf(response), ownerId)!;
  if (
    !sameWithdrawalLogicalOriginal(record, resolved) ||
    (action === "CONFIRM" &&
      (resolved.state !== "CONFIRMED" ||
        resolved.withdrawalId !== withdrawalId))
  )
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  if (
    ["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(resolved.state)
  )
    finishWithdrawalLogicalRecord(store, resolved, ownerId);
  else persistWithdrawalLogicalRecord(store, resolved, ownerId);
  return resolved;
}
