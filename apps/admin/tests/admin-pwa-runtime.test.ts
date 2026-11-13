import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  read: vi.fn(),
  service: vi.fn(),
  memberRpc: vi.fn(),
}));
vi.mock("../lib/workroom/server", () => ({
  workroomDependencies: {
    authorize: mocks.authorize,
    authorizeRead: mocks.read,
  },
}));
vi.mock("../lib/supabase/service", () => ({
  createAdminServiceClient: () => ({ rpc: mocks.service }),
}));
import {
  adminPushCommand,
  adminPushConfig,
  revokeAdminPushForLogout,
} from "../lib/notifications/runtime";
const userId = "10000000-0000-4000-8000-000000000001",
  sessionId = "10000000-0000-4000-8000-000000000002",
  subscriptionId = "10000000-0000-4000-8000-000000000003",
  intentId = "10000000-0000-4000-8000-000000000004",
  permitId = "10000000-0000-4000-8000-000000000005";
const principal = {
  userId,
  sessionId,
  adminSessionId: permitId,
  aal: "aal2",
  supabase: { rpc: mocks.memberRpc },
};
function request(body: unknown) {
  return new Request(
    "https://admin.workroom.putduk.com/api/v1/admin/notifications/subscriptions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://admin.workroom.putduk.com",
      },
      body: JSON.stringify(body),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ ok: true, principal });
  mocks.read.mockResolvedValue({ ok: true, principal });
  mocks.memberRpc.mockResolvedValue({ data: { bound: true }, error: null });
});
describe("admin-origin PWA runtime", () => {
  it("refuses missing/revoked MFA session before subscription mutation", async () => {
    mocks.authorize.mockResolvedValue({
      ok: false,
      code: "MFA_REQUIRED",
      status: 403,
    });
    expect((await adminPushCommand(request({}))).status).toBe(403);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("binds only the verified admin's exact canonical registration receipt", async () => {
    mocks.service.mockResolvedValue({
      data: {
        operation: "REGISTER",
        authSessionId: sessionId,
        endpointEpoch: 1,
        intentId,
        permitId,
        subscribed: true,
        scope: "CURRENT_SESSION",
        receiptId: intentId,
        subscriptionId,
      },
      error: null,
    });
    const sub = {
      endpoint: "https://fcm.googleapis.com/fcm/send/fixture",
      expirationTime: null,
      keys: {
        p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString(
          "base64url",
        ),
        auth: Buffer.alloc(16, 1).toString("base64url"),
      },
    };
    const response = await adminPushCommand(
      request({
        operation: "REGISTER",
        subscription: sub,
        expectedEpoch: 0,
        intentId,
        permitId,
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.memberRpc).toHaveBeenCalledWith(
      "workroom_app_admin",
      expect.objectContaining({
        p_operation: "PUSH_BIND_ADMIN",
        p_actor: userId,
        p_auth_session_id: sessionId,
        p_verified_aal: "aal2",
        p_input: { subscriptionId },
      }),
    );
  });
  it("does not report a subscription saved if origin marking fails", async () => {
    mocks.service.mockResolvedValue({
      data: {
        operation: "SNAPSHOT",
        authSessionId: "10000000-0000-4000-8000-000000000099",
        endpointEpoch: 2,
        subscribed: true,
      },
      error: null,
    });
    expect(
      (
        await adminPushCommand(
          request({
            operation: "SNAPSHOT",
            endpoint: "https://fcm.googleapis.com/fcm/send/fixture",
          }),
        )
      ).status,
    ).toBe(503);
    expect(mocks.memberRpc).not.toHaveBeenCalled();
  });
  it("keeps public VAPID config behind current admin verification and no-store", async () => {
    mocks.read.mockResolvedValue({
      ok: false,
      code: "SESSION_REVOKED",
      status: 403,
    });
    expect((await adminPushConfig(request({}))).status).toBe(403);
    mocks.read.mockResolvedValue({ ok: true, principal });
    const response = await adminPushConfig(request({}));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(Object.keys((await response.json()).data)).toEqual([
      "publicKey",
      "configured",
    ]);
  });
  it("does not confirm admin logout push revocation on a mismatched receipt", async () => {
    mocks.service.mockResolvedValue({
      data: { subscribed: false },
      error: null,
    });
    expect(await revokeAdminPushForLogout(userId, sessionId)).toBe(false);
  });
});
