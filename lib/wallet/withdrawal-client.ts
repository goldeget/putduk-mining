"use client";

import {
  classifyWithdrawalHoldResponse,
  finishWithdrawalLogicalKey,
  isWithdrawalLogicalRequestExpired,
  loadWithdrawalLogicalRequest,
  persistWithdrawalLogicalRequest,
  readWithdrawalHoldId,
  validateWithdrawalLogicalRequest,
  withdrawalLogicalStorageKey,
  WithdrawalLogicalSafetyError,
  WITHDRAWAL_RECONCILIATION_COPY,
  type LogicalRequestStore,
  type PersistedWithdrawalLogicalRequest,
  type WithdrawalInputSnapshot,
} from "@/lib/wallet/withdrawal-logical-request";
import {
  memberDestinationRegisterMessage,
  memberWithdrawalSubmitMessage,
} from "@/components/product/member-withdrawal-errors";

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
    : validateWithdrawalLogicalRequest(record, ownerId);
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

export async function recoverWithdrawalLogicalRequest(
  ownerId: string,
  store: LogicalRequestStore,
  fetcher: Fetcher = fetch,
  legacyPresent = false,
  knownKey: string | null = null,
) {
  assertWithdrawalStorageReady(store, ownerId);
  let local: PersistedWithdrawalLogicalRequest | null = null;
  let invalid = false;
  try {
    local = loadWithdrawalLogicalRequest(store, ownerId);
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
    const known = recordOf(await bodyOf(response), ownerId, true);
    if (!known || known.key !== knownKey)
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    if (
      ["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(known.state)
    )
      finishWithdrawalLogicalKey(store, known, ownerId);
    else persistWithdrawalLogicalRequest(store, known, ownerId);
    return known;
  }
  const response = await fetcher(WITHDRAWAL_INTENT_URL, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const server = recordOf(await bodyOf(response), ownerId, true);
  if (server && (!local || server.key === local.key))
    return persistWithdrawalLogicalRequest(store, server, ownerId);
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
    finishWithdrawalLogicalKey(store, terminal, ownerId);
    return terminal; // This attempt resolves the old outcome, NEVER creates new money.
  }
  if (invalid || legacyPresent)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  return null;
}

export async function resolveWithdrawalLogicalRequest(
  ownerId: string,
  store: LogicalRequestStore,
  record: PersistedWithdrawalLogicalRequest,
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
    body: JSON.stringify({ action, withdrawalId }),
  });
  if (!response.ok)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const resolved = recordOf(await bodyOf(response), ownerId)!;
  if (
    resolved.key !== record.key ||
    (action === "CONFIRM" &&
      (resolved.state !== "CONFIRMED" ||
        resolved.withdrawalId !== withdrawalId))
  )
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  if (
    ["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(resolved.state)
  )
    finishWithdrawalLogicalKey(store, resolved, ownerId);
  else persistWithdrawalLogicalRequest(store, resolved, ownerId);
  return resolved;
}

/** The immutable snapshot drives both HTTP mutations; no DOM reads after await. */
export async function submitWithdrawalLogicalRequest(input: {
  ownerId: string;
  store: LogicalRequestStore;
  snapshot: WithdrawalInputSnapshot;
  fetcher?: Fetcher;
  legacyPresent?: boolean;
  knownKey?: string | null;
  onRecord?: (record: PersistedWithdrawalLogicalRequest | null) => void;
}) {
  const { ownerId, store, snapshot, onRecord } = input;
  const fetcher = input.fetcher ?? fetch;
  let record = await recoverWithdrawalLogicalRequest(
    ownerId,
    store,
    fetcher,
    input.legacyPresent,
    input.knownKey,
  );
  if (record?.state === "CONFIRMED") return record;
  if (record && ["CANCELLED", "DEFINITIVELY_REJECTED"].includes(record.state))
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  if (record) {
    if (
      record.method !== snapshot.method ||
      record.amountKrw !== snapshot.amountKrw ||
      record.policyId !== snapshot.policyId ||
      record.policyVersion !== snapshot.policyVersion ||
      (record.destinationId && snapshot.destinationId !== record.destinationId)
    )
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  } else {
    const response = await fetcher(WITHDRAWAL_INTENT_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    const payload = await bodyOf(response);
    if (!response.ok) throw new Error(memberWithdrawalSubmitMessage(payload));
    record = recordOf(payload, ownerId)!;
  }
  onRecord?.(record);
  if (isWithdrawalLogicalRequestExpired(record) && !record.withdrawalId)
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  persistWithdrawalLogicalRequest(store, record, ownerId);
  if (!record.destinationId) {
    if (!snapshot.destination)
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    const response = await fetcher(WITHDRAWAL_DESTINATION_REGISTER_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": record.key,
      },
      body: JSON.stringify(snapshot.destination),
    });
    const payload = await bodyOf(response);
    if (!response.ok)
      throw new Error(memberDestinationRegisterMessage(payload));
    const bound = recordOf(payload, ownerId)!;
    if (
      bound.key !== record.key ||
      bound.destinationIdentity !== record.destinationIdentity ||
      !bound.destinationId
    )
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    record = persistWithdrawalLogicalRequest(store, bound, ownerId);
    onRecord?.(record);
  }
  // Repeat the durability proof immediately before the money command.
  persistWithdrawalLogicalRequest(store, record, ownerId);
  const response = await fetcher(WITHDRAWAL_HOLD_SUBMIT_URL, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": record.key,
    },
    body: JSON.stringify({
      method: record.method,
      destinationId: record.destinationId,
      amountKrw: record.amountKrw,
    }),
  });
  const payload = await bodyOf(response);
  const outcome = classifyWithdrawalHoldResponse({
    bodyParsed: payload !== null,
    ok: response.ok,
    payload,
    status: response.status,
  });
  if (outcome === "confirmed_success") {
    return resolveWithdrawalLogicalRequest(
      ownerId,
      store,
      record,
      "CONFIRM",
      readWithdrawalHoldId(payload),
      fetcher,
    );
  }
  if (outcome === "definitive_rejection") {
    const resolved = await resolveWithdrawalLogicalRequest(
      ownerId,
      store,
      record,
      "REJECT",
      null,
      fetcher,
    );
    if (resolved.withdrawalId) {
      onRecord?.(resolved);
      throw new Error(WITHDRAWAL_RECONCILIATION_COPY);
    }
    onRecord?.(null);
  }
  throw new Error(memberWithdrawalSubmitMessage(payload));
}
