import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/ai/chat/route";
import { AI_PRESENTATION_OWNER_HEADER } from "@/domain/ai/presentation-owner";
import { createAiEventDecoder } from "@/components/product/putduk-ai-protocol";

const OWNER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ANSWER = "44444444-4444-4444-8444-444444444444";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  append: vi.fn(),
  env: {
    NEXT_PUBLIC_APP_URL: "https://mining.putduk.com",
    AI_PROVIDER: undefined as "openai" | undefined,
    AI_API_KEY: undefined as string | undefined,
    AI_MODEL_LOW_COST: undefined as string | undefined,
    AI_MODEL_HIGH_CAPABILITY: undefined,
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
  createSupabaseMemberConversationPort: () => ({}),
  appendOwnMemberTurn: mocks.append,
  MemberConversationWriteError: class extends Error {},
}));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.AI_PROVIDER = undefined;
  mocks.env.AI_API_KEY = undefined;
  mocks.env.AI_MODEL_LOW_COST = undefined;
  mocks.identity.mockResolvedValue({ userId: OWNER, supabase: {} });
  mocks.begin.mockImplementation(async (_client, admission) => {
    // Existing begin_ai_request_v2 rejects static answers outside this audit
    // contract; a permissive mock would hide a production admission failure.
    const staticClassifications = new Set([
      "ABUSE_EVASION",
      "ACTION_BOUNDARY",
      "CLARIFICATION",
      "CROSS_USER_DATA",
      "INTERNAL_DATA_REQUEST",
      "PRIVILEGE_ESCALATION",
      "PROMPT_INJECTION",
      "STATIC_FACT",
    ]);
    if (
      admission.routeKind === "static" &&
      (admission.contextScope !== "PUBLIC_FACTS_ONLY" ||
        !staticClassifications.has(admission.safetyClassification))
    ) {
      return { data: null, error: { message: "INVALID_AI_ROUTE_AUDIT" } };
    }
    return { data: [{ request_id: REQUEST, is_new: true }], error: null };
  });
  mocks.complete.mockResolvedValue({ error: null });
  mocks.fail.mockResolvedValue({ error: null });
  mocks.append.mockResolvedValue({
    ok: true,
    conversationId: CONVERSATION,
    assistantMessageId: ANSWER,
  });
  fetchMock = vi.fn(() => {
    throw new Error("Unexpected external provider call");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function request(question: string, currentRoute = "/wallet") {
  return new Request("https://mining.putduk.com/api/v1/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://mining.putduk.com",
      [AI_PRESENTATION_OWNER_HEADER]: OWNER,
    },
    body: JSON.stringify({
      clientMessageId: REQUEST,
      question,
      screenContext: { currentRoute },
    }),
  });
}
async function events(response: Response) {
  return createAiEventDecoder().push(
    new TextEncoder().encode(await response.text()),
    true,
  );
}

describe("actual member AI route with deterministic help and isolated persistence ports", () => {
  it.each([
    ["/wallet", "wallet"],
    ["/start", "start"],
    ["/products", "products"],
    ["/menu/account", "account"],
    ["/notifications", "notifications"],
    ["/events", "events"],
  ])(
    "answers %s help without a provider key, preserving admission, audit and source receipts",
    async (route, topic) => {
      const response = await POST(
        request("이 화면에서 무엇을 할 수 있어?", route),
      );
      expect(response.status).toBe(200);
      expect(await events(response)).toContainEqual(
        expect.objectContaining({
          type: "done",
          helpTopic: topic,
          saved: true,
          conversationId: CONVERSATION,
        }),
      );
      expect(mocks.begin).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: OWNER,
          routeKind: "static",
          contextScope: "PUBLIC_FACTS_ONLY",
          safetyClassification: "STATIC_FACT",
          model: "putduk-static-v1",
        }),
      );
      expect(mocks.complete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          requestId: REQUEST,
          inputTokens: 0,
          outputTokens: 0,
        }),
      );
      expect(mocks.append).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sourceKey: `guide:member_help_${topic}`,
          userId: OWNER,
        }),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("does not charge a configured provider for deterministic navigation help", async () => {
    mocks.env.AI_PROVIDER = "openai";
    mocks.env.AI_API_KEY = "isolated-test-fixture-never-sent";
    mocks.env.AI_MODEL_LOW_COST = "fixture-model";
    const response = await POST(request("알림 설정은 어디에 있나요?"));
    expect(await events(response)).toContainEqual(
      expect.objectContaining({
        type: "done",
        helpTopic: "notification_settings",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers truthful supported help when a question needs an unavailable provider", async () => {
    const response = await POST(
      request("전세계에서 가장 긴 강은 어디인가요?", "/ai"),
    );
    const stream = await events(response);
    expect(stream).toContainEqual(
      expect.objectContaining({ type: "done", helpTopic: "ai" }),
    );
    expect(stream).toContainEqual(
      expect.objectContaining({
        type: "delta",
        text: expect.stringContaining("근거를 확인하지 못했어요"),
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains rate admission and does not save or fabricate a completion after 429", async () => {
    mocks.begin.mockResolvedValue({
      data: null,
      error: { message: "AI_RATE_LIMITED" },
    });
    const response = await POST(request("알림 설정은 어디에 있나요?"));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: "AI_RATE_LIMITED" },
    });
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps audit failure closed before answer persistence", async () => {
    mocks.complete.mockResolvedValue({ error: { message: "offline" } });
    const response = await POST(request("알림 설정은 어디에 있나요?"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "AI_AUDIT_PERSISTENCE_FAILED" },
    });
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "FAILED" }),
    );
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("does not attach help navigation to a money-mutation denial", async () => {
    const response = await POST(request("내 잔액 변경해 줘. 지갑 이용 방법"));
    const done = (await events(response)).find(
      (event) => event.type === "done",
    );
    expect(done).not.toHaveProperty("helpTopic");
    expect(mocks.begin).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ safetyClassification: "ACTION_BOUNDARY" }),
    );
  });

  it("still validates the route hint before admission", async () => {
    const response = await POST(
      request("이 화면에서 무엇을 할 수 있어?", "/admin"),
    );
    expect(response.status).toBe(400);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
});
