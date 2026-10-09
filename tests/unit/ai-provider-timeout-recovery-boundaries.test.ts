import { afterEach, describe, expect, it, vi } from "vitest";
import { runMemberProviderChain } from "@/lib/ai/provider-chain";
import type { ProviderAttemptPort } from "@/lib/ai/provider-attempts";
import {
  NVIDIA_MODELS,
  OPENROUTER_FREE_MODEL,
  verifyOpenRouterModel,
} from "@/lib/ai/provider-models";

// Explicit fixture transport only. Does not load .env, use DB, keys, browsers or HTTP.
function proof() {
  const pricing = { prompt: "0", completion: "0" };
  const now = Date.now();
  return verifyOpenRouterModel({
    model: OPENROUTER_FREE_MODEL,
    nowMs: now,
    retrievedAtMs: now,
    registry: {
      data: [
        {
          id: OPENROUTER_FREE_MODEL,
          architecture: {
            input_modalities: ["text"],
            output_modalities: ["text"],
          },
          pricing,
        },
      ],
    },
    endpointRegistry: {
      data: {
        id: OPENROUTER_FREE_MODEL,
        endpoints: [
          {
            model_id: OPENROUTER_FREE_MODEL,
            provider_name: "Novita",
            tag: "novita/bf16",
            status: 0,
            supported_parameters: ["max_tokens"],
            pricing,
          },
        ],
      },
    },
  });
}
function port(): ProviderAttemptPort {
  let n = 0;
  return {
    admitFree: vi.fn(async () => undefined),
    reserve: vi.fn(async () => ({
      id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
      status: "RESERVED" as const,
      replay: false,
    })),
    settle: vi.fn(async (a) => ({
      id: a.attemptId,
      status: a.status,
      replay: false,
    })),
  };
}
function input() {
  return {
    nvidiaApiKey: "SYNTHETIC_NO_KEY",
    openRouterFreeApiKey: "SYNTHETIC_NO_KEY_FREE",
    openRouterPaidApiKey: "SYNTHETIC_NO_KEY_PAID",
    paidCallAuthorized: false,
    instructions: "합성 로컬 시험",
    question: "일반 질문",
    history: [],
    maxOutputTokens: 100,
    firstTokenTimeoutMs: 15_000,
    signal: new AbortController().signal,
    port: port(),
    registryReader: vi.fn(async () => proof()),
    onDelta: vi.fn(),
  };
}
const frame = (model: string, data: object) =>
  `data: ${JSON.stringify({ id: "synthetic-proof", model, ...data })}\n\n`;
function success(model: string) {
  return new Response(
    frame(model, {
      choices: [
        { index: 0, delta: { content: "합성 응답" }, finish_reason: null },
      ],
    }) +
      frame(model, {
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }) +
      frame(model, {
        choices: [],
        provider: "Novita",
        usage: {
          prompt_tokens: 2,
          completion_tokens: 2,
          total_tokens: 4,
          cost: "0",
        },
      }) +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("23 pending gaps: controlled server transport only", () => {
  it("QA162 first-token 15000ms boundary precedes second NVIDIA and free fallback", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("UNEXPECTED_REAL_NETWORK");
    });
    vi.useFakeTimers();
    const i = input(),
      calls: { model: string; time: number }[] = [];
    const start = Date.now();
    const fetcher = vi.fn(async (_url: unknown, opts?: RequestInit) => {
      const model = JSON.parse(String(opts?.body)).model;
      calls.push({ model, time: Date.now() - start });
      if (calls.length === 1)
        return await new Promise<Response>((_resolve, reject) =>
          opts?.signal?.addEventListener(
            "abort",
            () => reject(new Error("synthetic-timeout")),
            { once: true },
          ),
        );
      return calls.length === 2
        ? new Response(null, { status: 503 })
        : success(model);
    });
    const result = runMemberProviderChain({
      ...i,
      fetcher: fetcher as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls).toEqual([{ model: NVIDIA_MODELS[0], time: 0 }]);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).model).toBe(OPENROUTER_FREE_MODEL);
    expect(calls).toEqual([
      { model: NVIDIA_MODELS[0], time: 0 },
      { model: NVIDIA_MODELS[1], time: 15_000 },
      { model: OPENROUTER_FREE_MODEL, time: 15_000 },
    ]);
  });
  it("QA165 emitted partial text followed by broken stream never dispatches another provider", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("UNEXPECTED_REAL_NETWORK");
    });
    const i = input();
    const fetcher = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  frame(NVIDIA_MODELS[0], {
                    choices: [
                      {
                        index: 0,
                        delta: { content: "합성 부분 답변" },
                        finish_reason: null,
                      },
                    ],
                  }),
                ),
              );
              setTimeout(
                () => controller.error(new Error("synthetic-broken-stream")),
                0,
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    await expect(
      runMemberProviderChain({ ...i, fetcher }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNREACHABLE" });
    expect(i.onDelta).toHaveBeenCalledWith("합성 부분 답변");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(i.registryReader).not.toHaveBeenCalled();
    expect(i.port.settle).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "UNKNOWN", costMicroUsd: null }),
    );
  });
  it("QA169 upstream429 may reach free, while member free quota stops before free dispatch and paid", async () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("UNEXPECTED_REAL_NETWORK");
    });
    const i = input();
    let n = 0;
    const upstream = vi.fn(async (_url: unknown, opts?: RequestInit) =>
      ++n < 3
        ? new Response(null, { status: 429 })
        : success(JSON.parse(String(opts?.body)).model),
    );
    expect(
      (
        await runMemberProviderChain({
          ...i,
          fetcher: upstream as typeof fetch,
        })
      ).model,
    ).toBe(OPENROUTER_FREE_MODEL);
    expect(upstream).toHaveBeenCalledTimes(3);
    const blocked = input();
    blocked.port.admitFree = vi.fn(async () => {
      throw new Error("AI_FREE_POOL_LIMIT");
    });
    const fetcher = vi.fn(async () => new Response(null, { status: 429 }));
    await expect(
      runMemberProviderChain({ ...blocked, fetcher }),
    ).rejects.toMatchObject({ code: "AI_FREE_POOL_LIMIT" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(blocked.port.reserve).toHaveBeenCalledTimes(2);
  });
});
