import { describe, expect, it, vi } from "vitest";
import {
  createStorageLogicalRequestStore,
  withdrawalLogicalStorageKey,
} from "@/lib/wallet/withdrawal-logical-request";
import {
  finishWithdrawalLogicalRecord,
  loadWithdrawalLogicalRecord,
  persistWithdrawalLogicalRecord,
  validateWithdrawalLogicalRecord,
} from "@/lib/wallet/withdrawal-logical-record";
import {
  recoverWithdrawalLogicalRecord,
  resolveWithdrawalLogicalRecord,
} from "@/lib/wallet/withdrawal-logical-recovery";
import { submitPrincipalWithdrawal } from "@/lib/wallet/principal-withdrawal-client";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const DEST = "33333333-3333-4333-8333-333333333333";
const POLICY = "44444444-4444-4444-8444-444444444444";
const WD = "55555555-5555-4555-8555-555555555555";
const CONFIRM = "66666666-6666-4666-8666-666666666666";
const KEY = "principal-logical-original-137";
function raw(extra: Record<string, unknown> = {}) {
  return {
    v: 3,
    ownerId: OWNER,
    key: KEY,
    method: "KRW_BANK",
    amountKrw: "1000",
    policyId: POLICY,
    policyVersion: 1,
    destinationIdentity: "a".repeat(64),
    destinationId: DEST,
    withdrawalId: null,
    state: "DESTINATION_REGISTERED",
    createdAt: "2026-10-06T00:00:00.123456Z",
    updatedAt: "2026-10-06T00:00:00.123456Z",
    expiresAt: "2099-10-07T00:00:00.123456Z",
    source: { version: 1, kind: "PRINCIPAL", confirmationId: CONFIRM },
    ...extra,
  };
}
const record = (extra: Record<string, unknown> = {}) =>
  validateWithdrawalLogicalRecord(raw(extra), OWNER);
const confirmed = () => record({ state: "CONFIRMED", withdrawalId: WD });
function ordinary() {
  const r = raw({ v: 2 });
  delete (r as Partial<typeof r>).source;
  return validateWithdrawalLogicalRecord(r, OWNER);
}
function storage() {
  const backing = new Map<string, string>();
  return {
    backing,
    store: createStorageLogicalRequestStore({
      getItem: (key) => backing.get(key) ?? null,
      setItem: (key, value) => {
        backing.set(key, value);
      },
      removeItem: (key) => {
        backing.delete(key);
      },
    }),
  };
}
const response = (record: unknown, status = 200) =>
  new Response(JSON.stringify({ data: { record } }), { status });
const snapshot = () => ({
  method: "KRW_BANK" as const,
  amountKrw: "1000",
  policyId: POLICY,
  policyVersion: 1,
  destinationId: DEST,
  destination: null,
  confirmation: {
    version: 1 as const,
    source: "PRINCIPAL" as const,
    confirmed: true as const,
  },
});

