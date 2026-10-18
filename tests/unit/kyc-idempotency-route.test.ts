import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  claim: vi.fn(),
  origin: vi.fn(),
  admin: vi.fn(),
}));
vi.mock("@/lib/kyc/operations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getVerifiedKycIdentity: mocks.identity,
  claimKycOperation: mocks.claim,
}));
vi.mock("@/lib/kyc/request", () => ({ hasKycOrigin: mocks.origin }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.admin,
}));
import { POST } from "@/app/api/v1/kyc/documents/route";
import { KycConflict } from "@/lib/kyc/operations";
const owner = "76aa0000-0000-4000-8000-000000000001",
  caseId = "76aa0000-0000-4000-8000-000000000002",
  key = "76aa0000-0000-4000-8000-000000000003",
  resultId = "76aa0000-0000-4000-8000-000000000004";
let upload: ReturnType<typeof vi.fn>,
  download: ReturnType<typeof vi.fn>,
  rpc: ReturnType<typeof vi.fn>;
let owned: { id: string; status: string } | null;
function request(fileName = "file.pdf", content = "%PDF-1.7\nfixture") {
  const form = new FormData();
  form.set("caseId", caseId);
  form.set("documentKind", "IDENTITY_DOCUMENT");
  form.set("file", new File([content], fileName, { type: "text/html" }));
  return new Request("https://mining.example.test/api/v1/kyc/documents", {
    method: "POST",
    headers: { origin: "https://mining.example.test", "Idempotency-Key": key },
    body: form,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  owned = { id: caseId, status: "PENDING" };
  mocks.origin.mockReturnValue(true);
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data: owned, error: null })),
  };
  mocks.identity.mockResolvedValue({
    userId: owner,
    authSessionId: key,
    supabase: { from: () => query },
  });
  mocks.claim.mockResolvedValue({
    request_payload: {},
    result_id: null,
    completed_at: null,
  });
  upload = vi.fn().mockResolvedValue({ error: null });
  download = vi.fn();
  rpc = vi.fn().mockResolvedValue({ data: resultId, error: null });
  mocks.admin.mockReturnValue({
    storage: { from: () => ({ upload, download }) },
    rpc,
  });
});
describe("KYC document transport contracts", () => {
  it("rejects origin before identity, claim or Storage", async () => {
    mocks.origin.mockReturnValue(false);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it("rejects an unrelated owner without claim", async () => {
    owned = null;
    expect((await POST(request())).status).toBe(404);
    expect(mocks.claim).not.toHaveBeenCalled();
  });
  it("replays a completed receipt without Storage or domain mutation, even after closure", async () => {
    owned = { id: caseId, status: "APPROVED" };
    mocks.claim.mockResolvedValue({ result_id: resultId });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { submissionId: resultId } });
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects reused key with another payload before Storage", async () => {
    mocks.claim.mockRejectedValue(new KycConflict("KYC_IDEMPOTENCY_CONFLICT"));
    expect((await POST(request())).status).toBe(409);
    expect(upload).not.toHaveBeenCalled();
  });
  it("claims server actual type/hash before upload, and ignores supplied filename extension", async () => {
    const response = await POST(request("photo.png"));
    expect(response.status).toBe(201);
    const payload = mocks.claim.mock.calls[0]![1].payload;
    expect(payload.path).toBe(`${owner}/${caseId}/${key}`);
    expect(payload.mime_type).toBe("application/pdf");
    expect(mocks.claim.mock.invocationCallOrder[0]!).toBeLessThan(
      upload.mock.invocationCallOrder[0]!,
    );
    expect(upload.mock.calls[0]![2]).toEqual({
      contentType: "application/pdf",
      upsert: false,
    });
  });
  it("reconciles identical previously stored bytes after upload transport error", async () => {
    upload.mockResolvedValue({ error: { message: "response lost" } });
    download.mockResolvedValue({
      data: new Blob(["%PDF-1.7\nfixture"]),
      error: null,
    });
    expect((await POST(request())).status).toBe(201);
  });
  it("does not submit different bytes found at the same path", async () => {
    upload.mockResolvedValue({ error: { message: "conflict" } });
    download.mockResolvedValue({
      data: new Blob(["%PDF-1.7\nchanged"]),
      error: null,
    });
    expect((await POST(request())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("does not expose hash/path and treats an invalid RPC receipt as unknown", async () => {
    rpc.mockResolvedValue({ data: { id: resultId }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain(owner);
    expect(body).not.toContain("content_sha256");
  });
});
