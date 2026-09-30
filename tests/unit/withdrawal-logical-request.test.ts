// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyWithdrawalHoldResponse,
  createStorageLogicalRequestStore,
  finishWithdrawalLogicalKey,
  isWithdrawalLogicalRequestExpired,
  loadWithdrawalLogicalRequest,
  parsePersistedWithdrawalLogicalRequest,
  persistWithdrawalLogicalRequest,
  snapshotWithdrawalInput,
  validateWithdrawalLogicalRequest,
  withdrawalLogicalStorageKey,
  WITHDRAWAL_STORAGE_FAILURE_COPY,
  type PersistedWithdrawalLogicalRequest,
} from "@/lib/wallet/withdrawal-logical-request";
import {
  recoverWithdrawalLogicalRequest,
  submitWithdrawalLogicalRequest,
} from "@/lib/wallet/withdrawal-client";
import {
  withdrawalDestinationIdentity,
  withdrawalDestinationSchema,
} from "@/lib/wallet/withdrawal-destination.server";

vi.mock("server-only", () => ({}));
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEST = "33333333-3333-4333-8333-333333333333";
const POLICY = "44444444-4444-4444-8444-444444444444";
const WD = "55555555-5555-4555-8555-555555555555";
const KEY = "66666666-6666-4666-8666-666666666666";
const NEXT = "77777777-7777-4777-8777-777777777777";
const material = {
  method: "KRW_BANK" as const,
  accountHolder: "홍길동",
  accountNumber: "1101234567890",
  bankCode: "KB",
};
const canonical = withdrawalDestinationIdentity(material).fingerprint;

function record(
  overrides: Partial<PersistedWithdrawalLogicalRequest> = {},
): PersistedWithdrawalLogicalRequest {
  return {
    v: 2,
    ownerId: OWNER,
    key: KEY,
    method: "KRW_BANK",
    amountKrw: "1000",
    policyId: POLICY,
    policyVersion: 1,
    destinationIdentity: canonical,
    destinationId: null,
    withdrawalId: null,
    state: "PREPARED",
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    expiresAt: "2099-10-01T00:00:00.000Z",
    ...overrides,
  };
}
function storage() {
  const backing = new Map<string, string>();
  const adapter = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  };
  return { backing, adapter, store: createStorageLogicalRequestStore(adapter) };
}
const snapshot = {
  amountKrw: "1000",
  policyId: POLICY,
  policyVersion: 1,
  method: "KRW_BANK" as const,
  destinationId: null,
  destination: material,
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ data }), { status });
const bound = () =>
  record({ destinationId: DEST, state: "DESTINATION_REGISTERED" });
const committed = () =>
  record({ destinationId: DEST, withdrawalId: WD, state: "OUTCOME_UNCERTAIN" });
const confirmed = () =>
  record({ destinationId: DEST, withdrawalId: WD, state: "CONFIRMED" });
afterEach(() => vi.unstubAllGlobals());

