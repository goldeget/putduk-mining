import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  adoptWithdrawalLogicalKey,
  classifyWithdrawalHoldResponse,
  createStorageLogicalRequestStore,
  decideWithdrawalLogicalKey,
  fingerprintDestinationMaterial,
  fingerprintWithdrawalLogicalRequest,
  finishWithdrawalLogicalKey,
  memoryLogicalRequestStore,
  normalizeWithdrawalDestinationParts,
  parsePersistedWithdrawalLogicalRequest,
  registeredDestinationRef,
  saveWithdrawalLogicalRequest,
  settleWithdrawalLogicalRequest,
  WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY,
  type PersistedWithdrawalLogicalRequest,
} from "@/lib/wallet/withdrawal-logical-request";

const FINGERPRINT = "a".repeat(64);
const OTHER_FINGERPRINT = "b".repeat(64);
const KEY = "11111111-1111-4111-8111-111111111111";
const NEXT_KEY = "22222222-2222-4222-8222-222222222222";

function persisted(
  fingerprint = FINGERPRINT,
  key = KEY,
): PersistedWithdrawalLogicalRequest {
  return { fingerprint, key, v: 1 };
}

async function identityFingerprint(amountKrw: string) {
  return fingerprintWithdrawalLogicalRequest({
    amountKrw,
    destinationRef: registeredDestinationRef(
      "6f0b4d2a-7c1e-4a55-9d10-0b6e2f4a8c31",
    ),
    method: "KRW_BANK",
    policyId: "policy-krw",
  });
}

