import { WITHDRAWAL_SOURCE_UNAVAILABLE_CODE } from "./withdrawal-source-status";

/** Safe owner-scoped recovery record. Destination material is NEVER persisted. */
export const WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY =
  "putduk.withdrawal.logical-request.v2";
export const LEGACY_WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY =
  "putduk.withdrawal.logical-request.v1";
export const WITHDRAWAL_STORAGE_FAILURE_COPY =
  "출금 요청을 안전하게 저장하지 못했어요. 브라우저 저장 설정을 확인한 뒤 다시 시도해 주세요.";
export const WITHDRAWAL_RECONCILIATION_COPY =
  "이전 출금 요청을 먼저 확인해 주세요. 확인하기 전에는 새 요청을 보내지 않아요.";

export type WithdrawalLogicalState =
  | "PREPARED"
  | "DESTINATION_REGISTERED"
  | "OUTCOME_UNCERTAIN"
  | "CONFIRMED"
  | "DEFINITIVELY_REJECTED"
  | "CANCELLED";

export type PersistedWithdrawalLogicalRequest = Readonly<{
  v: 2;
  ownerId: string;
  key: string;
  method: "KRW_BANK" | "USDT_ADDRESS";
  amountKrw: string;
  policyId: string;
  policyVersion: number;
  destinationIdentity: string;
  destinationId: string | null;
  withdrawalId: string | null;
  state: WithdrawalLogicalState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}>;

export type LogicalRequestStore = {
  read(key: string): string | null;
  remove(key: string): void;
  write(key: string, value: string): void;
};

export type WithdrawalDestinationMaterial =
  | {
      method: "KRW_BANK";
      accountHolder: string;
      accountNumber: string;
      bankCode: string;
    }
  | { method: "USDT_ADDRESS"; address: string; network: string };

export type WithdrawalInputSnapshot = Readonly<{
  method: "KRW_BANK" | "USDT_ADDRESS";
  amountKrw: string;
  policyId: string;
  policyVersion: number;
  destinationId: string | null;
  destination: Readonly<WithdrawalDestinationMaterial> | null;
}>;

/** Called synchronously BEFORE pending/disabled/await. No later FormData reads. */
export function snapshotWithdrawalInput(
  form: HTMLFormElement,
  input: {
    method: "KRW_BANK" | "USDT_ADDRESS";
    amountKrw: string;
    policyId: string;
    policyVersion: number;
    destinationId: string | null;
  },
): WithdrawalInputSnapshot {
  const data = new FormData(form);
  const destination = input.destinationId
    ? null
    : input.method === "KRW_BANK"
      ? {
          method: "KRW_BANK" as const,
          accountHolder: String(data.get("accountHolder") ?? ""),
          accountNumber: String(data.get("accountNumber") ?? ""),
          bankCode: String(data.get("bankCode") ?? ""),
        }
      : {
          method: "USDT_ADDRESS" as const,
          address: String(data.get("address") ?? ""),
          network: String(data.get("network") ?? ""),
        };
  return Object.freeze({
    ...input,
    destination: destination ? Object.freeze(destination) : null,
  });
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/;
const FINGERPRINT = /^[a-f0-9]{64}$/;
const STATES: readonly string[] = [
  "PREPARED",
  "DESTINATION_REGISTERED",
  "OUTCOME_UNCERTAIN",
  "CONFIRMED",
  "DEFINITIVELY_REJECTED",
  "CANCELLED",
];
const FIELDS = [
  "v",
  "ownerId",
  "key",
  "method",
  "amountKrw",
  "policyId",
  "policyVersion",
  "destinationIdentity",
  "destinationId",
  "withdrawalId",
  "state",
  "createdAt",
  "updatedAt",
  "expiresAt",
];

export class WithdrawalLogicalSafetyError extends Error {
  constructor(
    public readonly code: "STORAGE_UNAVAILABLE" | "RECONCILIATION_REQUIRED",
  ) {
    super(
      code === "STORAGE_UNAVAILABLE"
        ? WITHDRAWAL_STORAGE_FAILURE_COPY
        : WITHDRAWAL_RECONCILIATION_COPY,
    );
  }
}

function unsafe(): never {
  throw new WithdrawalLogicalSafetyError("RECONCILIATION_REQUIRED");
}

export function validateWithdrawalLogicalRequest(
  value: unknown,
  ownerId: string,
): PersistedWithdrawalLogicalRequest {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return unsafe();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== FIELDS.length ||
    FIELDS.some((field) => !Object.hasOwn(record, field)) ||
    Object.keys(record).some((field) => !FIELDS.includes(field))
  )
    return unsafe();
  if (
    record.v !== 2 ||
    record.ownerId !== ownerId ||
    !UUID.test(ownerId) ||
    typeof record.key !== "string" ||
    !KEY.test(record.key) ||
    !["KRW_BANK", "USDT_ADDRESS"].includes(String(record.method)) ||
    typeof record.amountKrw !== "string" ||
    !/^[1-9][0-9]{0,14}$/.test(record.amountKrw) ||
    typeof record.policyId !== "string" ||
    !UUID.test(record.policyId) ||
    !Number.isSafeInteger(record.policyVersion) ||
    Number(record.policyVersion) < 1 ||
    typeof record.destinationIdentity !== "string" ||
    !FINGERPRINT.test(record.destinationIdentity) ||
    (record.destinationId !== null &&
      (typeof record.destinationId !== "string" ||
        !UUID.test(record.destinationId))) ||
    (record.withdrawalId !== null &&
      (typeof record.withdrawalId !== "string" ||
        !UUID.test(record.withdrawalId))) ||
    !STATES.includes(String(record.state))
  )
    return unsafe();
  const dates = [record.createdAt, record.updatedAt, record.expiresAt];
  if (
    dates.some(
      (date) =>
        typeof date !== "string" ||
        !/^\d{4}-\d\d-\d\dT/.test(date) ||
        !Number.isFinite(Date.parse(date)),
    )
  )
    return unsafe();
  if (
    Date.parse(String(record.createdAt)) >
      Date.parse(String(record.updatedAt)) ||
    Date.parse(String(record.expiresAt)) <= Date.parse(String(record.createdAt))
  )
    return unsafe();
  if (
    ["DESTINATION_REGISTERED", "OUTCOME_UNCERTAIN", "CONFIRMED"].includes(
      String(record.state),
    ) &&
    !record.destinationId
  )
    return unsafe();
  if (
    ["OUTCOME_UNCERTAIN", "CONFIRMED"].includes(String(record.state)) &&
    !record.withdrawalId
  )
    return unsafe();
  return Object.freeze({ ...record }) as PersistedWithdrawalLogicalRequest;
}

