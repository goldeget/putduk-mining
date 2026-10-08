import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), service: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/principal", () => ({
  requireAdminCommand: mocks.authorize,
}));
vi.mock("@/lib/supabase/service", () => ({
  createAdminServiceClient: mocks.service,
}));
import { handleAdminAiConversationRead } from "@/lib/ai/conversation-handler";
import {
  redactAdminAiCredentials,
  formatAdminAiUsd,
} from "../../../domain/ai/admin-conversation";
const user = "10000000-0000-4000-8000-000000000001",
  conversation = "10000000-0000-4000-8000-000000000002",
  session = "10000000-0000-4000-8000-000000000003";
const stamp = "2026-10-09T00:00:00Z";
function request(body: unknown) {
  return new Request("https://admin.mining.putduk.com/api/ai/conversations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://admin.mining.putduk.com",
    },
    body: JSON.stringify(body),
  });
}
function db(data: unknown, error = false) {
  const rpc = vi.fn().mockResolvedValue({
    data,
    error: error ? { message: "private database secret" } : null,
  });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ insert }));
  mocks.service.mockReturnValue({ rpc, from });
  return { rpc, insert, from };
}
const input = {
  operation: "MESSAGES",
  userId: user,
  conversationId: conversation,
  afterPosition: 0,
  limit: 100,
};
const record = {
  conversationId: conversation,
  userId: user,
  messages: [
    {
      id: session,
      authorRole: "MEMBER",
      bodyText: "100만 원 중 30만 원 보류 취소 후 날짜는 그대로인가요?",
      position: 1,
      createdAt: stamp,
      clientMessageId: null,
    },
  ],
  requests: [],
  nextPosition: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    principal: {
      userId: user,
      adminSessionId: session,
      role: "SUPER_ADMIN",
      aal: "aal2",
    },
  });
});
describe("full admin transcript recovery boundary", () => {
  it.each([
    "ROLE_FORBIDDEN",
    "ORIGIN_DENIED",
    "ADMIN_SESSION_REVOKED",
    "MFA_REQUIRED",
  ])("denies %s and audits without reading raw body", async (code) => {
    mocks.authorize.mockResolvedValue({ ok: false, status: 403, code });
    const database = db(null),
      req = request(input);
    const response = await handleAdminAiConversationRead(req);
    expect(response.status).toBe(403);
    expect(req.bodyUsed).toBe(false);
    expect(database.rpc).not.toHaveBeenCalled();
    expect(database.insert).toHaveBeenCalledOnce();
    expect(JSON.stringify(database.insert.mock.calls)).not.toContain(user);
  });
  it("uses the atomic session/read/audit RPC and preserves ordinary original questions", async () => {
    const database = db({ ok: true, data: record });
    const req = request(input),
      response = await handleAdminAiConversationRead(req);
    expect(response.status).toBe(200);
    expect((await response.json()).data.messages[0].bodyText).toBe(
      record.messages[0]!.bodyText,
    );
    expect(database.rpc).toHaveBeenCalledWith(
      "admin_read_ai_conversations",
      expect.objectContaining({
        p_actor: user,
        p_admin_session_id: session,
        p_operation: "MESSAGES",
        p_input: input,
      }),
    );
    expect(database.from).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledWith(req, ["SUPER_ADMIN"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it.each([
    { ...record, userId: session },
    { ...record, conversationId: session },
    { ...record, messages: [record.messages[0], record.messages[0]] },
    { ...record, nextPosition: 30 },
  ])("fails closed on mixed scope/order/next cursor", async (data) => {
    db({ ok: true, data });
    expect((await handleAdminAiConversationRead(request(input))).status).toBe(
      503,
    );
  });
  it("redacts explicit credentials and does not summarize long ordinary content", async () => {
    const ordinary = "문의 내역 ".repeat(900);
    db({
      ok: true,
      data: {
        ...record,
        messages: [
          {
            ...record.messages[0],
            bodyText: ordinary + " NVIDIA_API_KEY=nvapi-secretsecretsecret",
          },
        ],
      },
    });
    const response = await handleAdminAiConversationRead(request(input)),
      body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.messages[0].bodyText).toContain(ordinary);
    expect(JSON.stringify(body)).not.toContain("nvapi-secretsecretsecret");
    expect(body.data.messages[0].redacted).toBe(true);
    expect(redactAdminAiCredentials("정상 문의 1234 테스트")).toBe(
      "정상 문의 1234 테스트",
    );
  });
  it("never falls back to service table reads when canonical DB receipt is missing", async () => {
    const database = db(null, true);
    const response = await handleAdminAiConversationRead(request(input));
    expect(response.status).toBe(503);
    expect(database.from).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      "private database",
    );
  });
  it("rejects arbitrary SQL filters and bounds chunked input", async () => {
    const database = db(null);
    expect(
      (
        await handleAdminAiConversationRead(
          request({ ...input, filter: "user_id=any" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleAdminAiConversationRead(
          request({ operation: "SEARCH", query: "x".repeat(3000) }),
        )
      ).status,
    ).toBe(413);
    expect(database.rpc).not.toHaveBeenCalled();
  });
  it("does not invent zero cost or round nano USD through floating point", () => {
    expect(formatAdminAiUsd(null)).toBe("확인할 수 없음");
    expect(formatAdminAiUsd("1")).toBe("$0.000000001");
    expect(formatAdminAiUsd("1000000000000000000000000000000000000000")).toBe(
      "$1000000000000000000000000000000",
    );
  });
});
