import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  serviceRpc: vi.fn(),
  memberRpc: vi.fn(),
  serviceFrom: vi.fn(),
  principal: vi.fn(),
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
import { GET, PATCH, POST } from "@/app/api/v1/withdrawals/intents/route";
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  dest = "33333333-3333-4333-8333-333333333333",
  policy = "44444444-4444-4444-8444-444444444444",
  wd = "55555555-5555-4555-8555-555555555555",
  confirmation = "66666666-6666-4666-8666-666666666666",
  key = "principal-route-original-key-137";
function record(extra: Record<string, unknown> = {}) {
  return {
    v: 3,
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
    createdAt: "2026-10-06T00:00:00.123456Z",
    updatedAt: "2026-10-06T00:00:00.123456Z",
    expiresAt: "2099-10-07T00:00:00.123456Z",
    source: { version: 1, kind: "PRINCIPAL", confirmationId: confirmation },
    ...extra,
  };
}
function ordinary() {
  const r = record({ v: 2 });
  delete (r as Partial<typeof r>).source;
  return r;
}
const snapshot = () => ({
  method: "KRW_BANK",
  amountKrw: "1000",
  policyId: policy,
  policyVersion: 1,
  destinationId: dest,
  destination: null,
  confirmation: { version: 1, source: "PRINCIPAL", confirmed: true },
});
function request(method: string, body?: unknown, header = true) {
  return new Request("https://putduk.local/api/v1/withdrawals/intents", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(header ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ userId: owner, supabase: {} });
  mocks.principal.mockResolvedValue({ schemaVersion: 1, available: false });
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
describe("strict existing logical route source envelope", () => {
  it("principal confirmation uses actual member client and mandatory eighth argument, never service consent", async () => {
    mocks.memberRpc.mockResolvedValue({ data: record(), error: null });
    const result = await POST(request("POST", snapshot(), false));
    expect(result.status).toBe(201);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
    expect(mocks.memberRpc).toHaveBeenCalledWith(
      "prepare_withdrawal_logical_request",
      expect.objectContaining({
        p_user_id: owner,
        p_confirmation: snapshot().confirmation,
        p_destination_id: dest,
        p_destination_fingerprint: null,
      }),
    );
    expect((await result.json()).data.record.source.confirmationId).toBe(
      confirmation,
    );
  });
  it("ordinary mining retains the seven-argument service producer without a source default", async () => {
    const input = snapshot();
    delete (input as Partial<typeof input>).confirmation;
    mocks.serviceRpc.mockResolvedValue({ data: ordinary(), error: null });
    expect((await POST(request("POST", input, false))).status).toBe(201);
    expect(mocks.memberRpc).not.toHaveBeenCalled();
    expect(mocks.serviceRpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "p_confirmation",
    );
    expect(Object.keys(mocks.serviceRpc.mock.calls[0]?.[1])).toHaveLength(7);
  });
  it.each([false, "true", null])(
    "nonliteral consent %j never reaches either producer",
    async (confirmed) => {
      const input = {
        ...snapshot(),
        confirmation: { ...snapshot().confirmation, confirmed },
      };
      expect((await POST(request("POST", input, false))).status).toBe(400);
      expect(mocks.memberRpc).not.toHaveBeenCalled();
      expect(mocks.serviceRpc).not.toHaveBeenCalled();
    },
  );
  it("GET principal current facts is owner-bound and cannot create consent/hold", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: record(), error: null });
    const result = await GET(
      new Request(
        "https://putduk.local/api/v1/withdrawals/intents?principal=1",
      ),
    );
    expect(result.status).toBe(200);
    expect(mocks.principal).toHaveBeenCalledWith(
      expect.objectContaining({ userId: owner }),
    );
    expect(mocks.serviceRpc.mock.calls.map((c) => c[1].p_action)).toEqual([
      "RECOVER",
    ]);
    expect(mocks.memberRpc).not.toHaveBeenCalled();
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("ordinary GET retains shape and does not fetch new principal eligibility", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: ordinary(), error: null });
    const result = await GET(request("GET"));
    expect(Object.keys((await result.json()).data)).toEqual([
      "record",
      "protectionActive",
    ]);
    expect(mocks.principal).not.toHaveBeenCalled();
  });
  it.each([
    { ownerId: other },
    { v: 4 },
    { currentConditionId: "private" },
    { source: { version: 1, kind: "PRINCIPAL", confirmationId: "bad" } },
  ])("GET never serializes uncontracted records %j", async (extra) => {
    mocks.serviceRpc.mockResolvedValue({ data: record(extra), error: null });
    const result = await GET(request("GET"));
    expect(result.status).toBe(503);
    const body = JSON.stringify(await result.json());
    expect(body).not.toContain(other);
    expect(body).not.toContain("private");
    expect(body).not.toContain("source");
  });
  it.each([
    { action: "CANCEL" },
    { action: "CANCEL", recordVersion: 3, confirmationId: other },
  ])(
    "principal PATCH must bind original version and confirmation %j",
    async (body) => {
      mocks.serviceRpc.mockResolvedValue({ data: record(), error: null });
      expect((await PATCH(request("PATCH", body))).status).toBe(409);
      expect(mocks.serviceRpc.mock.calls.map((c) => c[1].p_action)).toEqual([
        "RECOVER",
      ]);
    },
  );
  it("principal same-key confirmation checks original before resolution then validates native outcome", async () => {
    mocks.serviceRpc
      .mockResolvedValueOnce({ data: record(), error: null })
      .mockResolvedValueOnce({
        data: record({ state: "CONFIRMED", withdrawalId: wd }),
        error: null,
      });
    const result = await PATCH(
      request("PATCH", {
        action: "CONFIRM",
        withdrawalId: wd,
        recordVersion: 3,
        confirmationId: confirmation,
      }),
    );
    expect(result.status).toBe(200);
    expect(mocks.serviceRpc.mock.calls.map((c) => c[1].p_action)).toEqual([
      "RECOVER",
      "CONFIRM",
    ]);
    expect(
      mocks.serviceRpc.mock.calls.every(
        (c) => c[1].p_user_id === owner && c[1].p_idempotency_key === key,
      ),
    ).toBe(true);
    expect(mocks.memberRpc).not.toHaveBeenCalled();
  });
  it("a v3 patch cannot mutate a recovered ordinary intent", async () => {
    mocks.serviceRpc.mockResolvedValue({ data: ordinary(), error: null });
    expect(
      (
        await PATCH(
          request("PATCH", {
            action: "CANCEL",
            recordVersion: 3,
            confirmationId: confirmation,
          }),
        )
      ).status,
    ).toBe(409);
    expect(mocks.serviceRpc).toHaveBeenCalledTimes(1);
  });
  it("v2 PATCH still uses existing action/key contract after exact recovery", async () => {
    mocks.serviceRpc
      .mockResolvedValueOnce({ data: ordinary(), error: null })
      .mockResolvedValueOnce({
        data: { ...ordinary(), state: "CANCELLED" },
        error: null,
      });
    expect((await PATCH(request("PATCH", { action: "CANCEL" }))).status).toBe(
      200,
    );
    expect(mocks.serviceRpc.mock.calls[1]?.[1]).toEqual({
      p_user_id: owner,
      p_action: "CANCEL",
      p_idempotency_key: key,
      p_withdrawal_id: null,
    });
  });
  it("source substitution after native resolution returns sanitized uncertainty", async () => {
    mocks.serviceRpc
      .mockResolvedValueOnce({ data: record(), error: null })
      .mockResolvedValueOnce({
        data: record({
          state: "CONFIRMED",
          withdrawalId: wd,
          source: { version: 1, kind: "PRINCIPAL", confirmationId: other },
        }),
        error: null,
      });
    const result = await PATCH(
      request("PATCH", {
        action: "CONFIRM",
        withdrawalId: wd,
        recordVersion: 3,
        confirmationId: confirmation,
      }),
    );
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain(other);
  });
  it("unknown principal amount response does not become accepted member evidence", async () => {
    mocks.memberRpc.mockResolvedValue({
      data: record({ amountKrw: "2000" }),
      error: null,
    });
    expect((await POST(request("POST", snapshot(), false))).status).toBe(503);
  });
  it("missing session reaches no service/member reads or writes", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await GET(request("GET"))).status).toBe(401);
    expect((await POST(request("POST", snapshot(), false))).status).toBe(401);
    expect((await PATCH(request("PATCH", { action: "CANCEL" }))).status).toBe(
      401,
    );
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
    expect(mocks.memberRpc).not.toHaveBeenCalled();
  });
});
