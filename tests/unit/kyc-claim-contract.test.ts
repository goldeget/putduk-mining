import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const identityMock = vi.hoisted(() => vi.fn());
const adminMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: identityMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: adminMock,
}));
import {
  claimKycOperation,
  getVerifiedKycIdentity,
  KycConflict,
} from "@/lib/kyc/operations";
const owner = "76aa0000-0000-4000-8000-000000000001",
  session = "76aa0000-0000-4000-8000-000000000002",
  key = "76aa0000-0000-4000-8000-000000000003";
beforeEach(() => vi.resetAllMocks());
function fakeDb(payload: unknown = {}, result: string | null = null) {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      user_id: owner,
      operation: "OPEN",
      request_id: key,
      request_payload: payload,
      result_id: result,
      resolution: null,
      completed_at: result ? "2026-10-12T00:00:00Z" : null,
    },
    error: null,
  });
  const from = vi.fn();
  return { client: { from, rpc } as unknown as SupabaseClient, rpc, from };
}
describe("durable KYC claim protocol", () => {
  it("uses one owner-first claim RPC with canonical owner/operation/key/payload and server session binding", async () => {
    const db = fakeDb();
    await claimKycOperation(db.client, {
      userId: owner,
      authSessionId: session,
      operation: "OPEN",
      requestId: key,
      payload: {},
    });
    expect(db.rpc).toHaveBeenCalledWith("claim_kyc_operation", {
      p_user_id: owner,
      p_operation: "OPEN",
      p_request_id: key,
      p_auth_session_id: session,
      p_request_payload: {},
    });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("does not mutate a completed receipt", async () => {
    const db = fakeDb({}, key);
    expect(
      (
        await claimKycOperation(db.client, {
          userId: owner,
          authSessionId: session,
          operation: "OPEN",
          requestId: key,
          payload: {},
        })
      ).result_id,
    ).toBe(key);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("different canonical payload is a conflict rather than a new operation", async () => {
    const db = fakeDb();
    db.rpc.mockResolvedValue({
      data: null,
      error: { message: "KYC_IDEMPOTENCY_CONFLICT" },
    });
    await expect(
      claimKycOperation(db.client, {
        userId: owner,
        authSessionId: session,
        operation: "OPEN",
        requestId: key,
        payload: {},
      }),
    ).rejects.toBeInstanceOf(KycConflict);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("refuses an unconfirmed admission before reading receipts", async () => {
    const db = fakeDb();
    db.rpc.mockResolvedValue({
      data: null,
      error: { message: "KYC_SESSION_REQUIRED" },
    });
    await expect(
      claimKycOperation(db.client, {
        userId: owner,
        authSessionId: session,
        operation: "OPEN",
        requestId: key,
        payload: {},
      }),
    ).rejects.toThrow("KYC_SESSION_REQUIRED");
    expect(db.from).not.toHaveBeenCalled();
  });
  it("a malformed owner/key or payload result cannot be reported as a claim", async () => {
    const db = fakeDb({ forged: true });
    await expect(
      claimKycOperation(db.client, {
        userId: owner,
        authSessionId: session,
        operation: "OPEN",
        requestId: key,
        payload: {},
      }),
    ).rejects.toThrow("KYC_CLAIM_UNCONFIRMED");
    db.rpc.mockResolvedValue({
      data: {
        user_id: key,
        operation: "OPEN",
        request_id: key,
        request_payload: {},
        result_id: null,
        resolution: null,
        completed_at: null,
      },
      error: null,
    });
    await expect(
      claimKycOperation(db.client, {
        userId: owner,
        authSessionId: session,
        operation: "OPEN",
        requestId: key,
        payload: {},
      }),
    ).rejects.toThrow("KYC_CLAIM_UNCONFIRMED");
  });
  it("requires matching fresh user/claims and a current owner session row", async () => {
    const auth = {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: owner } }, error: null }),
      getClaims: vi.fn().mockResolvedValue({
        data: { claims: { sub: owner, session_id: session } },
        error: null,
      }),
    };
    identityMock.mockResolvedValue({ userId: owner, supabase: { auth } });
    const live = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi
        .fn()
        .mockResolvedValue({ data: { id: session }, error: null }),
    };
    adminMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(live) }),
    });
    expect((await getVerifiedKycIdentity())?.authSessionId).toBe(session);
    expect(live.eq).toHaveBeenCalledWith("user_id", owner);
    live.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getVerifiedKycIdentity()).toBeNull();
    auth.getUser.mockResolvedValue({
      data: { user: { id: key } },
      error: null,
    });
    expect(await getVerifiedKycIdentity()).toBeNull();
  });
});
