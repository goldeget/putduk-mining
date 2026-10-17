import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/notifications/push-binding.server", () => ({
  getVerifiedPushIdentity: mocks.identity,
  applyPushEndpoint: mocks.apply,
}));
import { POST, DELETE } from "@/app/api/v1/notifications/subscriptions/route";
const endpoint = "https://fcm.googleapis.com/fcm/send/local-contract-fixture";
const intentId = "11111111-1111-4111-8111-111111111113",
  permitId = "11111111-1111-4111-8111-111111111114";
const subscription = {
  endpoint,
  expirationTime: null,
  keys: {
    auth: Buffer.alloc(16, 1).toString("base64url"),
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 2)]).toString(
      "base64url",
    ),
  },
};
const registration = {
  operation: "REGISTER",
  subscription,
  expectedEpoch: 2,
  intentId,
  permitId,
};
function request(
  method: string,
  body: unknown,
  origin = "https://mining.putduk.com",
) {
  return new Request(
    "https://mining.putduk.com/api/v1/notifications/subscriptions",
    {
      method,
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    userId: "11111111-1111-4111-8111-111111111111",
    authSessionId: "22222222-2222-4222-8222-222222222222",
    supabase: {},
  });
  mocks.apply.mockResolvedValue({ ok: true, receipt: { subscribed: true } });
});
describe("epoch Push API binds only server-verified sessions", () => {
  it("rejects cross-origin before identity and mutation", async () => {
    expect(
      (await POST(request("POST", registration, "https://evil.invalid")))
        .status,
    ).toBe(403);
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("requires a server identity", async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await POST(request("POST", registration))).status).toBe(401);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("rejects legacy unbound JSON and identity/epoch injection", async () => {
    for (const body of [
      subscription,
      { ...registration, userId: "spoof" },
      { ...registration, authSessionId: "spoof" },
      { ...registration, expectedEpoch: -1 },
      {
        ...registration,
        subscription: {
          ...subscription,
          endpoint: "https://127.0.0.1/fcm/send/x",
        },
      },
    ])
      expect((await POST(request("POST", body))).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("passes expected epoch and permit to the strict server helper", async () => {
    expect((await POST(request("POST", registration))).status).toBe(201);
    expect(mocks.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        authSessionId: "22222222-2222-4222-8222-222222222222",
      }),
      expect.objectContaining(registration),
    );
  });
  it("does not turn stale issue or old revoke receipt into current off success", async () => {
    mocks.apply.mockResolvedValue({ ok: false, code: "PUSH_INTENT_STALE" });
    expect(
      (
        await POST(
          request("POST", {
            ...registration,
            operation: "ISSUE",
            permitId: undefined,
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await DELETE(request("DELETE", { endpoint, intentId }))).status,
    ).toBe(409);
  });
  it("DELETE requires its stable intent id and preserves unknown results", async () => {
    expect((await DELETE(request("DELETE", { endpoint }))).status).toBe(400);
    mocks.apply.mockResolvedValue({
      ok: false,
      code: "PUSH_SUBSCRIPTION_UNAVAILABLE",
    });
    expect(
      (await DELETE(request("DELETE", { endpoint, intentId }))).status,
    ).toBe(503);
  });
});
