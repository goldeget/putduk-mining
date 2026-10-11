import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({
  identity: vi.fn(),
  rpc: vi.fn(),
  read: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getVerifiedIdentity: fixture.identity,
}));
vi.mock("@/lib/env/public", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "http://127.0.0.1:61441" }),
}));
import { handleMemberEventParticipation } from "@/lib/events/participation-handler.server";
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222",
  when = "2026-10-09T00:00:00Z";
const receipt = {
  eventId: id,
  revisionId: id,
  participantId: id,
  status: "JOINED",
  joinedAt: when,
  completedAt: null,
  rewardedAt: null,
  outboxId: other,
  replayed: false,
};
function request(
  body: unknown = { eventId: id, revisionId: id, idempotencyKey: other },
  origin = "http://127.0.0.1:61441",
) {
  return new Request("http://127.0.0.1:61441/api/v1/events/participation", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.rpc.mockResolvedValue({ data: receipt, error: null });
  fixture.read.mockResolvedValue({
    data: {
      id,
      event_id: id,
      user_id: id,
      status: "JOINED",
      joined_at: when,
      completed_at: null,
      rewarded_at: null,
    },
    error: null,
  });
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: fixture.read,
  };
  fixture.from.mockReturnValue(query);
  fixture.identity.mockResolvedValue({
    userId: id,
    supabase: { rpc: fixture.rpc, from: fixture.from },
  });
});
describe("member event canonical command", () => {
  it("uses owned authenticated RPC without a service override, verifies own result and carries exact intent key", async () => {
    const response = await handleMemberEventParticipation(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(receipt);
    expect(fixture.rpc).toHaveBeenCalledWith(
      "participate_published_event",
      expect.objectContaining({
        p_event_id: id,
        p_revision_id: id,
        p_idempotency_key: other,
      }),
    );
    expect(fixture.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_user_id");
    expect(fixture.from).toHaveBeenCalledWith("event_participants");
  });
  it("rejects cross-site and client financial/ownership claims before authentication or DB execution", async () => {
    expect(
      (
        await handleMemberEventParticipation(
          request(undefined, "https://evil.invalid"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleMemberEventParticipation(
          request({
            eventId: id,
            revisionId: id,
            idempotencyKey: other,
            userId: other,
            amount: 10000,
          }),
        )
      ).status,
    ).toBe(400);
    expect(fixture.identity).not.toHaveBeenCalled();
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("does not execute for an unauthenticated account", async () => {
    fixture.identity.mockResolvedValue(null);
    expect((await handleMemberEventParticipation(request())).status).toBe(401);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("hides private SQL errors and treats unconfirmed transport/missing receipt as uncertain", async () => {
    fixture.rpc.mockResolvedValue({
      data: null,
      error: { message: "private policy internals" },
    });
    const response = await handleMemberEventParticipation(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private policy",
    );
    fixture.rpc.mockRejectedValue(new Error("private token"));
    expect((await handleMemberEventParticipation(request())).status).toBe(503);
  });
  it("reports a current DB restriction or lost authenticated SQL context as a definite denial", async () => {
    fixture.rpc.mockResolvedValue({
      data: null,
      error: { message: "EVENT_MEMBER_RESTRICTED" },
    });
    expect((await handleMemberEventParticipation(request())).status).toBe(409);
    fixture.rpc.mockResolvedValue({
      data: null,
      error: { message: "EVENT_AUTH_REQUIRED" },
    });
    const denied = await handleMemberEventParticipation(request());
    expect(denied.status).toBe(401);
    expect((await denied.json()).error.code).toBe("UNAUTHENTICATED");
    expect(fixture.read).not.toHaveBeenCalled();
  });
  it("accepts the configured browser origin behind a reconstructed internal host and never trusts forwarding headers", async () => {
    const internal = new Request(
      "http://localhost:61441/api/v1/events/participation",
      {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:61441",
          "Content-Type": "application/json",
          "x-forwarded-host": "evil.invalid",
        },
        body: JSON.stringify({
          eventId: id,
          revisionId: id,
          idempotencyKey: other,
        }),
      },
    );
    expect((await handleMemberEventParticipation(internal)).status).toBe(200);
    const hostile = new Request(internal.url, {
      method: "POST",
      headers: {
        origin: "https://evil.invalid",
        "Content-Type": "application/json",
        "x-forwarded-host": "127.0.0.1:61441",
      },
      body: JSON.stringify({
        eventId: id,
        revisionId: id,
        idempotencyKey: other,
      }),
    });
    expect((await handleMemberEventParticipation(hostile)).status).toBe(403);
    expect(fixture.rpc).toHaveBeenCalledTimes(1);
  });
  it("denies stale/risk/idempotency conflicts and mismatched ownership readback", async () => {
    fixture.rpc.mockResolvedValue({
      data: null,
      error: { message: "EVENT_RISK_DENIED" },
    });
    expect((await handleMemberEventParticipation(request())).status).toBe(409);
    fixture.rpc.mockResolvedValue({ data: receipt, error: null });
    fixture.read.mockResolvedValue({
      data: {
        id,
        event_id: id,
        user_id: other,
        status: "JOINED",
        joined_at: when,
      },
      error: null,
    });
    expect((await handleMemberEventParticipation(request())).status).toBe(503);
    fixture.rpc.mockResolvedValue({
      data: { ...receipt, revisionId: other },
      error: null,
    });
    expect((await handleMemberEventParticipation(request())).status).toBe(503);
  });
});

describe("explicit local cash terms acknowledgement", () => {
  const digest = "a".repeat(64);
  const cashInput = {
    eventId: id,
    revisionId: id,
    idempotencyKey: other,
    cashTermsDigest: digest,
  };
  const cashReceipt = {
    ...receipt,
    cashTermsDigest: digest,
    cashTermsVersion: 1,
    cashConsentRecorded: true,
    scope: "LOCAL_QA",
  };
  it("passes only the acknowledged digest to the owned authenticated overload and confirms its receipt", async () => {
    fixture.rpc.mockResolvedValue({ data: cashReceipt, error: null });
    const response = await handleMemberEventParticipation(request(cashInput));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(cashReceipt);
    const args = fixture.rpc.mock.calls[0]?.[1];
    expect(args).toEqual({
      p_event_id: id,
      p_revision_id: id,
      p_idempotency_key: other,
      p_request_id: expect.any(String),
      p_cash_terms_digest: digest,
    });
    expect(args).not.toHaveProperty("p_user_id");
    expect(args).not.toHaveProperty("p_amount");
    expect(fixture.read).toHaveBeenCalledOnce();
  });
  it("preserves NONE joins without inventing consent and rejects unsolicited cash acknowledgements", async () => {
    expect((await handleMemberEventParticipation(request())).status).toBe(200);
    expect(fixture.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "p_cash_terms_digest",
    );
    fixture.rpc.mockResolvedValue({ data: cashReceipt, error: null });
    expect((await handleMemberEventParticipation(request())).status).toBe(503);
  });
  for (const invalid of ["", "A".repeat(64), "a".repeat(63), null, 1000]) {
    it(`rejects malformed cash acknowledgement ${JSON.stringify(invalid)} before authentication`, async () => {
      const response = await handleMemberEventParticipation(
        request({ ...cashInput, cashTermsDigest: invalid }),
      );
      expect(response.status).toBe(400);
      expect(fixture.identity).not.toHaveBeenCalled();
      expect(fixture.rpc).not.toHaveBeenCalled();
    });
  }
  for (const patch of [
    { cashTermsDigest: "b".repeat(64) },
    { cashConsentRecorded: false },
    { cashTermsVersion: 0 },
    { scope: "production" },
    { privateBudget: 400000 },
  ]) {
    it(`rejects unconfirmed or inconsistent cash receipt ${Object.keys(patch)[0]}`, async () => {
      fixture.rpc.mockResolvedValue({
        data: { ...cashReceipt, ...patch },
        error: null,
      });
      expect(
        (await handleMemberEventParticipation(request(cashInput))).status,
      ).toBe(503);
      expect(fixture.read).not.toHaveBeenCalled();
    });
  }
  it("requires a positive explicit consent receipt even when legacy join succeeded", async () => {
    fixture.rpc.mockResolvedValue({ data: receipt, error: null });
    expect(
      (await handleMemberEventParticipation(request(cashInput))).status,
    ).toBe(503);
    expect(fixture.read).not.toHaveBeenCalled();
  });
  for (const code of [
    "LOCAL_CASH_DISABLED",
    "LOCAL_CASH_EXPLICIT_TERMS_MISMATCH",
    "LOCAL_CASH_CONSENT_REPLAY_CONFLICT",
  ]) {
    it(`reports ${code} as a definite participation denial`, async () => {
      fixture.rpc.mockResolvedValue({ data: null, error: { message: code } });
      const response = await handleMemberEventParticipation(request(cashInput));
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe(code);
      expect(fixture.read).not.toHaveBeenCalled();
    });
  }
  it("keeps cross-site, unauthenticated and client money claims outside the cash command", async () => {
    expect(
      (
        await handleMemberEventParticipation(
          request(cashInput, "https://evil.invalid"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleMemberEventParticipation(
          request({ ...cashInput, beneficiaryUserId: other, amount: 1000 }),
        )
      ).status,
    ).toBe(400);
    expect(fixture.identity).not.toHaveBeenCalled();
    fixture.identity.mockResolvedValue(null);
    expect(
      (await handleMemberEventParticipation(request(cashInput))).status,
    ).toBe(401);
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it("still verifies cash participation readback belongs to the authenticated member", async () => {
    fixture.rpc.mockResolvedValue({ data: cashReceipt, error: null });
    fixture.read.mockResolvedValue({
      data: {
        id,
        event_id: id,
        user_id: other,
        status: "JOINED",
        joined_at: when,
      },
      error: null,
    });
    expect(
      (await handleMemberEventParticipation(request(cashInput))).status,
    ).toBe(503);
  });
});
