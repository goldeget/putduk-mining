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

async function closeProtectedUncommittedIntent(
  payload: unknown,
  record: PersistedWithdrawalLogicalRequest | null,
  ownerId: string,
  store: LogicalRequestStore,
  fetcher: Fetcher,
) {
  const protectedDestination =
    payload && typeof payload === "object" && Object.hasOwn(payload, "data")
      ? (payload as { data: { protectionActive?: unknown } }).data
      : null;
  if (
    record?.destinationId &&
    !record.withdrawalId &&
    !["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(
      record.state,
    ) &&
    protectedDestination?.protectionActive === true
  ) {
    persistWithdrawalLogicalRequest(store, record, ownerId);
    // The serialized server resolution rechecks actual money. A competing hold
    // can return OUTCOME_UNCERTAIN; never replace that outcome with cancellation.
    return resolveWithdrawalLogicalRequest(
      ownerId,
      store,
      record,
      "CANCEL",
      null,
      fetcher,
    );
  }
  return record;
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
    const payload = await bodyOf(response);
    let known = recordOf(payload, ownerId, true);
    if (!known || known.key !== knownKey)
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    known = (await closeProtectedUncommittedIntent(
      payload,
      known,
      ownerId,
      store,
      fetcher,
    ))!;
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
  const payload = await bodyOf(response);
  const server = recordOf(payload, ownerId, true);
  if (server && (!local || server.key === local.key)) {
    const resolved = (await closeProtectedUncommittedIntent(
      payload,
      server,
      ownerId,
      store,
      fetcher,
    ))!;
    if (
      ["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(
        resolved.state,
      )
    )
      finishWithdrawalLogicalKey(store, resolved, ownerId);
    else persistWithdrawalLogicalRequest(store, resolved, ownerId);
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
  // Transient credential input only. Never part of the logical snapshot/store.
  destinationReauth?: { password: string; totpCode?: string } | undefined;
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
    let proof: string | null = null;
    if (input.destinationReauth) {
      const reauthResponse = await fetcher(
        `${WITHDRAWAL_DESTINATION_REGISTER_URL}/reauth`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: snapshot.destination,
            ...input.destinationReauth,
          }),
        },
      );
      const result = await bodyOf(reauthResponse);
      if (!reauthResponse.ok)
        throw new Error(memberDestinationRegisterMessage(result));
      const candidate =
        result && typeof result === "object" && Object.hasOwn(result, "data")
          ? (result as { data: unknown }).data
          : null;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        !Object.hasOwn(candidate, "token") ||
        !Object.hasOwn(candidate, "expiresAt")
      )
        throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
      const value = candidate as { token: unknown; expiresAt: unknown };
      if (
        typeof value.token !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
        typeof value.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(value.expiresAt)) ||
        Date.parse(value.expiresAt) <= Date.now()
      )
        throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
      proof = value.token;
    }
    const response = await fetcher(WITHDRAWAL_DESTINATION_REGISTER_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": record.key,
        ...(proof ? { "Withdrawal-Reauth": proof } : {}),
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
    const data = (payload as { data: { protectionActive?: unknown } }).data;
    if (data.protectionActive === true) {
      // Replacement is complete, but cannot hold money during the protection
      // window. Close only the uncommitted intent after server reconciliation.
      const cancelled = await resolveWithdrawalLogicalRequest(
        ownerId,
        store,
        record,
        "CANCEL",
        null,
        fetcher,
      );
      if (cancelled.state !== "CANCELLED" || cancelled.withdrawalId)
        throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
      onRecord?.(null);
      return cancelled;
    }
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
