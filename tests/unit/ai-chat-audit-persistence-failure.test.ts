import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/ai/chat/route";
import { AI_PRESENTATION_OWNER_HEADER } from "@/domain/ai/presentation-owner";
import { ProviderChainError } from "@/lib/ai/provider-chain";

const OWNER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const RAW_FAILURE = "synthetic-rpc-detail-must-not-reach-the-response";
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  append: vi.fn(),
  tool: vi.fn(),
  provider: vi.fn(),
  plan: vi.fn(),
  readback: vi.fn(),
  cacheWrite: vi.fn(),
  auditSignal: undefined as AbortSignal | undefined,
  env: {
    NEXT_PUBLIC_APP_URL: "https://mining.putduk.com",
    APP_ENV: "test",
    AI_PROVIDER: "nvidia",
    // A key alone never dispatches; these provider-path cases opt in explicitly
    // and still mock the provider chain (no network).
    AI_PROVIDER_DISPATCH_ENABLED: "true",
    AI_API_KEY: "synthetic-never-transmitted-key",
    AI_MODEL_LOW_COST: "openai/gpt-oss-20b",
    AI_MAX_OUTPUT_TOKENS: 900,
    AI_FIRST_TOKEN_TIMEOUT_MS: 2000,
    AI_MAX_REQUESTS_PER_MINUTE: 5,
    AI_MAX_REQUESTS_PER_DAY: 100,
    AI_CACHE_TTL_SECONDS: 3600,
  },
}));
vi.mock("@/lib/auth/session", () => ({ getVerifiedIdentity: mocks.identity }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => mocks.env }));
vi.mock("@/lib/safe-mode/assert-component-active.server", () => ({
  assertComponentActive: async () => ({ ok: true }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        abortSignal: vi.fn((signal: AbortSignal) => {
          mocks.auditSignal = signal;
          return query;
        }),
        maybeSingle: mocks.readback,
      };
      return query;
    },
  }),
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
  readAiCache: vi.fn(),
  writeAiCache: mocks.cacheWrite,
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
vi.mock("@/lib/ai/tool-executor", () => ({ executeAiTool: mocks.tool }));
vi.mock("@/lib/ai/tools", () => ({ assertAiToolBoundary: vi.fn() }));
vi.mock("@/lib/ai/orchestrator", () => ({ planAiTurn: mocks.plan }));

