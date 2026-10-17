import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const gate = vi.hoisted(() => vi.fn());
const service = vi.hoisted(() => vi.fn());
vi.mock("@/app/(control)/_lib/command-gate", () => ({
  requireHighImpactPrincipal: gate,
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: service,
}));
import { POST } from "@/app/api/kyc/evidence/[submissionId]/acknowledge/route";
const actor = "76aa0000-0000-4000-8000-000000000001",
  submission = "76aa0000-0000-4000-8000-000000000002",
  receipt = "76aa0000-0000-4000-8000-000000000003",
  session = "76aa0000-0000-4000-8000-000000000004",
  adminSession = "76aa0000-0000-4000-8000-000000000005",
  requestId = "76aa0000-0000-4000-8000-000000000006";
const rpc = vi.fn();
const context = () => ({
  params: Promise.resolve({ submissionId: submission }),
});
function request(confirm = true) {
  const form = new FormData();
  form.set("receiptId", receipt);
  form.set("contentSha256", "a".repeat(64));
  form.set("stepUpToken", "ephemeral-test-token-only");
  if (confirm) form.set("confirmation", "CONFIRM_KYC_CONTENT_REVIEWED");
  return new Request(
    "https://admin.example.test/api/kyc/evidence/acknowledge",
    { method: "POST", body: form },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  gate.mockResolvedValue({
    ok: true,
    requestId,
    principal: {
      userId: actor,
      sessionId: session,
      adminSessionId: adminSession,
      role: "ADMIN",
    },
  });
  service.mockReturnValue({ rpc });
  rpc.mockResolvedValue({ error: null, data: receipt });
});
describe("explicit KYC evidence content attestation", () => {
  it("file receipt alone cannot produce an acknowledgment", async () => {
    expect((await POST(request(false), context())).status).toBe(400);
    expect(gate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("current high-impact gate is required separately from download", async () => {
    gate.mockResolvedValue({ ok: false });
    expect((await POST(request(), context())).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("binds server identity and admin/auth session to the client byte hash and opaque receipt", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("acknowledge_kyc_evidence", {
      p_receipt_id: receipt,
      p_submission_id: submission,
      p_actor: actor,
      p_admin_session_id: adminSession,
      p_auth_session_id: session,
      p_content_sha256: "a".repeat(64),
      p_request_id: requestId,
    });
    expect(await response.json()).toEqual({
      data: {
        receiptId: receipt,
        submissionId: submission,
        state: "ACKNOWLEDGED",
      },
    });
  });
  it.each([
    "KYC_DELIVERY_EXPIRED",
    "KYC_DELIVERY_BINDING_REQUIRED",
    "KYC_REVIEW_SESSION_REQUIRED",
  ])("%s remains unconfirmed rather than reporting a view", async (message) => {
    rpc.mockResolvedValue({ error: { message }, data: null });
    expect((await POST(request(), context())).status).toBe(503);
  });
  it("a malformed RPC result never becomes a confirmed content review", async () => {
    rpc.mockResolvedValue({ error: null, data: submission });
    expect((await POST(request(), context())).status).toBe(503);
  });
  it("same receipt retry returns the durable acknowledgment identifier", async () => {
    expect((await POST(request(), context())).status).toBe(200);
    expect((await POST(request(), context())).status).toBe(200);
    expect(rpc.mock.calls[1]![1].p_receipt_id).toBe(receipt);
  });
});