describe("withdrawal v2 durable logical lifecycle", () => {
  it("new material and registered binding retain the canonical identity and opaque key", () => {
    const prepared = record();
    const registered = bound();
    expect(prepared.destinationIdentity).toBe(registered.destinationIdentity);
    expect(prepared.key).toBe(registered.key);
    expect(prepared.key).not.toBe(prepared.destinationIdentity);
  });
  it("KRW format normalization reuses the existing server fingerprint algorithm", () => {
    const formatted = withdrawalDestinationSchema.parse({
      ...material,
      accountHolder: " 홍길동 ",
      accountNumber: "110-1234-567890",
      bankCode: " kb ",
    });
    expect(withdrawalDestinationIdentity(formatted).fingerprint).toBe(
      canonical,
    );
    expect(
      withdrawalDestinationIdentity({
        ...material,
        accountNumber: "1101234567891",
      }).fingerprint,
    ).not.toBe(canonical);
  });
  it("USDT trims only allowed formatting and keeps network/address pairing distinct", () => {
    const address = "0x" + "a".repeat(40);
    const parsed = withdrawalDestinationSchema.parse({
      method: "USDT_ADDRESS",
      network: "ERC20",
      address: ` ${address} `,
    });
    expect(withdrawalDestinationIdentity(parsed).fingerprint).toBe(
      withdrawalDestinationIdentity({
        method: "USDT_ADDRESS",
        network: "ERC20",
        address,
      }).fingerprint,
    );
    expect(
      withdrawalDestinationIdentity({
        method: "USDT_ADDRESS",
        network: "BEP20",
        address,
      }).fingerprint,
    ).not.toBe(withdrawalDestinationIdentity(parsed).fingerprint);
  });
  it.each(["KRW_BANK", "USDT_ADDRESS"] as const)(
    "snapshots %s before controls become disabled",
    (method) => {
      const form = document.createElement("form");
      form.innerHTML =
        '<input name="accountHolder" value="홍길동"><input name="accountNumber" value="1101234567890"><select name="bankCode"><option value="KB" selected>KB</option></select><input name="address" value="TXYZaBcDeFgHiJkLmNoPqRsTuVwXyZ1234"><select name="network"><option value="TRC20" selected>TRC20</option></select>';
      const captured = snapshotWithdrawalInput(form, {
        ...snapshot,
        method,
        destinationId: null,
      });
      form.querySelectorAll("input,select").forEach((control) => {
        (control as HTMLInputElement).disabled = true;
      });
      expect(new FormData(form).get("accountNumber")).toBeNull();
      expect(captured.destination).toEqual(
        method === "KRW_BANK"
          ? material
          : {
              method,
              network: "TRC20",
              address: "TXYZaBcDeFgHiJkLmNoPqRsTuVwXyZ1234",
            },
      );
      expect(Object.isFrozen(captured)).toBe(true);
      expect(Object.isFrozen(captured.destination)).toBe(true);
    },
  );
  it("write failure never reports durable success or uses a memory fallback", () => {
    const store = createStorageLogicalRequestStore({
      getItem: () => null,
      removeItem() {},
      setItem() {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    expect(() =>
      persistWithdrawalLogicalRequest(store, record(), OWNER),
    ).toThrow(WITHDRAWAL_STORAGE_FAILURE_COPY);
    expect(loadWithdrawalLogicalRequest(store, OWNER)).toBeNull();
  });
  it("successful write followed by null read fails closed", () => {
    const store = createStorageLogicalRequestStore({
      getItem: () => null,
      removeItem() {},
      setItem() {},
    });
    expect(() =>
      persistWithdrawalLogicalRequest(store, record(), OWNER),
    ).toThrow(WITHDRAWAL_STORAGE_FAILURE_COPY);
  });
  it("unavailable storage blocks before even preparing an intent", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      submitWithdrawalLogicalRequest({
        ownerId: OWNER,
        snapshot,
        store: createStorageLogicalRequestStore(null),
        fetcher,
      }),
    ).rejects.toThrow(WITHDRAWAL_STORAGE_FAILURE_COPY);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("failed canonical record read-back blocks registration and hold", async () => {
    const good = storage();
    const store = createStorageLogicalRequestStore({
      ...good.adapter,
      getItem: (key) =>
        key.endsWith(".probe") ? good.adapter.getItem(key) : null,
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: null }))
      .mockResolvedValueOnce(response({ record: record() }, 201));
    await expect(
      submitWithdrawalLogicalRequest({
        ownerId: OWNER,
        snapshot,
        store,
        fetcher,
      }),
    ).rejects.toThrow(WITHDRAWAL_STORAGE_FAILURE_COPY);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/withdrawals/intents",
      "/api/v1/withdrawals/intents",
    ]);
  });
  it.each([
    "{",
    JSON.stringify({ v: 1, key: KEY }),
    JSON.stringify({ ...record(), v: 3 }),
  ])(
    "corrupt/old/unknown records never generate a new key: %s",
    async (raw) => {
      const { store } = storage();
      store.write(withdrawalLogicalStorageKey(OWNER), raw);
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ record: null }));
      await expect(
        submitWithdrawalLogicalRequest({
          ownerId: OWNER,
          snapshot,
          store,
          fetcher,
        }),
      ).rejects.toThrow("이전 출금 요청");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("corrupt local state recovers the same server-owned request", async () => {
    const { store } = storage();
    store.write(withdrawalLogicalStorageKey(OWNER), "{");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ record: committed() }));
    expect(
      (await recoverWithdrawalLogicalRequest(OWNER, store, fetcher))?.key,
    ).toBe(KEY);
    expect(loadWithdrawalLogicalRequest(store, OWNER)?.key).toBe(KEY);
  });
  it("owner switch isolates storage; a foreign-owner record is rejected", () => {
    const { store } = storage();
    persistWithdrawalLogicalRequest(store, record(), OWNER);
    expect(loadWithdrawalLogicalRequest(store, OTHER)).toBeNull();
    expect(() => validateWithdrawalLogicalRequest(record(), OTHER)).toThrow(
      "이전 출금 요청",
    );
  });
  it("TTL retains a committed key and blocks a new expired uncommitted mutation", async () => {
    const expired = record({ expiresAt: "2026-09-30T01:00:00.000Z" });
    expect(
      isWithdrawalLogicalRequestExpired(
        expired,
        Date.parse("2026-10-01T00:00:00Z"),
      ),
    ).toBe(true);
    expect(
      parsePersistedWithdrawalLogicalRequest(JSON.stringify(expired), OWNER)
        ?.key,
    ).toBe(KEY);
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ record: expired }));
    await expect(
      submitWithdrawalLogicalRequest({
        ownerId: OWNER,
        snapshot,
        store,
        fetcher,
      }),
    ).rejects.toThrow("이전 출금 요청");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("storage reopening and a second tab preserve the same unresolved record", () => {
    const { adapter, store } = storage();
    persistWithdrawalLogicalRequest(store, bound(), OWNER);
    const reopened = createStorageLogicalRequestStore(adapter);
    expect(loadWithdrawalLogicalRequest(reopened, OWNER)).toEqual(bound());
  });
  it("registration response loss recovers binding without registering/replacing again", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRequest(store, record(), OWNER);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: bound() }))
      .mockResolvedValueOnce(response({ withdrawalId: WD }, 201))
      .mockResolvedValueOnce(response({ record: confirmed() }));
    await submitWithdrawalLogicalRequest({
      ownerId: OWNER,
      snapshot: { ...snapshot, destinationId: DEST, destination: null },
      store,
      fetcher,
    });
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith("/destinations")),
    ).toBe(false);
    expect(
      (fetcher.mock.calls[1]?.[1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ],
    ).toBe(KEY);
  });
  it("hold response loss and reload replay the exact body and original key", async () => {
    const { store } = storage();
    const first = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: null }))
      .mockResolvedValueOnce(response({ record: record() }, 201))
      .mockResolvedValueOnce(response({ record: bound() }, 201))
      .mockRejectedValueOnce(new TypeError("connectionreset"));
    await expect(
      submitWithdrawalLogicalRequest({
        ownerId: OWNER,
        snapshot,
        store,
        fetcher: first,
      }),
    ).rejects.toThrow("connectionreset");
    expect(loadWithdrawalLogicalRequest(store, OWNER)?.key).toBe(KEY);
    const retry = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: committed() }))
      .mockResolvedValueOnce(response({ withdrawalId: WD }, 201))
      .mockResolvedValueOnce(response({ record: confirmed() }));
    await submitWithdrawalLogicalRequest({
      ownerId: OWNER,
      snapshot: { ...snapshot, destinationId: DEST, destination: null },
      store,
      fetcher: retry,
    });
    expect(first.mock.calls[3]?.[1]?.body).toBe(retry.mock.calls[1]?.[1]?.body);
    expect(first.mock.calls[3]?.[1]?.headers).toEqual(
      retry.mock.calls[1]?.[1]?.headers,
    );
  });
  it("confirmed success permits a legitimate later identical request with a new random server key", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRequest(store, committed(), OWNER);
    finishWithdrawalLogicalKey(store, confirmed(), OWNER);
    const next = record({
      key: NEXT,
      destinationId: DEST,
      state: "DESTINATION_REGISTERED",
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: null }))
      .mockResolvedValueOnce(response({ record: next }, 201))
      .mockResolvedValueOnce(response({ withdrawalId: WD }, 201))
      .mockResolvedValueOnce(
        response({ record: { ...next, state: "CONFIRMED", withdrawalId: WD } }),
      );
    const result = await submitWithdrawalLogicalRequest({
      ownerId: OWNER,
      snapshot: { ...snapshot, destinationId: DEST, destination: null },
      store,
      fetcher,
    });
    expect(result.key).toBe(NEXT);
    expect(loadWithdrawalLogicalRequest(store, OWNER)).toBeNull();
  });
  it("lost confirmation response resolves old success without issuing another money command", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRequest(store, bound(), OWNER);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: null }))
      .mockResolvedValueOnce(response({ record: confirmed() }));
    const result = await submitWithdrawalLogicalRequest({
      ownerId: OWNER,
      snapshot,
      store,
      fetcher,
    });
    expect(result.state).toBe("CONFIRMED");
    expect(fetcher.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
  });
  it("a stale tab resolves its old success without adopting a later pending request", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRequest(store, bound(), OWNER);
    const later = record({ ...bound(), key: NEXT });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: later }))
      .mockResolvedValueOnce(response({ record: confirmed() }));
    const result = await submitWithdrawalLogicalRequest({
      ownerId: OWNER,
      snapshot,
      store,
      fetcher,
    });
    expect(result.key).toBe(KEY);
    expect(result.state).toBe("CONFIRMED");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
    expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
      "Idempotency-Key": KEY,
    });
  });
  it("an open tab with cleared shared storage resolves its remembered key without new money", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: confirmed() }));
    const result = await submitWithdrawalLogicalRequest({
      ownerId: OWNER,
      store,
      snapshot,
      knownKey: KEY,
      fetcher,
    });
    expect(result.key).toBe(KEY);
    expect(result.state).toBe("CONFIRMED");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      "Idempotency-Key": KEY,
    });
    expect(fetcher.mock.calls.every(([, options]) => !options?.method)).toBe(
      true,
    );
  });
  it("a remembered terminal key never erases another tab's later shared record", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRequest(
      store,
      record({ ...bound(), key: NEXT }),
      OWNER,
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: confirmed() }));
    await submitWithdrawalLogicalRequest({
      ownerId: OWNER,
      store,
      snapshot,
      knownKey: KEY,
      fetcher,
    });
    expect(loadWithdrawalLogicalRequest(store, OWNER)?.key).toBe(NEXT);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("a remembered key absent from the owner server fails closed instead of preparing another key", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: null }));
    await expect(
      submitWithdrawalLogicalRequest({
        ownerId: OWNER,
        store,
        snapshot,
        knownKey: KEY,
        fetcher,
      }),
    ).rejects.toThrow("이전 출금 요청");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("definitive rejection only clears after server confirms no competing commit", async () => {
    const { store } = storage();
    const rejected = record({ ...bound(), state: "DEFINITIVELY_REJECTED" });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: bound() }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "INSUFFICIENT_AVAILABLE_BALANCE" } }),
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(response({ record: rejected }));
    await expect(
      submitWithdrawalLogicalRequest({
        ownerId: OWNER,
        snapshot: { ...snapshot, destinationId: DEST, destination: null },
        store,
        fetcher,
      }),
    ).rejects.toThrow("출금 가능 금액");
    expect(loadWithdrawalLogicalRequest(store, OWNER)).toBeNull();
  });
  it("an unsafe material change is blocked rather than silently discarding an unresolved request", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ record: bound() }));
    await expect(
      submitWithdrawalLogicalRequest({
        ownerId: OWNER,
        snapshot: { ...snapshot, amountKrw: "2000" },
        store,
        fetcher,
      }),
    ).rejects.toThrow("이전 출금 요청");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("terminal cleanup cannot erase another tab's newer key", () => {
    const { store } = storage();
    persistWithdrawalLogicalRequest(store, record({ key: NEXT }), OWNER);
    finishWithdrawalLogicalKey(store, confirmed(), OWNER);
    expect(loadWithdrawalLogicalRequest(store, OWNER)?.key).toBe(NEXT);
  });
  it("record serialization contains no raw destination, holder, address, cipher or secret", () => {
    const { backing, store } = storage();
    persistWithdrawalLogicalRequest(store, record(), OWNER);
    const saved = backing.get(withdrawalLogicalStorageKey(OWNER))!;
    for (const secret of [
      material.accountHolder,
      material.accountNumber,
      "address",
      "ciphertext",
      "privateKey",
      "secret",
    ])
      expect(saved).not.toContain(secret);
    expect(() =>
      validateWithdrawalLogicalRequest(
        { ...record(), accountNumber: material.accountNumber },
        OWNER,
      ),
    ).toThrow();
  });
  it.each(["__proto__", "constructor", "prototype"])(
    "rejects unknown/prototype fields: %s",
    (field) => {
      const value = JSON.parse(
        JSON.stringify(record()).replace(/}$/, `,"${field}":"bad"}`),
      );
      expect(() => validateWithdrawalLogicalRequest(value, OWNER)).toThrow();
      const input = {
        bodyParsed: true,
        ok: false,
        payload: { error: { code: field } },
        status: 409,
      };
      expect(classifyWithdrawalHoldResponse(input)).toBe("uncertain");
    },
  );
  it("5xx, malformed 2xx and unparsed response preserve uncertainty", () => {
    for (const input of [
      { bodyParsed: false, ok: true, payload: null, status: 201 },
      { bodyParsed: true, ok: true, payload: { data: {} }, status: 201 },
      {
        bodyParsed: true,
        ok: true,
        payload: { data: { withdrawalId: "wd-1" } },
        status: 201,
      },
      {
        bodyParsed: true,
        ok: false,
        payload: { error: { code: "INSUFFICIENT_AVAILABLE_BALANCE" } },
        status: 503,
      },
    ])
      expect(classifyWithdrawalHoldResponse(input)).toBe("uncertain");
  });
  it.each([
    [400, "INVALID_WITHDRAWAL_REQUEST"],
    [400, "INVALID_IDEMPOTENCY_KEY"],
    [401, "UNAUTHENTICATED"],
    [409, "INSUFFICIENT_AVAILABLE_BALANCE"],
  ])(
    "classifies exact definitive pair %s/%s, without erasing by itself",
    (status, code) => {
      expect(
        classifyWithdrawalHoldResponse({
          bodyParsed: true,
          ok: false,
          payload: { error: { code } },
          status: Number(status),
        }),
      ).toBe("definitive_rejection");
      const { store } = storage();
      persistWithdrawalLogicalRequest(store, bound(), OWNER);
      finishWithdrawalLogicalKey(store, bound(), OWNER);
      expect(loadWithdrawalLogicalRequest(store, OWNER)?.key).toBe(KEY);
    },
  );
  it("form never makes random keys or rereads disabled FormData after awaiting", () => {
    const form = readFileSync("components/product/withdrawal-form.tsx", "utf8");
    expect(form).not.toContain("crypto.randomUUID");
    expect(form).not.toContain("new FormData");
    expect(form.indexOf("snapshotWithdrawalInput(form")).toBeLessThan(
      form.indexOf("await submitWithdrawalLogicalRequest"),
    );
    const route = readFileSync("app/api/v1/withdrawals/hold/route.ts", "utf8");
    expect(route).toContain("hold_withdrawal_logical_request");
    expect(route).not.toContain("force-response-loss");
    expect(route).not.toContain("E2E_");
  });
});
