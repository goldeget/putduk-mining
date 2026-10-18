import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/ai/chat/route";
import { AI_PRESENTATION_OWNER_HEADER } from "@/domain/ai/presentation-owner";
import { createAiEventDecoder } from "@/components/product/putduk-ai-protocol";

/**
 * 키가 있다는 사실만으로 외부 공급자를 호출하지 않는다.
 * 공급자 사슬과 fetch는 전부 가짜이며 실제 네트워크 호출은 어디에도 없다.
 */
const OWNER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";
const ANSWER = "44444444-4444-4444-8444-444444444444";
const PROVIDER_ONLY_QUESTION = "전세계에서 가장 긴 강은 어디인가요?";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  append: vi.fn(),
  provider: vi.fn(),
  env: {
    NEXT_PUBLIC_APP_URL: "https://mining.putduk.com",
    APP_ENV: "staging" as string,
    AI_PROVIDER: "nvidia" as string | undefined,
    AI_API_KEY: "synthetic-never-transmitted-key" as string | undefined,
    AI_MODEL_LOW_COST: "openai/gpt-oss-20b" as string | undefined,
    AI_PROVIDER_DISPATCH_ENABLED: undefined as string | undefined,
    AI_MAX_OUTPUT_TOKENS: 900,
    AI_FIRST_TOKEN_TIMEOUT_MS: 2000,
    AI_MAX_REQUESTS_PER_MINUTE: 5,
    AI_MAX_REQUESTS_PER_DAY: 100,
    AI_CACHE_TTL_SECONDS: 3600,
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
vi.mock("@/lib/ai/cache", () => ({
  readAiCache: vi.fn(async () => null),
  writeAiCache: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/provider-attempts", () => ({
  createProviderAttemptPort: () => ({}),
}));
vi.mock("@/lib/ai/provider-chain", () => ({
  runMemberProviderChain: mocks.provider,
  ProviderChainError: class extends Error {
    constructor(
      public code: string,
      public cancelled = false,
    ) {
      super(code);
    }
  },
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.APP_ENV = "staging";
  mocks.env.AI_PROVIDER = "nvidia";
  mocks.env.AI_API_KEY = "synthetic-never-transmitted-key";
  mocks.env.AI_MODEL_LOW_COST = "openai/gpt-oss-20b";
  mocks.env.AI_PROVIDER_DISPATCH_ENABLED = undefined;
  mocks.identity.mockResolvedValue({ userId: OWNER, supabase: {} });
  mocks.begin.mockResolvedValue({
    data: [{ request_id: REQUEST, is_new: true }],
    error: null,
  });
  mocks.complete.mockResolvedValue({ error: null });
  mocks.fail.mockResolvedValue({ error: null });
  mocks.append.mockResolvedValue({
    ok: true,
    conversationId: CONVERSATION,
    assistantMessageId: ANSWER,
  });
  mocks.provider.mockImplementation(async (input) => {
    input.onDelta("합성 답변입니다.");
    return {
      model: "openai/gpt-oss-20b",
      providerRequestId: "synthetic-provider-response",
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
    };
  });
  fetchMock = vi.fn(() => {
    throw new Error("Unexpected external provider call");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function request() {
  return new Request("https://mining.putduk.com/api/v1/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://mining.putduk.com",
      [AI_PRESENTATION_OWNER_HEADER]: OWNER,
    },
    body: JSON.stringify({
      clientMessageId: REQUEST,
      question: PROVIDER_ONLY_QUESTION,
    }),
  });
}
async function events(response: Response) {
  return createAiEventDecoder().push(
    new TextEncoder().encode(await response.text()),
    true,
  );
}

describe("a provider key alone never dispatches a real AI call", () => {
  it.each([
    ["staging", undefined],
    ["staging", ""],
    ["staging", "false"],
    ["staging", "TRUE"],
    ["staging", "1"],
    ["development", undefined],
    ["test", undefined],
  ])(
    "%s with a complete provider tuple and switch %j answers deterministically with zero provider calls",
    async (appEnv, switchValue) => {
      mocks.env.APP_ENV = appEnv;
      mocks.env.AI_PROVIDER_DISPATCH_ENABLED = switchValue;
      const response = await POST(request());
      expect(response.status).toBe(200);
      const stream = await events(response);
      expect(stream).toContainEqual(
        expect.objectContaining({
          type: "delta",
          text: expect.stringContaining("근거를 확인하지 못했어요"),
        }),
      );
      expect(stream).toContainEqual(
        expect.objectContaining({ type: "done", saved: true }),
      );
      expect(mocks.provider).toHaveBeenCalledTimes(0);
      expect(fetchMock).not.toHaveBeenCalled();
      // The deterministic answer is audited as a static, zero-token turn.
      expect(mocks.begin).toHaveBeenCalledTimes(1);
      expect(mocks.complete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ inputTokens: 0, outputTokens: 0 }),
        expect.anything(),
      );
    },
  );

  it("production stays blocked even when the owner switch is on", async () => {
    mocks.env.APP_ENV = "production";
    mocks.env.AI_PROVIDER_DISPATCH_ENABLED = "true";
    const response = await POST(request());
    expect(await events(response)).toContainEqual(
      expect.objectContaining({ type: "done" }),
    );
    expect(mocks.provider).toHaveBeenCalledTimes(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an incomplete or unapproved tuple stays off even with the switch on", async () => {
    mocks.env.AI_PROVIDER_DISPATCH_ENABLED = "true";
    for (const patch of [
      { AI_API_KEY: undefined },
      { AI_PROVIDER: "openai" },
      { AI_MODEL_LOW_COST: "arbitrary/paid-model" },
    ]) {
      Object.assign(mocks.env, patch);
      const response = await POST(request());
      await events(response);
      mocks.env.AI_API_KEY = "synthetic-never-transmitted-key";
      mocks.env.AI_PROVIDER = "nvidia";
      mocks.env.AI_MODEL_LOW_COST = "openai/gpt-oss-20b";
    }
    expect(mocks.provider).toHaveBeenCalledTimes(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("control: only the exact owner switch reaches the (mocked) provider chain, never paid", async () => {
    mocks.env.APP_ENV = "staging";
    mocks.env.AI_PROVIDER_DISPATCH_ENABLED = "true";
    const response = await POST(request());
    const stream = await events(response);
    expect(stream).toContainEqual(
      expect.objectContaining({ type: "done", saved: true }),
    );
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({ paidCallAuthorized: false }),
    );
    // The chain itself is mocked; the route performed no direct network call.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
