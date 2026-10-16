import { describe, expect, it, vi } from "vitest";
import { createStorageLogicalRequestStore } from "@/lib/wallet/withdrawal-logical-request";
import {
  loadWithdrawalLogicalRecord,
  persistWithdrawalLogicalRecord,
  validateWithdrawalLogicalRecord,
} from "@/lib/wallet/withdrawal-logical-record";
import {
  recoverWithdrawalLogicalRecord,
  resolveWithdrawalLogicalRecord,
} from "@/lib/wallet/withdrawal-logical-recovery";
import { submitPrincipalWithdrawal } from "@/lib/wallet/principal-withdrawal-client";
const OWNER = "11111111-1111-4111-8111-111111111111",
  OTHER = "22222222-2222-4222-8222-222222222222",
  DEST = "33333333-3333-4333-8333-333333333333",
  POLICY = "44444444-4444-4444-8444-444444444444",
  WD = "55555555-5555-4555-8555-555555555555",
  CONFIRM = "66666666-6666-4666-8666-666666666666",
  KEY = "principal-usdt-original-138";
function raw(extra: Record<string, unknown> = {}) {
  return {
    v: 3,
    ownerId: OWNER,
    key: KEY,
    method: "USDT_ADDRESS",
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
function storage() {
  const backing = new Map<string, string>();
  return {
    backing,
    store: createStorageLogicalRequestStore({
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => {
        backing.set(k, v);
      },
      removeItem: (k) => {
        backing.delete(k);
      },
    }),
  };
}
const response = (record: unknown, status = 200) =>
  new Response(JSON.stringify({ data: { record } }), { status });
const holdResponse = () =>
  new Response(JSON.stringify({ data: { withdrawalId: WD } }), { status: 201 });
const snapshot = () => ({
  method: "USDT_ADDRESS" as const,
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
describe("USDT principal exact-original recovery without FX guesses", () => {
  it("fresh explicit USDT consent persists before existing HOLD then confirms exact same source", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(raw(), 201))
      .mockImplementationOnce(async () => {
        expect(loadWithdrawalLogicalRecord(store, OWNER)?.key).toBe(KEY);
        return holdResponse();
      })
      .mockResolvedValueOnce(
        response(raw({ state: "CONFIRMED", withdrawalId: WD })),
      );
    const result = await submitPrincipalWithdrawal({
      ownerId: OWNER,
      store,
      snapshot: snapshot(),
      fetcher,
    });
    expect(result.state).toBe("CONFIRMED");
    expect(fetcher.mock.calls.map(([u, i]) => [u, i?.method ?? "GET"])).toEqual(
      [
        ["/api/v1/withdrawals/intents", "GET"],
        ["/api/v1/withdrawals/intents", "POST"],
        ["/api/v1/withdrawals/hold", "POST"],
        ["/api/v1/withdrawals/intents", "PATCH"],
      ],
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual(
      snapshot(),
    );
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({
      method: "USDT_ADDRESS",
      destinationId: DEST,
      amountKrw: "1000",
    });
    expect(fetcher.mock.calls[2]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": KEY,
    });
    expect(loadWithdrawalLogicalRecord(store, OWNER)).toBeNull();
  });
  it("lost HOLD response preserves source/key and retry never makes a second consent", async () => {
    const { store } = storage();
    const first = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(raw(), 201))
      .mockRejectedValueOnce(new Error("lost"));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher: first,
      }),
    ).rejects.toThrow();
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.v).toBe(3);
    const retry = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(raw({ state: "OUTCOME_UNCERTAIN", withdrawalId: WD })),
      )
      .mockResolvedValueOnce(holdResponse())
      .mockResolvedValueOnce(
        response(raw({ state: "CONFIRMED", withdrawalId: WD })),
      );
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
        ([u, i]) => u === "/api/v1/withdrawals/intents" && i?.method === "POST",
      ),
    ).toHaveLength(0);
  });
  it("lost confirmation POST is recovered by GET before same-key native HOLD", async () => {
    const { store } = storage();
    const first = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null))
      .mockRejectedValueOnce(new Error("lost consent"));
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
      .mockResolvedValueOnce(response(raw()))
      .mockResolvedValueOnce(holdResponse())
      .mockResolvedValueOnce(
        response(raw({ state: "CONFIRMED", withdrawalId: WD })),
      );
    await submitPrincipalWithdrawal({
      ownerId: OWNER,
      store,
      snapshot: snapshot(),
      fetcher: retry,
    });
    expect(retry.mock.calls).toHaveLength(3);
    expect(retry.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("existing KRW principal original cannot authorize a USDT submission", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(raw({ method: "KRW_BANK" })));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.method).toBe("KRW_BANK");
  });
  it("USDT original cannot be submitted from a fresh KRW snapshot", async () => {
    const { store } = storage();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(raw()));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: { ...snapshot(), method: "KRW_BANK" },
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("ordinary v2 USDT recovery is preserved and never converted to principal", async () => {
    const { store } = storage();
    const ordinary = raw({ v: 2 });
    delete (ordinary as Partial<typeof ordinary>).source;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(ordinary));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.v).toBe(2);
  });
  it("server method substitution after consent never reaches HOLD", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(raw({ method: "KRW_BANK" }), 201));
    await expect(
      submitPrincipalWithdrawal({
        ownerId: OWNER,
        store,
        snapshot: snapshot(),
        fetcher,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(loadWithdrawalLogicalRecord(store, OWNER)).toBeNull();
  });
  it("known completed USDT original is recovered without any financial POST", async () => {
    const { store } = storage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response(raw({ state: "CONFIRMED", withdrawalId: WD })),
      );
    expect(
      (
        await submitPrincipalWithdrawal({
          ownerId: OWNER,
          store,
          snapshot: snapshot(),
          knownKey: KEY,
          fetcher,
        })
      ).withdrawalId,
    ).toBe(WD);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("read-only reconnect cannot finance a pending USDT original", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRecord(store, record(), OWNER);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(raw()));
    expect(
      (await recoverWithdrawalLogicalRecord(OWNER, store, fetcher))?.key,
    ).toBe(KEY);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
  it("manual logical cancel binds source and does not claim native financial release", async () => {
    const { store } = storage();
    const r = record();
    persistWithdrawalLogicalRecord(store, r, OWNER);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(raw({ state: "CANCELLED" })));
    expect(
      (
        await resolveWithdrawalLogicalRecord(
          OWNER,
          store,
          r,
          "CANCEL",
          null,
          fetcher,
        )
      ).state,
    ).toBe("CANCELLED");
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      action: "CANCEL",
      withdrawalId: null,
      recordVersion: 3,
      confirmationId: CONFIRM,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/withdrawals/intents");
  });
  it("foreign server owner does not overwrite the durable USDT source", async () => {
    const { store } = storage();
    persistWithdrawalLogicalRecord(store, record(), OWNER);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(raw({ ownerId: OTHER })));
    await expect(
      recoverWithdrawalLogicalRecord(OWNER, store, fetcher),
    ).rejects.toThrow();
    expect(loadWithdrawalLogicalRecord(store, OWNER)?.ownerId).toBe(OWNER);
  });
  it.each([
    { amountUsdt: "1" },
    { rate: "1000" },
    { network: "TRC20" },
    { address: "full-secret" },
  ])(
    "uncontracted monetary/material snapshot %j makes zero calls",
    async (extra) => {
      const { store } = storage();
      const fetcher = vi.fn<typeof fetch>();
      await expect(
        submitPrincipalWithdrawal({
          ownerId: OWNER,
          store,
          snapshot: { ...snapshot(), ...extra },
          fetcher,
        }),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
