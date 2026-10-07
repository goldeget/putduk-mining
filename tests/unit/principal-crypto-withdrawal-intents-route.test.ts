import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  memberRpc: vi.fn(),
  serviceRpc: vi.fn(),
  serviceFrom: vi.fn(),
  principal: vi.fn(),
  crypto: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: mocks.identity }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: mocks.serviceRpc,
    from: mocks.serviceFrom,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: mocks.memberRpc }),
}));
vi.mock("@/lib/wallet/read-principal-withdrawal.server", () => ({
  readPrincipalWithdrawal: mocks.principal,
}));
vi.mock("@/lib/wallet/read-principal-crypto-withdrawal.server", () => ({
  readPrincipalCryptoWithdrawal: mocks.crypto,
}));
import { GET, POST, PATCH } from "@/app/api/v1/withdrawals/intents/route";
const owner = "11111111-1111-4111-8111-111111111111",
  dest = "33333333-3333-4333-8333-333333333333",
  policy = "44444444-4444-4444-8444-444444444444",
  wd = "55555555-5555-4555-8555-555555555555",
  confirmation = "66666666-6666-4666-8666-666666666666",
  key = "principal-usdt-route-key-138";
const record = (extra: Record<string, unknown> = {}) => ({
  v: 3,
  ownerId: owner,
  key,
  method: "USDT_ADDRESS",
  amountKrw: "1000",
  policyId: policy,
  policyVersion: 1,
  destinationIdentity: "a".repeat(64),
  destinationId: dest,
  withdrawalId: null,
  state: "DESTINATION_REGISTERED",
  createdAt: "2026-10-06T00:00:00.123456Z",
  updatedAt: "2026-10-06T00:00:00.123456Z",
  expiresAt: "2099-10-07T00:00:00.123456Z",
  source: { version: 1, kind: "PRINCIPAL", confirmationId: confirmation },
  ...extra,
});
const snapshot = () => ({
  method: "USDT_ADDRESS",
  amountKrw: "1000",
  policyId: policy,
  policyVersion: 1,
  destinationId: dest,
  destination: null,
  confirmation: { version: 1, source: "PRINCIPAL", confirmed: true },
});
function request(method: string, body?: unknown, query = "", header = true) {
  return new Request(
    "https://putduk.local/api/v1/withdrawals/intents" + query,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(header ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ userId: owner, supabase: {} });
  mocks.principal.mockResolvedValue({ schemaVersion: 1, available: false });
  mocks.crypto.mockResolvedValue({ schemaVersion: 1, available: false });
  const q = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { protection_until: "2000-01-01T00:00:00Z" },
      error: null,
    }),
  };
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  mocks.serviceFrom.mockReturnValue(q);
});
describe("existing logical URL USDT read/consent transport", () => {
  it("optional USDT GET reads only owner-bound safe facts and RECOVER", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: record(), error: null });
    const result = await GET(request("GET", undefined, "?principal=usdt"));
    expect(result.status).toBe(200);
    expect(Object.keys((await result.json()).data)).toEqual([
      "record",
      "protectionActive",
      "principalCrypto",
    ]);
    expect(mocks.crypto).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
    );
    expect(mocks.principal).not.toHaveBeenCalled();
    expect(mocks.memberRpc).not.toHaveBeenCalled();
    expect(mocks.serviceRpc.mock.calls.map((c) => c[1].p_action)).toEqual([
      "RECOVER",
    ]);
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("KRW optional GET retains its envelope and never reads USDT eligibility", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: record({ method: "KRW_BANK" }),
      error: null,
    });
    const result = await GET(request("GET", undefined, "?principal=1"));
    expect(Object.keys((await result.json()).data)).toEqual([
      "record",
      "protectionActive",
      "principal",
    ]);
    expect(mocks.crypto).not.toHaveBeenCalled();
    expect(mocks.principal).toHaveBeenCalledTimes(1);
  });
  it.each(["", "?principal=unknown"])(
    "existing or unknown query %s retains ordinary recovery shape",
    async (query) => {
      mocks.serviceRpc.mockResolvedValue({ data: record(), error: null });
      const result = await GET(request("GET", undefined, query));
      expect(Object.keys((await result.json()).data)).toEqual([
        "record",
        "protectionActive",
      ]);
      expect(mocks.crypto).not.toHaveBeenCalled();
      expect(mocks.principal).not.toHaveBeenCalled();
    },
  );
  it("fresh USDT principal POST uses actual member client mandatory consent and no FX fields", async () => {
    mocks.memberRpc.mockResolvedValue({ data: record(), error: null });
    const result = await POST(request("POST", snapshot(), "", false));
    expect(result.status).toBe(201);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
    expect(mocks.memberRpc).toHaveBeenCalledWith(
      "prepare_withdrawal_logical_request",
      {
        p_user_id: owner,
        p_method: "USDT_ADDRESS",
        p_amount_krw: "1000",
        p_policy_id: policy,
        p_policy_version: 1,
        p_destination_id: dest,
        p_destination_fingerprint: null,
        p_confirmation: snapshot().confirmation,
      },
    );
  });
  it("ordinary USDT remains its existing seven-argument service path", async () => {
    const s = snapshot();
    delete (s as Partial<typeof s>).confirmation;
    const r = record({ v: 2 });
    delete (r as Partial<typeof r>).source;
    mocks.serviceRpc.mockResolvedValue({ data: r, error: null });
    expect((await POST(request("POST", s, "", false))).status).toBe(201);
    expect(mocks.memberRpc).not.toHaveBeenCalled();
    expect(Object.keys(mocks.serviceRpc.mock.calls[0]?.[1])).toHaveLength(7);
  });
  it("USDT prepare response with wrong method is never accepted as consent", async () => {
    mocks.memberRpc.mockResolvedValue({
      data: record({ method: "KRW_BANK" }),
      error: null,
    });
    expect((await POST(request("POST", snapshot(), "", false))).status).toBe(
      503,
    );
  });
  it("USDT pending and KRW eligibility stay separate without source conversion", async () => {
    mocks.serviceRpc.mockResolvedValue({
      data: record({ method: "KRW_BANK" }),
      error: null,
    });
    const result = await GET(request("GET", undefined, "?principal=usdt"));
    expect((await result.json()).data.record.method).toBe("KRW_BANK");
    expect(mocks.crypto).toHaveBeenCalledTimes(1);
    expect(mocks.memberRpc).not.toHaveBeenCalled();
  });
  it("USDT same-key confirmation binds original version and consent ID before resolution", async () => {
    mocks.serviceRpc
      .mockResolvedValueOnce({ data: record(), error: null })
      .mockResolvedValueOnce({
        data: record({ state: "CONFIRMED", withdrawalId: wd }),
        error: null,
      });
    expect(
      (
        await PATCH(
          request("PATCH", {
            action: "CONFIRM",
            withdrawalId: wd,
            recordVersion: 3,
            confirmationId: confirmation,
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.serviceRpc.mock.calls.map((c) => c[1].p_action)).toEqual([
      "RECOVER",
      "CONFIRM",
    ]);
    expect(mocks.memberRpc).not.toHaveBeenCalled();
  });
  it("missing session cannot read USDT facts or prepare either role", async () => {
    mocks.identity.mockResolvedValue(null);
    expect(
      (await GET(request("GET", undefined, "?principal=usdt"))).status,
    ).toBe(401);
    expect((await POST(request("POST", snapshot(), "", false))).status).toBe(
      401,
    );
    expect(mocks.crypto).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
    expect(mocks.memberRpc).not.toHaveBeenCalled();
  });
});
