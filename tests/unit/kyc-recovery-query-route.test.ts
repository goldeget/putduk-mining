import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const identity = vi.hoisted(() => vi.fn());
const admin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/kyc/operations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getVerifiedKycIdentity: identity,
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: admin }));
import { GET } from "@/app/api/v1/kyc/documents/route";
const owner = "7aaa0000-0000-4000-8000-000000000001",
  caseId = "7aaa0000-0000-4000-8000-000000000002",
  key = "7aaa0000-0000-4000-8000-000000000003",
  submission = "7aaa0000-0000-4000-8000-000000000004",
  otherCase = "7aaa0000-0000-4000-8000-000000000005";
let owned: boolean,
  receipt: Record<string, unknown> | null,
  accepted: Record<string, unknown> | null,
  pending: Record<string, unknown>[],
  count: number;
const lookup = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  owned = true;
  receipt = null;
  accepted = null;
  pending = [];
  count = 0;
  const ownerQuery = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: owned ? { id: caseId, status: "REJECTED" } : null,
      error: null,
    })),
    in: vi.fn(async () => ({
      data: owned ? [{ id: caseId, status: "REJECTED" }] : [],
      error: null,
    })),
  };
  identity.mockResolvedValue({
    userId: owner,
    authSessionId: key,
    supabase: { from: () => ({ select: () => ownerQuery }) },
  });
  const receipts = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: receipt, error: null })),
    limit: vi.fn(async () => ({ data: pending, count, error: null })),
  };
  lookup.mockImplementation(async () => ({ data: accepted, error: null }));
  admin.mockReturnValue({
    from: () => ({ select: () => receipts }),
    rpc: lookup,
  });
});
const request = (withKey = true) =>
  new Request("https://mining.example.test/api/v1/kyc/documents", {
    headers: withKey
      ? {
          "Idempotency-Key": key.toUpperCase(),
          "Kyc-Case-Id": caseId.toUpperCase(),
        }
      : {},
  });
describe("owner-only KYC recovery query", () => {
  it("foreign case bookmarks never expose an owner receipt or historical document", async () => {
    owned = false;
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("historical evidence uses bounded server lookup with normalized owner/case/key and no private metadata", async () => {
    accepted = { id: submission, case_id: caseId };
    const response = await GET(request());
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        receipt: { state: "CONFIRMED", submissionId: submission, caseId },
      },
    });
    expect(lookup).toHaveBeenCalledWith("lookup_kyc_submission", {
      p_user_id: owner,
      p_case_id: caseId,
      p_request_id: key,
    });
    expect(JSON.stringify(body)).not.toMatch(/path|hash|mime|filename/);
  });
  it("an owned but different case cannot read the same owner's other-case receipt", async () => {
    receipt = {
      result_id: submission,
      resolution: null,
      request_payload: { case_id: otherCase },
    };
    expect((await GET(request())).status).toBe(409);
    expect(lookup).not.toHaveBeenCalled();
  });
  it("historical ambiguity never chooses one of two accepted variants", async () => {
    lookup.mockResolvedValue({
      data: null,
      error: { message: "KYC_LEGACY_SUBMISSION_AMBIGUOUS" },
    });
    expect((await GET(request())).status).toBe(503);
  });
  it("an accepted historical row cannot be hidden by an absence tombstone", async () => {
    receipt = {
      result_id: null,
      resolution: "CASE_CLOSED",
      request_payload: { case_id: caseId },
    };
    accepted = { id: submission, case_id: caseId };
    expect((await GET(request())).status).toBe(503);
  });
  it("a completed receipt without its actual submission remains unconfirmed", async () => {
    receipt = {
      result_id: submission,
      resolution: null,
      request_payload: { case_id: caseId },
    };
    expect((await GET(request())).status).toBe(503);
  });
  it("pending lists return only opaque identity/state and mark truncation", async () => {
    pending = [
      {
        request_id: key,
        request_payload: {
          case_id: caseId,
          path: "PRIVATE_PATH",
          content_sha256: "PRIVATE_HASH",
        },
        created_at: "2026-10-12T00:00:00Z",
      },
    ];
    count = 51;
    const response = await GET(request(false));
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        attempts: [{ requestId: key, caseId, state: "PENDING", closed: true }],
        incomplete: true,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(
      /PRIVATE_PATH|PRIVATE_HASH|request_payload|content_sha256/,
    );
  });
  it("a terminal absence tombstone returns closed rather than a fictitious submission", async () => {
    receipt = {
      result_id: null,
      resolution: "CASE_CLOSED",
      request_payload: { case_id: caseId },
    };
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({
      data: { receipt: { state: "CLOSED", caseId } },
    });
    expect(body.data.receipt).not.toHaveProperty("submissionId");
  });
});
