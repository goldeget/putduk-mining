import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/ai/chat/route";
import { AI_PRESENTATION_OWNER_HEADER } from "@/domain/ai/presentation-owner";
import { createAiEventDecoder } from "@/components/product/putduk-ai-protocol";
import { MemberConversationWriteError } from "@/lib/ai/member-conversation";

/**
 * 다른 회원의 대화 ID로 질문하면 404이고 어떤 데이터도 돌려주지 않는다.
 * DB·공급자·네트워크 없이 실제 route handler를 가짜 포트로 실행한다.
 */
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_MEMBER_CONVERSATION = "55555555-5555-4555-8555-555555555555";
const OWN_CONVERSATION = "33333333-3333-4333-8333-333333333333";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const ANSWER = "44444444-4444-4444-8444-444444444444";
const SECRET_TRANSCRIPT = "다른 회원이 남긴 비공개 대화 본문";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  append: vi.fn(),
  findOwn: vi.fn(),
  readHistory: vi.fn(),
  provider: vi.fn(),
  env: {
    NEXT_PUBLIC_APP_URL: "https://mining.putduk.com",
    APP_ENV: "test",
    AI_MAX_REQUESTS_PER_MINUTE: 5,
    AI_MAX_REQUESTS_PER_DAY: 100,
  },
}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: mocks.identity }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => mocks.env }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));
vi.mock("@/lib/ai/usage", () => ({
  beginAiRequest: mocks.begin,
  completeAiRequest: mocks.complete,
  failAiRequest: mocks.fail,
}));
vi.mock("@/lib/ai/member-conversation", () => ({
  createSupabaseMemberConversationPort: () => ({
    findOwnConversation: mocks.findOwn,
  }),
  appendOwnMemberTurn: mocks.append,
  MemberConversationWriteError: class extends Error {},
}));
vi.mock("@/lib/ai/member-conversation-read", () => ({
  readOwnAiMessages: mocks.readHistory,
}));
vi.mock("@/lib/ai/provider-attempts", () => ({
  createProviderAttemptPort: () => ({}),
}));
vi.mock("@/lib/ai/provider-chain", () => ({
  runMemberProviderChain: mocks.provider,
  ProviderChainError: class extends Error {},
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ userId: OWNER, supabase: {} });
  mocks.begin.mockResolvedValue({
    data: [{ request_id: REQUEST, is_new: true }],
    error: null,
  });
  mocks.complete.mockResolvedValue({ error: null });
  mocks.fail.mockResolvedValue({ error: null });
  mocks.append.mockResolvedValue({
    ok: true,
    conversationId: OWN_CONVERSATION,
    assistantMessageId: ANSWER,
  });
  mocks.readHistory.mockResolvedValue({
    ok: true,
    messages: [{ bodyText: SECRET_TRANSCRIPT }],
  });
  fetchMock = vi.fn(() => {
    throw new Error("Unexpected external call");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function request(conversationId: string, question: string) {
  return new Request("https://mining.putduk.com/api/v1/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://mining.putduk.com",
      [AI_PRESENTATION_OWNER_HEADER]: OWNER,
    },
    body: JSON.stringify({
      clientMessageId: REQUEST,
      conversationId,
      question,
    }),
  });
}

describe("a member cannot use another member's AI conversation", () => {
  it.each([
    ["a provider-bound question", "전세계에서 가장 긴 강은 어디인가요?"],
    [
      "a static START question",
      "PUTDUK START 체험 결과가 실제 잔액으로 전환되나요?",
    ],
  ])(
    "returns 404 AI_CONVERSATION_NOT_FOUND with no data for %s",
    async (_name, question) => {
      mocks.findOwn.mockResolvedValue(false);
      const response = await POST(request(OTHER_MEMBER_CONVERSATION, question));
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({
        error: {
          code: "AI_CONVERSATION_NOT_FOUND",
          message: "대화를 찾지 못했어요.",
        },
      });
      expect(text).not.toContain(SECRET_TRANSCRIPT);
      expect(text).not.toContain(OTHER_MEMBER_CONVERSATION);
      // Ownership is checked for the verified caller, before anything else.
      expect(mocks.findOwn).toHaveBeenCalledWith(
        OWNER,
        OTHER_MEMBER_CONVERSATION,
      );
      expect(mocks.readHistory).not.toHaveBeenCalled();
      expect(mocks.begin).not.toHaveBeenCalled();
      expect(mocks.append).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("fails closed with 503 and no data when ownership cannot be checked", async () => {
    mocks.findOwn.mockRejectedValue(new MemberConversationWriteError("FAILED"));
    const response = await POST(
      request(OTHER_MEMBER_CONVERSATION, "전세계에서 가장 긴 강은 어디인가요?"),
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      error: { code: "AI_CONVERSATION_UNAVAILABLE" },
    });
    expect(text).not.toContain(SECRET_TRANSCRIPT);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(mocks.readHistory).not.toHaveBeenCalled();
  });

  it("control: the caller's own conversation continues and is saved under that id", async () => {
    mocks.findOwn.mockResolvedValue(true);
    const response = await POST(
      request(
        OWN_CONVERSATION,
        "PUTDUK START 체험 결과가 실제 잔액으로 전환되나요?",
      ),
    );
    expect(response.status).toBe(200);
    const stream = createAiEventDecoder().push(
      new TextEncoder().encode(await response.text()),
      true,
    );
    expect(stream).toContainEqual(
      expect.objectContaining({
        type: "done",
        saved: true,
        conversationId: OWN_CONVERSATION,
      }),
    );
    expect(mocks.findOwn).toHaveBeenCalledWith(OWNER, OWN_CONVERSATION);
    expect(mocks.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: OWN_CONVERSATION,
        userId: OWNER,
      }),
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