/** Expiry never deletes a key. The caller must reconcile with the server. */
export function isWithdrawalLogicalRequestExpired(
  record: PersistedWithdrawalLogicalRequest,
  now = Date.now(),
) {
  return Date.parse(record.expiresAt) <= now;
}

export function parsePersistedWithdrawalLogicalRequest(
  raw: string | null,
  ownerId: string,
) {
  if (raw === null) return null;
  try {
    return validateWithdrawalLogicalRequest(
      JSON.parse(raw) as unknown,
      ownerId,
    );
  } catch {
    return unsafe();
  }
}

export function withdrawalLogicalStorageKey(ownerId: string) {
  if (!UUID.test(ownerId)) return unsafe();
  return `${WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY}:${ownerId}`;
}

/** There is deliberately NO memory fallback for money commands. */
export function createStorageLogicalRequestStore(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem"> | null,
): LogicalRequestStore {
  const fail = (): never => {
    throw new WithdrawalLogicalSafetyError("STORAGE_UNAVAILABLE");
  };
  return {
    read(key) {
      try {
        return storage ? storage.getItem(key) : fail();
      } catch {
        return fail();
      }
    },
    remove(key) {
      try {
        if (!storage) return fail();
        storage.removeItem(key);
      } catch {
        return fail();
      }
    },
    write(key, value) {
      try {
        if (!storage) return fail();
        storage.setItem(key, value);
      } catch {
        return fail();
      }
    },
  };
}

export function browserWithdrawalLogicalRequestStore() {
  try {
    return createStorageLogicalRequestStore(window.localStorage);
  } catch {
    return createStorageLogicalRequestStore(null);
  }
}

export function loadWithdrawalLogicalRequest(
  store: LogicalRequestStore,
  ownerId: string,
) {
  return parsePersistedWithdrawalLogicalRequest(
    store.read(withdrawalLogicalStorageKey(ownerId)),
    ownerId,
  );
}

/** Write + exact read-back proof, required before EACH destination/money mutation. */
export function persistWithdrawalLogicalRequest(
  store: LogicalRequestStore,
  record: PersistedWithdrawalLogicalRequest,
  ownerId: string,
) {
  const validated = validateWithdrawalLogicalRequest(record, ownerId);
  const key = withdrawalLogicalStorageKey(ownerId);
  const serialized = JSON.stringify(validated);
  store.write(key, serialized);
  if (store.read(key) !== serialized)
    throw new WithdrawalLogicalSafetyError("STORAGE_UNAVAILABLE");
  return validated;
}

/** Clear only the acknowledged terminal key, never another tab's newer intent. */
export function finishWithdrawalLogicalKey(
  store: LogicalRequestStore,
  record: PersistedWithdrawalLogicalRequest,
  ownerId: string,
) {
  if (
    !["CONFIRMED", "CANCELLED", "DEFINITIVELY_REJECTED"].includes(record.state)
  )
    return;
  const current = loadWithdrawalLogicalRequest(store, ownerId);
  if (current?.key === record.key)
    store.remove(withdrawalLogicalStorageKey(ownerId));
}

function readErrorCode(payload: unknown) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Object.hasOwn(payload, "error")
  )
    return null;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object" || !Object.hasOwn(error, "code"))
    return null;
  return (error as { code?: unknown }).code;
}

export function readWithdrawalHoldId(payload: unknown) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Object.hasOwn(payload, "data")
  )
    return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object" || !Object.hasOwn(data, "withdrawalId"))
    return null;
  const id = (data as { withdrawalId?: unknown }).withdrawalId;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

export type WithdrawalLogicalOutcome =
  "confirmed_success" | "definitive_rejection" | "uncertain";

/** A rejection may retire a key only AFTER serialized server reconciliation. */
export function classifyWithdrawalHoldResponse(input: {
  bodyParsed: boolean;
  ok: boolean;
  payload: unknown;
  status: number;
}): WithdrawalLogicalOutcome {
  if (!input.bodyParsed) return "uncertain";
  if (input.ok)
    return readWithdrawalHoldId(input.payload)
      ? "confirmed_success"
      : "uncertain";
  const pairs = [
    [400, "INVALID_IDEMPOTENCY_KEY"],
    [400, "INVALID_WITHDRAWAL_REQUEST"],
    [401, "UNAUTHENTICATED"],
    [409, "INSUFFICIENT_AVAILABLE_BALANCE"],
    [409, WITHDRAWAL_SOURCE_UNAVAILABLE_CODE],
  ] as const;
  return pairs.some(
    ([status, code]) =>
      status === input.status && code === readErrorCode(input.payload),
  )
    ? "definitive_rejection"
    : "uncertain";
}
