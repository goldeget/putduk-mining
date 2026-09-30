/**
 * 회원 출금 한 건의 논리 요청 멱등 키.
 * 서버가 커밋한 뒤 응답만 유실돼도 재시도가 같은 키를 다시 보낸다.
 * 키는 난수다. 계좌번호·주소 원문은 지문 입력으로만 쓰고 저장하지 않는다.
 */

export const WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY =
  "putduk.withdrawal.logical-request.v1";

const OPAQUE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

/** 커밋 전에 거절된 것이 확정된 응답. 이 쌍만 definitive_rejection 이다. */
const DEFINITIVE_REJECTIONS = [
  { status: 400, code: "INVALID_IDEMPOTENCY_KEY" },
  { status: 400, code: "INVALID_WITHDRAWAL_REQUEST" },
  { status: 401, code: "UNAUTHENTICATED" },
  { status: 409, code: "INSUFFICIENT_AVAILABLE_BALANCE" },
] as const;

export type WithdrawalLogicalOutcome =
  "confirmed_success" | "definitive_rejection" | "cancelled" | "uncertain";

export type PersistedWithdrawalLogicalRequest = {
  fingerprint: string;
  key: string;
  v: 1;
};

export type LogicalRequestStore = {
  read(key: string): string | null;
  remove(key: string): void;
  write(key: string, value: string): void;
};

export type WithdrawalDestinationMaterial =
  | {
      accountHolder: string;
      accountNumber: string;
      bankCode: string;
      method: "KRW_BANK";
    }
  | {
      address: string;
      method: "USDT_ADDRESS";
      network: string;
    };

type LogicalIdentity = {
  amountKrw: string;
  destinationRef: string;
  method: string;
  policyId: string;
};

const memoryFallback = new Map<string, string>();

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

/** 새 목적지 재료를 정규화한다. 원문은 반환하지 않고 지문 입력 조각만 만든다. */
export function normalizeWithdrawalDestinationParts(
  material: WithdrawalDestinationMaterial,
) {
  if (material.method === "KRW_BANK") {
    return [
      "KRW_BANK",
      material.bankCode.trim().toUpperCase(),
      material.accountHolder.normalize("NFKC").trim(),
      material.accountNumber.replace(/\D/g, ""),
    ];
  }
  return [
    "USDT_ADDRESS",
    material.network.trim().toUpperCase(),
    material.address.normalize("NFKC").trim(),
  ];
}

export async function fingerprintDestinationMaterial(parts: readonly string[]) {
  return sha256Hex(`putduk.withdrawal.destination.v1:${parts.join("\u001f")}`);
}

export function registeredDestinationRef(destinationId: string) {
  return `registered:${destinationId}`;
}

/** 방법·금액·정책·목적지 지문. 저장되는 값은 이 해시뿐이고 원문이 아니다. */
export async function fingerprintWithdrawalLogicalRequest(
  identity: LogicalIdentity,
) {
  const canonical = [
    identity.method,
    identity.amountKrw,
    identity.policyId,
    identity.destinationRef,
  ].join("\u001f");
  return sha256Hex(`putduk.withdrawal.logical-request.v1:${canonical}`);
}

export function memoryLogicalRequestStore(
  backing = new Map<string, string>(),
): LogicalRequestStore {
  return {
    read: (key) => backing.get(key) ?? null,
    remove: (key) => {
      backing.delete(key);
    },
    write: (key, value) => {
      backing.set(key, value);
    },
  };
}

export function createStorageLogicalRequestStore(
  storage: Pick<Storage, "getItem" | "removeItem" | "setItem"> | null,
  fallback = memoryFallback,
): LogicalRequestStore {
  if (!storage) {
    return memoryLogicalRequestStore(fallback);
  }
  return {
    read(key) {
      try {
        return storage.getItem(key);
      } catch {
        return fallback.get(key) ?? null;
      }
    },
    remove(key) {
      try {
        storage.removeItem(key);
      } catch {
        fallback.delete(key);
      }
    },
    write(key, value) {
      try {
        storage.setItem(key, value);
      } catch {
        fallback.set(key, value);
      }
    },
  };
}

function readSessionStorage() {
  try {
    if (typeof sessionStorage === "undefined") {
      return null;
    }
    const probe = `${WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY}.probe`;
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return sessionStorage;
  } catch {
    return null;
  }
}

