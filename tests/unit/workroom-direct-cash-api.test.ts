import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: mocks.identity }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: mocks.read };
      return q;
    },
  }),
}));
vi.mock("@/app/api/v1/withdrawals/intents/route", () => ({
  GET: mocks.get,
  PATCH: mocks.patch,
}));
import {
  POST as prepare,
  GET,
  PATCH,
} from "@/app/api/v1/workroom/cash/intents/route";
import { POST as hold } from "@/app/api/v1/workroom/cash/hold/route";
import { GET as state } from "@/app/api/v1/workroom/cash/state/route";
import { workroomCashReadSchema } from "@/lib/wallet/workroom-cash-read";
import { workroomCashFetch } from "@/lib/wallet/workroom-cash-client";

const owner = "11111111-1111-4111-8111-111111111111",
  dest = "22222222-2222-4222-8222-222222222222",
  policy = "33333333-3333-4333-8333-333333333333",
  withdrawal = "44444444-4444-4444-8444-444444444444",
  key = "workroom-direct-cash-key";
const snapshot = {
  method: "KRW_BANK",
  amountKrw: "1000",
  policyId: policy,
  policyVersion: 1,
  destinationId: dest,
  destination: null,
};
const cash = {
  schemaVersion: 1,
  currency: "KRW",
  source: "DIRECT_DEPOSIT",
  availableKrw: "1000",
  heldKrw: "0",
  depositedKrw: "1000",
  withdrawnKrw: "0",
  ready: true,
};
const record = () => ({
  v: 2,
  ownerId: owner,
  key,
  method: "KRW_BANK",
  amountKrw: "1000",
  policyId: policy,
  policyVersion: 1,
  destinationIdentity: "a".repeat(64),
  destinationId: dest,
  withdrawalId: null,
  state: "DESTINATION_REGISTERED",
  createdAt: "2026-11-11T00:00:00.123456Z",
  updatedAt: "2026-11-11T00:00:00.123456Z",
  expiresAt: "2099-11-12T00:00:00.123456Z",
});
function request(path: string, body: unknown, withKey = true) {
  return new Request("https://mining.putduk.com" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withKey ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ userId: owner });
  mocks.rpc.mockResolvedValue({ data: record(), error: null });
  mocks.read.mockResolvedValue({
    data: {
      user_id: owner,
      idempotency_key: key,
      method: "KRW_BANK",
      destination_id: dest,
      amount_krw: "1000",
      withdrawal_id: withdrawal,
    },
    error: null,
  });
});

describe("direct deposit cash API boundary", () => {
  it("requires verified authentication before any cash read or prepare", async () => {
    mocks.identity.mockResolvedValue(null);
    expect(
      (await prepare(request("/api/v1/workroom/cash/intents", snapshot)))
        .status,
    ).toBe(401);
    expect((await state()).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("prepares only the authenticated owner's deposit-backed v2 intent", async () => {
    const r = await prepare(request("/api/v1/workroom/cash/intents", snapshot));
    expect(r.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "prepare_workroom_cash_withdrawal",
      expect.objectContaining({
        p_user_id: owner,
        p_method: "KRW_BANK",
        p_amount_krw: "1000",
        p_destination_id: dest,
      }),
    );
  });
  it.each([
    { source: "PRACTICE" },
    { p_user_id: withdrawal },
    { confirmation: { version: 1, source: "PRINCIPAL", confirmed: true } },
  ])("rejects client authority or alternate source %j", async (extra) => {
    expect(
      (
        await prepare(
          request("/api/v1/workroom/cash/intents", { ...snapshot, ...extra }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not accept a mismatched prepared amount", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...record(), amountKrw: "2000" },
      error: null,
    });
    expect(
      (await prepare(request("/api/v1/workroom/cash/intents", snapshot)))
        .status,
    ).toBe(503);
  });
  it("keeps existing serialized owner/key recovery and cancellation handlers", () => {
    expect(GET).toBe(mocks.get);
    expect(PATCH).toBe(mocks.patch);
  });
  it("holds verified deposits through new RPC and verifies its persisted original", async () => {
    mocks.rpc.mockResolvedValue({ data: withdrawal, error: null });
    const r = await hold(
      request("/api/v1/workroom/cash/hold", {
        method: "KRW_BANK",
        destinationId: dest,
        amountKrw: "1000",
      }),
    );
    expect(r.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("hold_workroom_cash_withdrawal", {
      p_user_id: owner,
      p_method: "KRW_BANK",
      p_destination_id: dest,
      p_amount_krw: "1000",
      p_idempotency_key: key,
    });
  });
  it("keeps uncertain holds closed without issuing another RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: withdrawal, error: null });
    mocks.read.mockResolvedValue({ data: null, error: null });
    expect(
      (
        await hold(
          request("/api/v1/workroom/cash/hold", {
            method: "KRW_BANK",
            destinationId: dest,
            amountKrw: "1000",
          }),
        )
      ).status,
    ).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("requires a durable hold key and rejects a different owner's persisted receipt", async () => {
    const body = { method: "KRW_BANK", destinationId: dest, amountKrw: "1000" };
    expect(
      (await hold(request("/api/v1/workroom/cash/hold", body, false))).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: withdrawal, error: null });
    mocks.read.mockResolvedValue({
      data: {
        user_id: withdrawal,
        idempotency_key: key,
        method: "KRW_BANK",
        destination_id: dest,
        amount_krw: "1000",
        withdrawal_id: withdrawal,
      },
      error: null,
    });
    expect(
      (await hold(request("/api/v1/workroom/cash/hold", body))).status,
    ).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("never falls back to mining or principal RPCs when an existing intent has another source", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "WORKROOM_CASH_SOURCE_MISMATCH" },
    });
    expect(
      (await prepare(request("/api/v1/workroom/cash/intents", snapshot)))
        .status,
    ).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe(
      "prepare_workroom_cash_withdrawal",
    );
  });
  it("maps direct-source refusal without exposing SQL or practice amounts", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "WORKROOM_CASH_INSUFFICIENT private SQL detail" },
    });
    const r = await prepare(request("/api/v1/workroom/cash/intents", snapshot));
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).not.toContain("private SQL");
  });
  it("reads direct approved amounts with exact string transport", async () => {
    mocks.rpc.mockResolvedValue({ data: cash, error: null });
    expect((await state()).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("read_workroom_cash", {
      p_user_id: owner,
    });
    expect(
      workroomCashReadSchema.safeParse({ ...cash, availableKrw: 1000 }).success,
    ).toBe(false);
    expect(
      workroomCashReadSchema.safeParse({ ...cash, source: "PRACTICE" }).success,
    ).toBe(false);
  });
  it("routes only fixed cash intents/hold while retaining destination security", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    try {
      await workroomCashFetch("/api/v1/withdrawals/intents", {
        method: "POST",
      });
      await workroomCashFetch("/api/v1/withdrawals/destinations", {
        method: "POST",
      });
      expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/workroom/cash/intents");
      expect(fetcher.mock.calls[1]?.[0]).toBe(
        "/api/v1/withdrawals/destinations",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
