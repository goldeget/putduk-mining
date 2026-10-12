import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const identity = vi.hoisted(() => vi.fn());
const claim = vi.hoisted(() => vi.fn());
const admin = vi.hoisted(() => vi.fn());
const origin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/kyc/operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/kyc/operations")>()),
  getVerifiedKycIdentity: identity,
  claimKycOperation: claim,
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: admin }));
vi.mock("@/lib/kyc/request", () => ({ hasKycOrigin: origin }));
import { POST } from "@/app/api/v1/kyc/documents/reconcile/route";
const owner = "79aa0000-0000-4000-8000-000000000001",
  caseId = "79aa0000-0000-4000-8000-000000000002",
  key = "79aa0000-0000-4000-8000-000000000003",
  submission = "79aa0000-0000-4000-8000-000000000004";
const payload = {
  case_id: caseId,
  document_kind: "IDENTITY_DOCUMENT",
  path: `${owner}/${caseId}/${key}`,
  content_sha256: "a".repeat(64),
  mime_type: "application/pdf",
  size_bytes: 10,
};
let initial: Record<string, unknown> | null,
  status: string,
  resolved: Record<string, unknown>;
const rpc = vi.fn(),
  storage = vi.fn();
function request() {
  const form = new FormData();
  form.set("requestId", key);
  form.set("caseId", caseId);
  return new Request(
    "https://mining.example.test/api/v1/kyc/documents/reconcile",
    { method: "POST", body: form },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  origin.mockReturnValue(true);
  status = "REJECTED";
  initial = { request_payload: payload, result_id: null, resolution: null };
  resolved = { result_id: null, resolution: "CASE_CLOSED" };
  const own = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: { id: caseId, status },
      error: null,
    })),
  };
  identity.mockResolvedValue({
    userId: owner,
    authSessionId: key,
    supabase: { from: () => ({ select: () => own }) },
  });
  const query = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: initial, error: null })),
    single: vi.fn(async () => ({ data: resolved, error: null })),
  };
  admin.mockReturnValue({
    from: () => ({ select: () => query }),
    rpc,
    storage: { from: storage },
  });
  rpc.mockResolvedValue({ data: null, error: null });
  claim.mockResolvedValue(initial);
});
describe("closed KYC attempt reconciliation", () => {
  it("open cases remain pending without storage access or another RPC submission", async () => {
    status = "IN_REVIEW";
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      data: { state: "PENDING", caseId },
    });
    expect(claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: key, payload }),
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it("an admitted live case adopts the actual legacy submission before returning pending", async () => {
    status = "IN_REVIEW";
    claim.mockResolvedValue({ ...initial, result_id: submission });
    const response = await POST(request());
    expect(await response.json()).toMatchObject({
      data: { state: "CONFIRMED", submissionId: submission, caseId },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it("closed cases use the same claimed key and server payload to obtain a terminal receipt", async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      data: { state: "CLOSED", caseId },
    });
    expect(claim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: key, payload, userId: owner }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "submit_kyc_documents",
      expect.objectContaining({
        p_request_id: key,
        p_case_id: caseId,
        p_user_id: owner,
        p_content_sha256: payload.content_sha256,
      }),
    );
    expect(storage).not.toHaveBeenCalled();
  });
  it("an existing accepted submission is confirmed before terminal closure", async () => {
    rpc.mockResolvedValue({ data: submission, error: null });
    const result = await POST(request());
    expect(await result.json()).toMatchObject({
      data: { state: "CONFIRMED", submissionId: submission },
    });
  });
  it("completed receipts replay without attempting another mutation", async () => {
    initial = {
      request_payload: payload,
      result_id: submission,
      resolution: null,
    };
    expect((await POST(request())).status).toBe(200);
    expect(claim).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a missing claim on a closed case requires an atomic owner/case/key absence tombstone", async () => {
    initial = null;
    rpc.mockImplementation(async (name: string) => ({
      data: name === "resolve_missing_kyc_attempt" ? true : null,
      error: null,
    }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { state: "CLOSED", caseId },
    });
    expect(claim).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("resolve_missing_kyc_attempt", {
      p_user_id: owner,
      p_case_id: caseId,
      p_request_id: key,
      p_auth_session_id: key,
    });
  });
  it("a missing receipt with actual legacy evidence confirms its original id", async () => {
    initial = null;
    rpc.mockResolvedValue({
      data: { id: submission, case_id: caseId },
      error: null,
    });
    const result = await POST(request());
    expect(await result.json()).toMatchObject({
      data: { state: "CONFIRMED", submissionId: submission, caseId },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(claim).not.toHaveBeenCalled();
  });
  it("a missing claim on a live case cannot be dismissed", async () => {
    initial = null;
    status = "PENDING";
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ data: { state: "PENDING" } });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "lookup_kyc_submission",
      expect.objectContaining({ p_case_id: caseId }),
    );
  });
  it("a late competing claim makes absence unresolved rather than falsely closed", async () => {
    initial = null;
    rpc.mockImplementation(async (name: string) => ({
      data: name === "resolve_missing_kyc_attempt" ? false : null,
      error: null,
    }));
    expect(await (await POST(request())).json()).toMatchObject({
      data: { state: "PENDING" },
    });
  });
  it("null RPC without a terminal server receipt remains unconfirmed", async () => {
    resolved = { result_id: null, resolution: null };
    expect((await POST(request())).status).toBe(503);
  });
});