/** 탭 세션에만 둔다. 새로고침 뒤 불확실 재시도까지 같은 키를 유지한다. */
export function browserWithdrawalLogicalRequestStore() {
  return createStorageLogicalRequestStore(readSessionStorage());
}

export function parsePersistedWithdrawalLogicalRequest(
  raw: string | null,
): PersistedWithdrawalLogicalRequest | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.v !== 1) {
      return null;
    }
    if (
      typeof record.fingerprint !== "string" ||
      !FINGERPRINT_PATTERN.test(record.fingerprint)
    ) {
      return null;
    }
    if (
      typeof record.key !== "string" ||
      !OPAQUE_KEY_PATTERN.test(record.key)
    ) {
      return null;
    }
    return {
      fingerprint: record.fingerprint,
      key: record.key,
      v: 1,
    };
  } catch {
    return null;
  }
}

export function loadWithdrawalLogicalRequest(store: LogicalRequestStore) {
  return parsePersistedWithdrawalLogicalRequest(
    store.read(WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY),
  );
}

export function saveWithdrawalLogicalRequest(
  store: LogicalRequestStore,
  state: PersistedWithdrawalLogicalRequest | null,
) {
  if (!state) {
    store.remove(WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY);
    return;
  }
  store.write(WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY, JSON.stringify(state));
}

/**
 * 같은 지문이면 기존 키를 재사용한다.
 * 금액·방법·정책·목적지가 바뀌면 새 키를 만든다.
 */
export function decideWithdrawalLogicalKey(
  current: PersistedWithdrawalLogicalRequest | null,
  fingerprint: string,
  createKey: () => string,
): PersistedWithdrawalLogicalRequest {
  if (
    current &&
    current.fingerprint === fingerprint &&
    OPAQUE_KEY_PATTERN.test(current.key)
  ) {
    return current;
  }
  const key = createKey();
  if (!OPAQUE_KEY_PATTERN.test(key)) {
    throw new Error("INVALID_WITHDRAWAL_LOGICAL_KEY");
  }
  return { fingerprint, key, v: 1 };
}

/** 성공·확정 거절·취소만 키를 지운다. 불확실 결과는 그대로 둔다. */
export function settleWithdrawalLogicalRequest(
  current: PersistedWithdrawalLogicalRequest | null,
  outcome: WithdrawalLogicalOutcome,
): PersistedWithdrawalLogicalRequest | null {
  if (outcome === "uncertain") {
    return current;
  }
  return null;
}

export function adoptWithdrawalLogicalKey(
  store: LogicalRequestStore,
  fingerprint: string,
  createKey: () => string = () => crypto.randomUUID(),
) {
  const next = decideWithdrawalLogicalKey(
    loadWithdrawalLogicalRequest(store),
    fingerprint,
    createKey,
  );
  saveWithdrawalLogicalRequest(store, next);
  return next.key;
}

export function finishWithdrawalLogicalKey(
  store: LogicalRequestStore,
  outcome: WithdrawalLogicalOutcome,
) {
  saveWithdrawalLogicalRequest(
    store,
    settleWithdrawalLogicalRequest(
      loadWithdrawalLogicalRequest(store),
      outcome,
    ),
  );
}

function readErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

function readWithdrawalId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") {
    return null;
  }
  const withdrawalId = (data as { withdrawalId?: unknown }).withdrawalId;
  return typeof withdrawalId === "string" && withdrawalId.length > 0
    ? withdrawalId
    : null;
}

/**
 * 응답 본문을 읽지 못했거나 커밋 여부가 불명확하면 uncertain.
 * 5xx·WITHDRAWAL_REQUEST_FAILED 는 커밋 여부를 확정하지 않는다.
 */
export function classifyWithdrawalHoldResponse(input: {
  bodyParsed: boolean;
  ok: boolean;
  payload: unknown;
  status: number;
}): Exclude<WithdrawalLogicalOutcome, "cancelled"> {
  if (!input.bodyParsed) {
    return "uncertain";
  }
  if (input.ok) {
    return readWithdrawalId(input.payload) ? "confirmed_success" : "uncertain";
  }
  const code = readErrorCode(input.payload);
  if (
    code &&
    DEFINITIVE_REJECTIONS.some(
      (item) => item.status === input.status && item.code === code,
    )
  ) {
    return "definitive_rejection";
  }
  return "uncertain";
}