describe("v3 original-preserving principal recovery", () => {
  it.each([
    raw(),
    (() => {
      const r = raw({ v: 2 });
      delete (r as Partial<typeof r>).source;
      return r;
    })(),
  ])("validates each contracted source version without conversion", (r) => {
    expect(validateWithdrawalLogicalRecord(r, OWNER).v).toBe(r.v);
  });
  it.each([
    { v: 4 },
    { source: null },
    { accountNumber: "secret" },
    { ownerId: OTHER },
    { amountKrw: "1.5" },
    { source: { version: 1, kind: "PRINCIPAL", confirmationId: "bad" } },
  ])("rejects an unknown/foreign/secret envelope %j", (extra) => {
    expect(() => validateWithdrawalLogicalRecord(raw(extra), OWNER)).toThrow();
  });
  it("does not allow source downgrade on the same durable key", () => {
    const { store } = storage();
    persistWithdrawalLogicalRecord(store, record(), OWNER);
    expect(() =>
      persistWithdrawalLogicalRecord(store, ordinary(), OWNER),
    ).toThrow();
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.v).toBe(3);
  });
  it("does not replace a different tab's unresolved key", () => {
    const { store } = storage();
    persistWithdrawalLogicalRecord(store, record(), OWNER);
    expect(() =>
      persistWithdrawalLogicalRecord(
        store,
        record({ key: "other-principal-key-137" }),
        OWNER,
      ),
    ).toThrow();
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.key).toBe(KEY);
  });
  it("never clears a later key while acknowledging an old terminal original", () => {
    const { store } = storage();
    const later = record({ key: "later-principal-key-137" });
    persistWithdrawalLogicalRecord(store, later, OWNER);
    finishWithdrawalLogicalRecord(store, confirmed(), OWNER);
    expect(loadWithdrawalLogicalRecord(store, OWNER)).toEqual(later);
  });
  it("terminal source substitution cannot clear the durable principal original", () => {
    const { store } = storage();
    persistWithdrawalLogicalRecord(store, record(), OWNER);
    const forged = record({
      state: "CONFIRMED",
      withdrawalId: WD,
      source: { version: 1, kind: "PRINCIPAL", confirmationId: OTHER },
    });
    expect(() => finishWithdrawalLogicalRecord(store, forged, OWNER)).toThrow();
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.key).toBe(KEY);
  });
  it.each([true, false])(
    "reconnect/protection reads never post a principal hold or consent (%s)",
    async (protectionActive) => {
      const { store } = storage();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ data: { record: raw(), protectionActive } }),
          ),
        );
      expect(
        await recoverWithdrawalLogicalRecord(OWNER, store, fetcher),
      ).toEqual(record());
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]?.[1]?.method).toBeUndefined();
    },
  );
  it("principal recovery does not cancel an ordinary source intent on mount", async () => {
    const { store } = storage();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { record: ordinary(), protectionActive: true },
        }),
      ),
    );
    expect(
      (await recoverWithdrawalLogicalRecord(OWNER, store, fetcher))?.v,
    ).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bound PATCH preserves source version and confirmation original", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRecord(store, record(), OWNER);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(confirmed()));
    expect(
      (
        await resolveWithdrawalLogicalRecord(
          OWNER,
          store,
          record(),
          "CONFIRM",
          WD,
          fetcher,
        )
      ).state,
    ).toBe("CONFIRMED");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      action: "CONFIRM",
      withdrawalId: WD,
      recordVersion: 3,
      confirmationId: CONFIRM,
    });
    expect(loadWithdrawalLogicalRecord(store, OWNER)).toBeNull();
  });
  it("an ordinary PATCH stays the exact v2 body", async () => {
    const { store } = storage();
    const r = ordinary();
    const done = { ...r, state: "CANCELLED" };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(done));
    await resolveWithdrawalLogicalRecord(
      OWNER,
      store,
      r,
      "CANCEL",
      null,
      fetcher,
    );
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      action: "CANCEL",
      withdrawalId: null,
    });
  });
  it("server downgrade during resolution remains unresolved and retains the original", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRecord(store, record(), OWNER);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response({ ...ordinary(), state: "CONFIRMED", withdrawalId: WD }),
      );
    await expect(
      resolveWithdrawalLogicalRecord(
        OWNER,
        store,
        record(),
        "CONFIRM",
        WD,
        fetcher,
      ),
    ).rejects.toThrow();
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.v).toBe(3);
  });
  it("explicit submit persists the consent original before native finance and confirms the same key", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(raw(), 201))
      .mockImplementationOnce(async () => {
        expect(loadWithdrawalLogicalRecord(store, OWNER)?.key).toBe(KEY);
        return new Response(JSON.stringify({ data: { withdrawalId: WD } }), {
          status: 201,
        });
      })
      .mockResolvedValueOnce(response(confirmed()));
    expect(
      (
        await submitPrincipalWithdrawal({
          ownerId: OWNER,
          store,
          snapshot: snapshot(),
          fetcher,
        })
      ).state,
    ).toBe("CONFIRMED");
    expect(
      fetcher.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"]),
    ).toEqual([
      ["/api/v1/withdrawals/intents", "GET"],
      ["/api/v1/withdrawals/intents", "POST"],
      ["/api/v1/withdrawals/hold", "POST"],
      ["/api/v1/withdrawals/intents", "PATCH"],
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual(
      snapshot(),
    );
    expect(
      (fetcher.mock.calls[2]?.[1]?.headers as Record<string, string>)[
        "Idempotency-Key"
      ],
    ).toBe(KEY);
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      method: "KRW_BANK",
      destinationId: DEST,
      amountKrw: "1000",
    });
    expect(loadWithdrawalLogicalRecord(store, OWNER)).toBeNull();
  });
  it("uncertain hold response retains the exact source/key and retries no new confirmation", async () => {
    const { store } = storage();
    const first = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(raw(), 201))
      .mockRejectedValueOnce(new Error("network"));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher: first,
      }),
    ).rejects.toThrow();
    const retry = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(raw({ state: "OUTCOME_UNCERTAIN", withdrawalId: WD })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { withdrawalId: WD } }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(response(confirmed()));
    await submitPrincipalWithdrawal({
      ownerId: OWNER,
      store,
      snapshot: snapshot(),
      fetcher: retry,
    });
    expect(first.mock.calls[2]?.[1]?.body).toBe(retry.mock.calls[1]?.[1]?.body);
    expect(first.mock.calls[2]?.[1]?.headers).toEqual(
      retry.mock.calls[1]?.[1]?.headers,
    );
    expect(
      retry.mock.calls.filter(
        ([url, init]) =>
          url === "/api/v1/withdrawals/intents" && init?.method === "POST",
      ),
    ).toHaveLength(0);
  });
  it("lost consent POST is recovered from server without making a second original", async () => {
    const { store } = storage();
    const first = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null))
      .mockRejectedValueOnce(new Error("lost"));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher: first,
      }),
    ).rejects.toThrow();
    const second = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(raw()))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { withdrawalId: WD } }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(response(confirmed()));
    await submitPrincipalWithdrawal({
      ownerId: OWNER,
      store,
      snapshot: snapshot(),
      fetcher: second,
    });
    expect(second.mock.calls).toHaveLength(3);
    expect(second.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("a remembered confirmed old key never posts money or clears a newer tab", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRecord(
      store,
      record({ key: "newer-tab-key-137" }),
      OWNER,
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(confirmed()));
    await submitPrincipalWithdrawal({
      ownerId: OWNER,
      store,
      snapshot: snapshot(),
      knownKey: KEY,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.key).toBe(
      "newer-tab-key-137",
    );
  });
  it("v2 recovery cannot authorize a principal submission", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(ordinary()));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("mutable caller inputs are frozen before recovery awaits", async () => {
    const { store } = storage();
    const mutable = snapshot();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => {
        mutable.amountKrw = "2000";
        return response(null);
      })
      .mockResolvedValueOnce(response(raw(), 201))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { withdrawalId: WD } }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(response(confirmed()));
    await submitPrincipalWithdrawal({
      ownerId: OWNER,
      store,
      snapshot: mutable,
      fetcher,
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).amountKrw).toBe(
      "1000",
    );
  });
  it.each([
    { confirmed: false },
    { version: 2 },
    { source: "MINING_REWARD" },
    { confirmed: true, callerAmount: "1000" },
  ])(
    "unconfirmed or uncontracted consent makes zero requests %j",
    async (extra) => {
      const { store } = storage();
      const fetcher = vi.fn<typeof fetch>();
      const bad = {
        ...snapshot(),
        confirmation: { ...snapshot().confirmation, ...extra },
      };
      await expect(
        submitPrincipalWithdrawal({
          ownerId: OWNER,
          store,
          snapshot: bad as ReturnType<typeof snapshot>,
          fetcher,
        }),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("failed durable readback stops all money after consent creation", async () => {
    const { backing, store } = storage();
    let drops = false;
    const bad = {
      ...store,
      write: (key: string, value: string) => {
        if (!drops) store.write(key, value);
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null))
      .mockImplementationOnce(async () => {
        drops = true;
        return response(raw(), 201);
      });
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store: bad,
        snapshot: snapshot(),
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(backing.has(withdrawalLogicalStorageKey(OWNER))).toBe(false);
  });
  it("expired unfinanced consent is retained and never silently replaced", async () => {
    const { store } = storage();
    const r = raw({ expiresAt: "2026-10-06T00:00:01.123456Z" });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(r));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.key).toBe(KEY);
  });
  it("unresolved legacy history cannot authorize fresh principal consent", async () => {
    const { store } = storage();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(null));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher,
        legacyPresent: true,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