function setRoute(kind: "static" | "tool" | "low_cost", cacheable = false) {
  mocks.plan.mockReturnValue({
    cacheable,
    context: {
      scope: "PUBLIC_FACTS_ONLY",
      locale: "ko-KR",
      userContextIncluded: false,
      knowledge: {
        version: "synthetic-v1",
        lastUpdated: "2026-10-11",
        facts: [],
      },
    },
    route: {
      kind,
      routeKey: "member_help_ai",
      classification:
        kind === "static"
          ? "STATIC_FACT"
          : kind === "tool"
            ? "ACCOUNT_STATE"
            : "PUTDUK_KNOWLEDGE",
      answer: "확인된 안내입니다.",
      tool: "wallet.summary",
    },
  });
}
function request(signal?: AbortSignal) {
  return new Request("https://mining.putduk.com/api/v1/ai/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://mining.putduk.com",
      [AI_PRESENTATION_OWNER_HEADER]: OWNER,
    },
    body: JSON.stringify({ clientMessageId: REQUEST, question: "질문입니다." }),
    ...(signal ? { signal } : {}),
  });
}
function rpcFailure(mode: "returned" | "thrown") {
  if (mode === "returned")
    mocks.fail.mockResolvedValue({ error: { message: RAW_FAILURE } });
  else mocks.fail.mockRejectedValue(new Error(RAW_FAILURE));
}
function parseEvents(text: string): Record<string, unknown>[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!data) throw new Error("Missing SSE data");
      return JSON.parse(data.slice(6)) as Record<string, unknown>;
    });
}
async function expectAuditJson(response: Response) {
  expect(response.status).toBe(503);
  const text = await response.text();
  expect(JSON.parse(text)).toMatchObject({
    error: { code: "AI_AUDIT_PERSISTENCE_FAILED" },
  });
  expect(text).not.toContain(RAW_FAILURE);
  expect(mocks.append).not.toHaveBeenCalled();
  expect(mocks.provider).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.APP_ENV = "test";
  mocks.identity.mockResolvedValue({ userId: OWNER, supabase: {} });
  mocks.begin.mockResolvedValue({
    data: [{ request_id: REQUEST, is_new: true }],
    error: null,
  });
  mocks.complete.mockResolvedValue({ error: null });
  mocks.fail.mockResolvedValue({ error: null });
  mocks.auditSignal = undefined;
  mocks.cacheWrite.mockResolvedValue(undefined);
  mocks.readback.mockImplementation(async () => {
    try {
      const result = await mocks.fail.mock.results.at(-1)?.value;
      if (result?.error) return { data: null, error: null };
      const input = mocks.fail.mock.calls.at(-1)?.[1];
      return {
        data: {
          id: REQUEST,
          user_id: OWNER,
          status: input?.status,
          error_code: input?.errorCode,
        },
        error: null,
      };
    } catch {
      return { data: null, error: null };
    }
  });
  mocks.append.mockResolvedValue({
    ok: true,
    conversationId: "33333333-3333-4333-8333-333333333333",
    assistantMessageId: "44444444-4444-4444-8444-444444444444",
  });
  mocks.tool.mockResolvedValue({
    ok: false,
    code: "AI_TOOL_UNAVAILABLE",
    answer: "정보를 확인하지 못했어요.",
    tool: "wallet.summary",
  });
  setRoute("static");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No network is permitted in this synthetic unit fixture");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AI audit persistence failures remain explicit without exposing RPC details", () => {
  it.each([
    ["returned", "returned"],
    ["returned", "thrown"],
    ["thrown", "returned"],
    ["thrown", "thrown"],
  ] as const)(
    "returns safe JSON when completion is %s and failure audit is %s",
    async (completeMode, failureMode) => {
      if (completeMode === "returned")
        mocks.complete.mockResolvedValue({ error: { message: RAW_FAILURE } });
      else mocks.complete.mockRejectedValue(new Error(RAW_FAILURE));
      rpcFailure(failureMode);
      await expectAuditJson(await POST(request()));
      expect(mocks.fail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: OWNER,
          requestId: REQUEST,
          status: "FAILED",
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    },
  );

  it.each(["returned", "thrown"] as const)(
    "does not mask a %s tool failure audit as a normal tool error stream",
    async (mode) => {
      setRoute("tool");
      rpcFailure(mode);
      await expectAuditJson(await POST(request()));
      expect(mocks.fail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          errorCode: "AI_TOOL_UNAVAILABLE",
          status: "FAILED",
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    },
  );

  it.each([
    [false, "returned"],
    [false, "thrown"],
    [true, "returned"],
    [true, "thrown"],
  ] as const)(
    "emits an audit error after cancelled=%s and %s RPC failure, then aborts and closes",
    async (cancelled, mode) => {
      setRoute("low_cost");
      rpcFailure(mode);
      let upstreamSignal: AbortSignal | undefined;
      mocks.provider.mockImplementation(async (input) => {
        upstreamSignal = input.signal;
        throw new ProviderChainError(
          cancelled ? "CLIENT_CANCELLED" : "AI_PROVIDER_UNAVAILABLE",
          cancelled,
        );
      });
      const req = request();
      const removeListener = vi.spyOn(req.signal, "removeEventListener");
      const response = await POST(req);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      const text = await response.text();
      const events = parseEvents(text);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "error",
          code: "AI_AUDIT_PERSISTENCE_FAILED",
          saved: false,
        }),
      );
      expect(events.some((event) => event.type === "done")).toBe(false);
      expect(text).not.toContain(RAW_FAILURE);
      expect(text).not.toContain("답변 생성을 중단했어요.");
      expect(mocks.fail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: cancelled ? "CANCELLED" : "FAILED",
          userId: OWNER,
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(mocks.append).not.toHaveBeenCalled();
      expect(upstreamSignal?.aborted).toBe(true);
      expect(removeListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function),
      );
      expect(mocks.provider).toHaveBeenCalledWith(
        expect.objectContaining({ paidCallAuthorized: false }),
      );
    },
  );

  it.each([
    ["returned", true],
    ["thrown", true],
    ["returned", false],
    ["thrown", false],
  ] as const)(
    "reports %s completion audit failure with fallbackFailure=%s without emitting done",
    async (mode, fallbackFailure) => {
      setRoute("low_cost");
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
      if (mode === "returned")
        mocks.complete.mockResolvedValue({ error: { message: RAW_FAILURE } });
      else mocks.complete.mockRejectedValue(new Error(RAW_FAILURE));
      if (fallbackFailure) rpcFailure(mode);
      // The original successful turn may already exist when completion audit
      // fails. A different failure turn for the same client ID can be rejected.
      mocks.append.mockResolvedValueOnce({
        ok: true,
        conversationId: "33333333-3333-4333-8333-333333333333",
        assistantMessageId: "44444444-4444-4444-8444-444444444444",
      });
      const text = await (await POST(request())).text();
      const events = parseEvents(text);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "error",
          code: "AI_AUDIT_PERSISTENCE_FAILED",
          saved: true,
        }),
      );
      expect(events.some((event) => event.type === "done")).toBe(false);
      expect(text).not.toContain(RAW_FAILURE);
      expect(mocks.append).toHaveBeenCalledTimes(1);
      expect(mocks.fail).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: "FAILED" }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    },
  );

  it("closes a failed stream even if the secondary conversation write throws", async () => {
    setRoute("low_cost");
    let upstreamSignal: AbortSignal | undefined;
    mocks.provider.mockImplementation(async (input) => {
      upstreamSignal = input.signal;
      throw new ProviderChainError("AI_PROVIDER_UNAVAILABLE");
    });
    mocks.append.mockRejectedValue(new Error(RAW_FAILURE));
    const response = await POST(request());
    const text = await response.text();
    expect(parseEvents(text)).toContainEqual(
      expect.objectContaining({
        type: "error",
        code: "AI_PROVIDER_UNAVAILABLE",
        saved: false,
      }),
    );
    expect(text).not.toContain(RAW_FAILURE);
    expect(upstreamSignal?.aborted).toBe(true);
  });

  it("records an actual reader cancellation without trying to write to the cancelled stream", async () => {
    setRoute("low_cost");
    let upstreamSignal: AbortSignal | undefined;
    let signalStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let auditCalled: () => void = () => {};
    const audited = new Promise<void>((resolve) => {
      auditCalled = resolve;
    });
    mocks.provider.mockImplementation((input) => {
      upstreamSignal = input.signal;
      signalStarted();
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener(
          "abort",
          () => reject(new ProviderChainError("CLIENT_CANCELLED", true)),
          { once: true },
        );
      });
    });
    mocks.fail.mockImplementation(async () => {
      auditCalled();
      return { error: { message: RAW_FAILURE } };
    });
    const req = request();
    const removeListener = vi.spyOn(req.signal, "removeEventListener");
    const response = await POST(req);
    const reader = response.body!.getReader();
    await started;
    await reader.read();
    await reader.cancel();
    await audited;
    await vi.waitFor(() =>
      expect(removeListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function),
      ),
    );
    expect(upstreamSignal?.aborted).toBe(true);
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "CANCELLED" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.append).not.toHaveBeenCalled();
  });

  it("preserves deterministic successful completion", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(parseEvents(await response.text())).toContainEqual(
      expect.objectContaining({ type: "done", saved: true }),
    );
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("retains the production provider gate despite configured synthetic keys", async () => {
    setRoute("low_cost");
    mocks.env.APP_ENV = "production";
    const response = await POST(request());
    expect(parseEvents(await response.text())).toContainEqual(
      expect.objectContaining({ type: "done" }),
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it.each([
    ["SUCCEEDED", null, OWNER, REQUEST],
    ["RUNNING", null, OWNER, REQUEST],
    ["CANCELLED", "AI_TOOL_UNAVAILABLE", OWNER, REQUEST],
    ["FAILED", "DIFFERENT_FAILURE", OWNER, REQUEST],
    [
      "FAILED",
      "AI_TOOL_UNAVAILABLE",
      "99999999-9999-4999-8999-999999999999",
      REQUEST,
    ],
    [
      "FAILED",
      "AI_TOOL_UNAVAILABLE",
      OWNER,
      "99999999-9999-4999-8999-999999999999",
    ],
  ] as const)(
    "rejects a void RPC no-op or mismatched receipt %s/%s/%s/%s",
    async (status, errorCode, owner, id) => {
      setRoute("tool");
      mocks.readback.mockResolvedValue({
        data: { id, user_id: owner, status, error_code: errorCode },
        error: null,
      });
      await expectAuditJson(await POST(request()));
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.auditSignal?.aborted).toBe(true);
    },
  );

  it("accepts a lost RPC response only after exact owned failure readback", async () => {
    setRoute("tool");
    mocks.fail.mockRejectedValue(new Error(RAW_FAILURE));
    mocks.readback.mockResolvedValue({
      data: {
        id: REQUEST,
        user_id: OWNER,
        status: "FAILED",
        error_code: "AI_TOOL_UNAVAILABLE",
      },
      error: null,
    });
    const text = await (await POST(request())).text();
    expect(parseEvents(text)).toContainEqual(
      expect.objectContaining({ type: "error", code: "AI_TOOL_UNAVAILABLE" }),
    );
    expect(text).not.toContain(RAW_FAILURE);
  });

  it("rejects an absent receipt even when the readback reports no error", async () => {
    setRoute("tool");
    mocks.readback.mockResolvedValue({ data: null, error: null });
    await expectAuditJson(await POST(request()));
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.auditSignal?.aborted).toBe(true);
  });

  it("rejects an exact-looking receipt when readback also reports an error", async () => {
    setRoute("tool");
    mocks.readback.mockResolvedValue({
      data: {
        id: REQUEST,
        user_id: OWNER,
        status: "FAILED",
        error_code: "AI_TOOL_UNAVAILABLE",
      },
      error: { message: RAW_FAILURE },
    });
    await expectAuditJson(await POST(request()));
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each(["error", "throw"] as const)(
    "handles readback %s without raw details",
    async (mode) => {
      setRoute("tool");
      if (mode === "error")
        mocks.readback.mockResolvedValue({
          data: null,
          error: { message: RAW_FAILURE },
        });
      else mocks.readback.mockRejectedValue(new Error(RAW_FAILURE));
      await expectAuditJson(await POST(request()));
    },
  );

  it.each(["rpc", "readback"] as const)(
    "bounds hung %s work and aborts audit/provider requests before closing",
    async (stage) => {
      vi.useFakeTimers();
      setRoute("low_cost");
      mocks.provider.mockRejectedValue(
        new ProviderChainError("AI_PROVIDER_UNAVAILABLE"),
      );
      if (stage === "rpc")
        mocks.fail.mockImplementation(() => new Promise(() => {}));
      else mocks.readback.mockImplementation(() => new Promise(() => {}));
      const response = await POST(request());
      const body = response.text();
      await vi.advanceTimersByTimeAsync(5_001);
      const text = await body;
      expect(parseEvents(text)).toContainEqual(
        expect.objectContaining({
          type: "error",
          code: "AI_AUDIT_PERSISTENCE_FAILED",
          saved: false,
        }),
      );
      const auditSignal = mocks.fail.mock.calls[0]?.[2]?.signal as AbortSignal;
      expect(auditSignal.aborted).toBe(true);
      expect(mocks.provider.mock.calls[0]?.[0]?.signal.aborted).toBe(true);
      expect(mocks.append).not.toHaveBeenCalled();
    },
  );

  it.each(["throw", "hang"] as const)(
    "keeps completed durable output when optional cache %s",
    async (mode) => {
      if (mode === "hang") vi.useFakeTimers();
      setRoute("low_cost", true);
      mocks.provider.mockImplementation(async (input) => {
        input.onDelta("합성 완료 답변입니다.");
        return {
          model: "openai/gpt-oss-20b",
          providerRequestId: "synthetic-response",
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
        };
      });
      if (mode === "throw")
        mocks.cacheWrite.mockRejectedValue(new Error(RAW_FAILURE));
      else mocks.cacheWrite.mockImplementation(() => new Promise(() => {}));
      const response = await POST(request());
      const body = response.text();
      if (mode === "hang") await vi.advanceTimersByTimeAsync(5_001);
      const text = await body;
      expect(parseEvents(text)).toContainEqual(
        expect.objectContaining({ type: "done", saved: true }),
      );
      expect(mocks.fail).not.toHaveBeenCalled();
      expect(mocks.append).toHaveBeenCalledTimes(1);
      expect(text).not.toContain(RAW_FAILURE);
    },
  );

  it.each([false, true])(
    "retains fail RPC caller compatibility signal=%s",
    async (withSignal) => {
      const actual =
        await vi.importActual<typeof import("@/lib/ai/usage")>(
          "@/lib/ai/usage",
        );
      const result = { error: null };
      const abortSignal = vi.fn(() => result);
      const builder = { abortSignal };
      const rpc = vi.fn(() => builder);
      const client = { rpc } as unknown as Parameters<
        typeof actual.failAiRequest
      >[0];
      const input = {
        errorCode: "AI_TOOL_UNAVAILABLE",
        requestId: REQUEST,
        status: "FAILED" as const,
        userId: OWNER,
      };
      const signal = new AbortController().signal;
      const response = withSignal
        ? await actual.failAiRequest(client, input, { signal })
        : await actual.failAiRequest(client, input);
      expect(response).toBe(withSignal ? result : builder);
      expect(abortSignal).toHaveBeenCalledTimes(withSignal ? 1 : 0);
    },
  );

  it.each(["static", "provider"] as const)(
    "bounds hung completion for %s responses",
    async (kind) => {
      vi.useFakeTimers();
      setRoute(kind === "static" ? "static" : "low_cost");
      mocks.complete.mockImplementation(() => new Promise(() => {}));
      mocks.provider.mockImplementation(async (input) => {
        input.onDelta("합성 답변입니다.");
        return {
          model: "openai/gpt-oss-20b",
          providerRequestId: "synthetic-response",
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
        };
      });
      const pending = POST(request());
      if (kind === "static") {
        await vi.advanceTimersByTimeAsync(5_001);
        const response = await pending;
        await expectAuditJson(response);
      } else {
        const response = await pending;
        const body = response.text();
        await vi.advanceTimersByTimeAsync(5_001);
        const text = await body;
        expect(parseEvents(text)).toContainEqual(
          expect.objectContaining({
            type: "error",
            code: "AI_AUDIT_PERSISTENCE_FAILED",
            saved: true,
          }),
        );
        expect(parseEvents(text).some((event) => event.type === "done")).toBe(
          false,
        );
        expect(mocks.append).toHaveBeenCalledTimes(1);
      }
      const signal = mocks.complete.mock.calls[0]?.[2]?.signal as AbortSignal;
      expect(signal.aborted).toBe(true);
    },
  );

  it("bounds cancellation during hung completion and preserves an already successful terminal receipt", async () => {
    vi.useFakeTimers();
    setRoute("low_cost");
    mocks.provider.mockImplementation(async (input) => {
      input.onDelta("이미 저장된 합성 답변입니다.");
      return {
        model: "openai/gpt-oss-20b",
        providerRequestId: "synthetic-response",
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
      };
    });
    let completionStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      completionStarted = resolve;
    });
    mocks.complete.mockImplementation(() => {
      completionStarted();
      return new Promise(() => {});
    });
    mocks.readback.mockResolvedValue({
      data: {
        id: REQUEST,
        user_id: OWNER,
        status: "SUCCEEDED",
        error_code: null,
      },
      error: null,
    });
    const req = request();
    const removeListener = vi.spyOn(req.signal, "removeEventListener");
    const response = await POST(req);
    const reader = response.body!.getReader();
    await reader.read();
    await started;
    await reader.cancel();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(mocks.complete.mock.calls[0]?.[2]?.signal.aborted).toBe(true);
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "CANCELLED" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    // Actual SQL no-ops on SUCCEEDED; readback mismatch is not rewritten.
    expect(mocks.readback).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "retains completion RPC caller compatibility signal=%s",
    async (withSignal) => {
      const actual =
        await vi.importActual<typeof import("@/lib/ai/usage")>(
          "@/lib/ai/usage",
        );
      const result = { error: null };
      const abortSignal = vi.fn(() => result);
      const builder = { abortSignal };
      const rpc = vi.fn(() => builder);
      const client = { rpc } as unknown as Parameters<
        typeof actual.completeAiRequest
      >[0];
      const input = {
        cachedInputTokens: 0,
        inputTokens: 1,
        model: "synthetic-model",
        outputTokens: 1,
        providerRequestId: "synthetic-response",
        requestId: REQUEST,
        responseCharacterCount: 1,
        userId: OWNER,
      };
      const signal = new AbortController().signal;
      const response = withSignal
        ? await actual.completeAiRequest(client, input, { signal })
        : await actual.completeAiRequest(client, input);
      expect(response).toBe(withSignal ? result : builder);
      expect(abortSignal).toHaveBeenCalledTimes(withSignal ? 1 : 0);
    },
  );
});
