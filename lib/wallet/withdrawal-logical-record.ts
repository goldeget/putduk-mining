import {
  validateWithdrawalLogicalRequest,
  withdrawalLogicalStorageKey,
  WithdrawalLogicalSafetyError,
  type LogicalRequestStore,
  type PersistedWithdrawalLogicalRequest,
} from "./withdrawal-logical-request";
import {
  validatePrincipalWithdrawalLogicalRequest,
  type PrincipalWithdrawalLogicalRequest,
} from "./principal-withdrawal-logical-request";

export type WithdrawalLogicalRecord =
  PersistedWithdrawalLogicalRequest | PrincipalWithdrawalLogicalRequest;

export function validateWithdrawalLogicalRecord(
  value: unknown,
  ownerId: string,
): WithdrawalLogicalRecord {
  return value && typeof value === "object" && "v" in value && value.v === 3
    ? validatePrincipalWithdrawalLogicalRequest(value, ownerId)
    : validateWithdrawalLogicalRequest(value, ownerId);
}

export function sameWithdrawalLogicalOriginal(
  left: WithdrawalLogicalRecord,
  right: WithdrawalLogicalRecord,
) {
  return (
    left.v === right.v &&
    left.ownerId === right.ownerId &&
    left.key === right.key &&
    left.method === right.method &&
    left.amountKrw === right.amountKrw &&
    left.policyId === right.policyId &&
    left.policyVersion === right.policyVersion &&
    left.destinationIdentity === right.destinationIdentity &&
    (!left.destinationId || left.destinationId === right.destinationId) &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt &&
    (!left.withdrawalId || left.withdrawalId === right.withdrawalId) &&
    (left.v !== 3 ||
      (right.v === 3 &&
        left.source.confirmationId === right.source.confirmationId))
  );
}

/** One owner slot across both versions; never create parallel source intents. */
export function loadWithdrawalLogicalRecord(
  store: LogicalRequestStore,
  ownerId: string,
) {
  const raw = store.read(withdrawalLogicalStorageKey(ownerId));
  if (raw === null) return null;
  try {
    return validateWithdrawalLogicalRecord(JSON.parse(raw), ownerId);
  } catch {
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  }
}

export function persistWithdrawalLogicalRecord(
  store: LogicalRequestStore,
  record: WithdrawalLogicalRecord,
  ownerId: string,
) {
  const validated = validateWithdrawalLogicalRecord(record, ownerId);
  const local = loadWithdrawalLogicalRecord(store, ownerId);
  if (
    local &&
    (local.key !== validated.key ||
      !sameWithdrawalLogicalOriginal(local, validated))
  )
    throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
  const key = withdrawalLogicalStorageKey(ownerId);
  const serialized = JSON.stringify(validated);
  store.write(key, serialized);
  if (store.read(key) !== serialized)
    throw new WithdrawalLogicalSafetyError("STORAGE_UNAVAILABLE");
  return validated;
}

export function finishWithdrawalLogicalRecord(
  store: LogicalRequestStore,
  record: WithdrawalLogicalRecord,
  ownerId: string,
) {
  const validated = validateWithdrawalLogicalRecord(record, ownerId);
  if (
    !["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(
      validated.state,
    )
  )
    return;
  const current = loadWithdrawalLogicalRecord(store, ownerId);
  if (current?.key === validated.key) {
    if (!sameWithdrawalLogicalOriginal(current, validated))
      throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
    store.remove(withdrawalLogicalStorageKey(ownerId));
  }
}
