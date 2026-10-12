import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: vi.fn() }));
import { getVerifiedIdentity, type VerifiedIdentity } from "@/lib/auth/session";
import { createMemberFaqHandler } from "@/lib/trust/member-faq";
import { GET, dynamic, runtime } from "@/app/api/v1/trust/member-faq/route";
import { ORIGINAL_FAQ_SOURCE_DIGEST } from "@/domain/content/faq";

const id = "20000000-0000-4000-8000-000000000001";
const dto = {
  contentId: id,
  revisionId: "20000000-0000-4000-8000-000000000002",
  revision: 1,
  title: "회원 자주 묻는 질문",
  summary: "앱 이용에 필요한 안내를 확인해 주세요.",
  locale: "ko-KR",
  audience: "MEMBERS",
  entries: [
    {
      stableEntryId: "mining-progress",
      question: "앱을 닫아도 계속되나요?",
      answer: "앱을 닫아도 채굴은 계속돼요.",
    },
  ],
  publishedAt: "2026-10-01T00:00:00Z",
  expiresAt: null,
  sourceDigest: ORIGINAL_FAQ_SOURCE_DIGEST,
};
const rpc = vi.fn();
const getIdentity = vi.fn();
const handler = createMemberFaqHandler({ getIdentity });
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: dto, error: null });
  getIdentity.mockResolvedValue({ userId: id, supabase: { rpc } });
});
describe("member FAQ readonly projection", () => {
  it("uses only authenticated native read RPC without caller-supplied user or source parameters", async () => {
    const response = await handler();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: dto });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_member_faq");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it.each([null, { userId: "invalid", supabase: { rpc } }])(
    "rejects unverified identity before any RPC",
    async (identity) => {
      getIdentity.mockResolvedValue(identity);
      const response = await handler();
      expect(response.status).toBe(401);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("preserves native null for absent/not-due/expired published content", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await (await handler()).json()).toEqual({ data: null });
  });
  it.each([
    undefined,
    [],
    { ...dto, audience: "PUBLIC" },
    { ...dto, sourceDigest: "a".repeat(64) },
    { ...dto, revision: 0 },
    { ...dto, contentId: "not-uuid" },
    { ...dto, publishedAt: null },
    { ...dto, expiresAt: "2026-09-30T00:00:00Z" },
    { ...dto, entries: [] },
    { ...dto, entries: [{ ...dto.entries[0], actorId: id }] },
    {
      ...dto,
      entries: [{ ...dto.entries[0], answer: "<script>alert(1)</script>" }],
    },
    { ...dto, entries: [{ ...dto.entries[0], answer: "{{unknown}}" }] },
    ...[
      "C:\\private\\source.txt",
      "D:/private/source.txt",
      "app_private",
      "auth.sessions",
    ].map((answer) => ({
      ...dto,
      entries: [{ ...dto.entries[0], answer }],
    })),
    ...[
      "auditId",
      "actorId",
      "sourcePath",
      "draft",
      "stepUpToken",
      "sources",
    ].map((field) => ({ ...dto, [field]: "private" })),
  ])(
    "fails closed on malformed projection or private fields %j",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      const response = await handler();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "MEMBER_FAQ_UNCONFIRMED",
          message: "안내를 확인하지 못했습니다. 다시 시도해 주세요.",
        },
      });
    },
  );
  it.each(["auth", "rpc-error", "rpc-throw"])(
    "redacts failures at %s boundary",
    async (boundary) => {
      const secret = "private-source-path service_role admin-identifier";
      if (boundary === "auth") getIdentity.mockRejectedValue(new Error(secret));
      if (boundary === "rpc-error")
        rpc.mockResolvedValue({ data: dto, error: { message: secret } });
      if (boundary === "rpc-throw") rpc.mockRejectedValue(new Error(secret));
      const response = await handler();
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(secret);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    },
  );
  it("thin GET exports bind verified user client and force private dynamic Node runtime", async () => {
    vi.mocked(getVerifiedIdentity).mockResolvedValue({
      userId: id,
      supabase: { rpc } as unknown as VerifiedIdentity["supabase"],
    });
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect((await GET()).status).toBe(200);
    expect(getVerifiedIdentity).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("read_member_faq");
  });
});
