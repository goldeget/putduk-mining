import { createHash } from "node:crypto";
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
import { POST } from "@/app/api/kyc/evidence/[submissionId]/route";
const owner = "76aa0000-0000-4000-8000-000000000001",
  caseId = "76aa0000-0000-4000-8000-000000000002",
  key = "76aa0000-0000-4000-8000-000000000003",
  submission = "76aa0000-0000-4000-8000-000000000004";
const bytes = "%PDF-1.7\nprotected fixture";
let audit: ReturnType<typeof vi.fn>,
  activity: ReturnType<typeof vi.fn>,
  download: ReturnType<typeof vi.fn>,
  delivery: ReturnType<typeof vi.fn>;
let path: string;
function request() {
  const form = new FormData();
  form.set("reason", "제출 서류가 본인 확인 기준에 맞는지 확인합니다.");
  form.set("confirmation", "VIEW_KYC_EVIDENCE");
  form.set("stepUpToken", "test-ephemeral-step-up-token");
  return new Request("https://admin.example.test/api/kyc/evidence", {
    method: "POST",
    body: form,
  });
}
const context = () => ({
  params: Promise.resolve({ submissionId: submission }),
});
beforeEach(() => {
  vi.clearAllMocks();
  path = `${owner}/${caseId}/${key}`;
  gate.mockResolvedValue({
    ok: true,
    principal: {
      userId: owner,
      role: "ADMIN",
      sessionId: key,
      adminSessionId: caseId,
    },
    requestId: key,
  });
  audit = vi.fn().mockResolvedValue({ error: null });
  activity = vi.fn().mockResolvedValue({ error: null });
  download = vi
    .fn()
    .mockResolvedValue({ error: null, data: new Blob([bytes]) });
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      error: null,
      data: {
        id: submission,
        user_id: owner,
        case_id: caseId,
        protected_storage_path: path,
        content_sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    })),
  };
  delivery = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { id: key, expires_at: "2026-10-12T02:05:00Z" },
        error: null,
      }),
    }),
  });
  service.mockReturnValue({
    from: (table: string) =>
      table === "kyc_submissions"
        ? query
        : table === "audit_logs"
          ? { insert: activity }
          : table === "kyc_evidence_delivery_receipts"
            ? { insert: delivery }
            : { insert: audit },
    storage: { from: () => ({ download }) },
  });
});
describe("protected original KYC evidence", () => {
  it("denied role/session/AAL2/step-up never reaches service Storage", async () => {
    gate.mockResolvedValue({ ok: false });
    expect((await POST(request(), context())).status).toBe(403);
    expect(service).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
  it("activity audit failure blocks both document-view audit and Storage", async () => {
    activity.mockResolvedValue({ error: { message: "unavailable" } });
    expect((await POST(request(), context())).status).toBe(503);
    expect(audit).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
  it("Storage failure never creates a delivery receipt or view attestation", async () => {
    download.mockResolvedValue({
      error: { message: "unavailable" },
      data: null,
    });
    expect((await POST(request(), context())).status).toBe(503);
    expect(delivery).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it("invalid owner/case/path linkage blocks audit and download", async () => {
    path = `${key}/${caseId}/${owner}`;
    expect((await POST(request(), context())).status).toBe(503);
    expect(activity).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });
  it("hash mismatch never delivers bytes or creates a receipt", async () => {
    download.mockResolvedValue({
      error: null,
      data: new Blob(["%PDF-1.7\nchanged"]),
    });
    const response = await POST(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(delivery).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it("audits attempt before download, prepares a bound receipt, and never records human review", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(bytes);
    expect(activity.mock.invocationCallOrder[0]!).toBeLessThan(
      download.mock.invocationCallOrder[0]!,
    );
    expect(download.mock.invocationCallOrder[0]!).toBeLessThan(
      delivery.mock.invocationCallOrder[0]!,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="identity-document.pdf"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(activity.mock.calls[0]![0].action).toBe(
      "KYC_EVIDENCE_ACCESS_ATTEMPT",
    );
    expect(delivery.mock.calls[0]![0]).toMatchObject({
      submission_id: submission,
      owner_user_id: owner,
      reviewer_user_id: owner,
      auth_session_id: key,
      admin_session_id: caseId,
    });
    expect(response.headers.get("Kyc-Delivery-Receipt")).toBe(key);
    expect(audit).not.toHaveBeenCalled();
  });
});