describe("출금 논리 요청 멱등 키", () => {
  it("불확실한 실패 뒤에도 같은 지문이면 같은 키를 유지한다", () => {
    const store = memoryLogicalRequestStore();
    const keys = [KEY, NEXT_KEY];
    const first = adoptWithdrawalLogicalKey(
      store,
      FINGERPRINT,
      () => keys.shift() ?? "unused-key-should-not-run",
    );
    finishWithdrawalLogicalKey(store, "uncertain");
    const second = adoptWithdrawalLogicalKey(
      store,
      FINGERPRINT,
      () => keys.shift() ?? "unused-key-should-not-run",
    );

    expect(first).toBe(KEY);
    expect(second).toBe(KEY);
    expect(keys).toEqual([NEXT_KEY]);
  });

  it("응답 본문을 읽지 못하면 키를 유지한다", () => {
    const store = memoryLogicalRequestStore();
    adoptWithdrawalLogicalKey(store, FINGERPRINT, () => KEY);
    const outcome = classifyWithdrawalHoldResponse({
      bodyParsed: false,
      ok: true,
      payload: null,
      status: 201,
    });
    finishWithdrawalLogicalKey(store, outcome);

    expect(outcome).toBe("uncertain");
    expect(adoptWithdrawalLogicalKey(store, FINGERPRINT, () => NEXT_KEY)).toBe(
      KEY,
    );
  });

  it("네트워크 단절에 해당하는 불확실 결과로는 키를 바꾸지 않는다", () => {
    const current = persisted();
    expect(settleWithdrawalLogicalRequest(current, "uncertain")).toEqual(
      current,
    );
  });

  it("확인된 성공 뒤에만 같은 요청도 새 키를 받는다", () => {
    const store = memoryLogicalRequestStore();
    adoptWithdrawalLogicalKey(store, FINGERPRINT, () => KEY);
    const outcome = classifyWithdrawalHoldResponse({
      bodyParsed: true,
      ok: true,
      payload: { data: { withdrawalId: "wd-1" } },
      status: 201,
    });
    finishWithdrawalLogicalKey(store, outcome);

    expect(outcome).toBe("confirmed_success");
    expect(adoptWithdrawalLogicalKey(store, FINGERPRINT, () => NEXT_KEY)).toBe(
      NEXT_KEY,
    );
  });

  it("확정된 미커밋 거절 뒤에 새 키를 만든다", () => {
    const store = memoryLogicalRequestStore();
    adoptWithdrawalLogicalKey(store, FINGERPRINT, () => KEY);
    const outcome = classifyWithdrawalHoldResponse({
      bodyParsed: true,
      ok: false,
      payload: { error: { code: "INSUFFICIENT_AVAILABLE_BALANCE" } },
      status: 409,
    });
    finishWithdrawalLogicalKey(store, outcome);

    expect(outcome).toBe("definitive_rejection");
    expect(adoptWithdrawalLogicalKey(store, FINGERPRINT, () => NEXT_KEY)).toBe(
      NEXT_KEY,
    );
  });

  it("요청 본문 거절과 인증 거절도 확정 거절로 본다", () => {
    expect(
      classifyWithdrawalHoldResponse({
        bodyParsed: true,
        ok: false,
        payload: { error: { code: "INVALID_WITHDRAWAL_REQUEST" } },
        status: 400,
      }),
    ).toBe("definitive_rejection");
    expect(
      classifyWithdrawalHoldResponse({
        bodyParsed: true,
        ok: false,
        payload: { error: { code: "INVALID_IDEMPOTENCY_KEY" } },
        status: 400,
      }),
    ).toBe("definitive_rejection");
    expect(
      classifyWithdrawalHoldResponse({
        bodyParsed: true,
        ok: false,
        payload: { error: { code: "UNAUTHENTICATED" } },
        status: 401,
      }),
    ).toBe("definitive_rejection");
  });

  it("취소·재설정 뒤에는 같은 지문이어도 새 키를 만든다", () => {
    const store = memoryLogicalRequestStore();
    adoptWithdrawalLogicalKey(store, FINGERPRINT, () => KEY);
    finishWithdrawalLogicalKey(store, "cancelled");

    expect(adoptWithdrawalLogicalKey(store, FINGERPRINT, () => NEXT_KEY)).toBe(
      NEXT_KEY,
    );
  });

  it("금액 등 요청 재료가 바뀌면 새 키를 만든다", async () => {
    const store = memoryLogicalRequestStore();
    const firstFingerprint = await identityFingerprint("1000");
    const secondFingerprint = await identityFingerprint("2000");
    adoptWithdrawalLogicalKey(store, firstFingerprint, () => KEY);

    expect(firstFingerprint).not.toBe(secondFingerprint);
    expect(
      adoptWithdrawalLogicalKey(store, secondFingerprint, () => NEXT_KEY),
    ).toBe(NEXT_KEY);
  });

  it("5xx 와 알 수 없는 실패는 커밋 불명으로 보고 키를 유지한다", () => {
    const store = memoryLogicalRequestStore();
    adoptWithdrawalLogicalKey(store, FINGERPRINT, () => KEY);
    const outcome = classifyWithdrawalHoldResponse({
      bodyParsed: true,
      ok: false,
      payload: {
        error: {
          code: "WITHDRAWAL_REQUEST_FAILED",
          message: "relation withdrawal_requests does not exist",
        },
      },
      status: 503,
    });
    finishWithdrawalLogicalKey(store, outcome);

    expect(outcome).toBe("uncertain");
    expect(adoptWithdrawalLogicalKey(store, FINGERPRINT, () => NEXT_KEY)).toBe(
      KEY,
    );
    expect(
      classifyWithdrawalHoldResponse({
        bodyParsed: true,
        ok: false,
        payload: { error: { code: "INSUFFICIENT_AVAILABLE_BALANCE" } },
        status: 503,
      }),
    ).toBe("uncertain");
  });

  it("성공 본문에 출금 식별자가 없으면 키를 유지한다", () => {
    expect(
      classifyWithdrawalHoldResponse({
        bodyParsed: true,
        ok: true,
        payload: { data: {} },
        status: 201,
      }),
    ).toBe("uncertain");
  });

  it("보관 값에는 목적지 원문이 없고 키는 지문에서 유도되지 않는다", async () => {
    const rawAccount = "RAW-ACCOUNT-991122";
    const rawAddress = "TRawSecretAddressShouldNotBeStored9999";
    const materialFingerprint = await fingerprintDestinationMaterial(
      normalizeWithdrawalDestinationParts({
        accountHolder: " 홍길동 ",
        accountNumber: "110-1234-567890",
        bankCode: " kb ",
        method: "KRW_BANK",
      }),
    );
    const normalizedAgain = await fingerprintDestinationMaterial(
      normalizeWithdrawalDestinationParts({
        accountHolder: "홍길동",
        accountNumber: "1101234567890",
        bankCode: "KB",
        method: "KRW_BANK",
      }),
    );
    const addressFingerprint = await fingerprintDestinationMaterial(
      normalizeWithdrawalDestinationParts({
        address: `  ${rawAddress}  `,
        method: "USDT_ADDRESS",
        network: " trc20 ",
      }),
    );
    const fingerprint = await fingerprintWithdrawalLogicalRequest({
      amountKrw: "1000",
      destinationRef: `material:${materialFingerprint}`,
      method: "KRW_BANK",
      policyId: "policy-krw",
    });
    const store = memoryLogicalRequestStore();
    const key = adoptWithdrawalLogicalKey(store, fingerprint, () => KEY);
    const saved = store.read(WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY) ?? "";

    expect(materialFingerprint).toBe(normalizedAgain);
    expect(saved).not.toContain(rawAccount);
    expect(saved).not.toContain("홍길동");
    expect(saved).not.toContain("1101234567890");
    expect(saved).not.toContain(rawAddress);
    expect(addressFingerprint).not.toContain(rawAddress);
    expect(key).toBe(KEY);
    expect(key).not.toBe(fingerprint);
    expect(parsePersistedWithdrawalLogicalRequest(saved)?.fingerprint).toBe(
      fingerprint,
    );
  });

  it("손상된 보관 값은 버리고 새 키를 만든다", () => {
    const store = memoryLogicalRequestStore();
    store.write(
      WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY,
      JSON.stringify({ fingerprint: FINGERPRINT, key: KEY, secret: "nope" }),
    );

    expect(parsePersistedWithdrawalLogicalRequest("{")).toBeNull();
    expect(adoptWithdrawalLogicalKey(store, FINGERPRINT, () => NEXT_KEY)).toBe(
      NEXT_KEY,
    );
  });

  it("지문이 같으면 decide가 키를 재사용한다", () => {
    const current = persisted();
    expect(
      decideWithdrawalLogicalKey(current, FINGERPRINT, () => NEXT_KEY),
    ).toEqual(current);
    expect(
      decideWithdrawalLogicalKey(current, OTHER_FINGERPRINT, () => NEXT_KEY)
        .key,
    ).toBe(NEXT_KEY);
  });

  it("출금 폼은 제출마다 새 UUID를 만들지 않고 논리 요청 키를 쓴다", () => {
    const source = readFileSync(
      "components/product/withdrawal-form.tsx",
      "utf8",
    );
    const holdRoute = readFileSync(
      "app/api/v1/withdrawals/hold/route.ts",
      "utf8",
    );

    expect(source).not.toContain("crypto.randomUUID()");
    expect(source).toContain("adoptWithdrawalLogicalKey");
    expect(source).toContain("finishWithdrawalLogicalKey");
    expect(holdRoute).not.toContain("force-response-loss");
    expect(holdRoute).not.toContain("E2E_");
  });

  it("같은 브라우저 저장소를 다시 열어도 불확실 키를 유지한다", () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (key: string) => backing.get(key) ?? null,
      removeItem: (key: string) => {
        backing.delete(key);
      },
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      },
    };
    const firstStore = createStorageLogicalRequestStore(storage, new Map());
    adoptWithdrawalLogicalKey(firstStore, FINGERPRINT, () => KEY);
    finishWithdrawalLogicalKey(firstStore, "uncertain");

    const reopened = createStorageLogicalRequestStore(storage, new Map());
    expect(
      adoptWithdrawalLogicalKey(reopened, FINGERPRINT, () => NEXT_KEY),
    ).toBe(KEY);
    const saved = backing.get(WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY) ?? "";
    expect(saved).not.toContain("계좌");
    expect(saved).toContain(KEY);
  });

  it("빈 저장소에 취소 결과를 써도 예외 없이 비운다", () => {
    const store = memoryLogicalRequestStore();
    saveWithdrawalLogicalRequest(store, persisted());
    finishWithdrawalLogicalKey(store, "cancelled");
    finishWithdrawalLogicalKey(store, "cancelled");

    expect(store.read(WITHDRAWAL_LOGICAL_REQUEST_STORAGE_KEY)).toBeNull();
  });
});
