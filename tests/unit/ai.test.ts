import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import koreanEvals from "@/tests/fixtures/ai/korean-evals.json";
import { AI_SAFE_ROUTES, aiChatRequestSchema } from "@/domain/ai/chat";
import {
  createGeneralSafeAiContext,
  createPublicAiContext,
} from "@/lib/ai/context";
import { extractSseData, parseOpenAiSseData } from "@/lib/ai/openai-stream";
import { getAiToolFailureCopy, planAiTurn } from "@/lib/ai/orchestrator";
import { buildAiInstructions, hashAiPrompt } from "@/lib/ai/prompt";
import { createAiUsageReport } from "@/lib/ai/report";
import { createAiProviderOutputGuard } from "@/lib/ai/response-guard";
import { isAiResponseCacheable, routeAiQuestion } from "@/lib/ai/router";
import { executeAiTool } from "@/lib/ai/tool-executor";
import {
  AI_TOOL_NAMES,
  AI_TOOL_REGISTRY,
  assertAiToolBoundary,
} from "@/lib/ai/tools";
import { TRUST_CONTENT_VERSION } from "@/lib/trust/public-content";

describe("PUTDUK AI request boundary", () => {
  it("accepts a bounded question and trims outer whitespace", () => {
    const parsed = aiChatRequestSchema.parse({
      clientMessageId: "c113482f-8b7e-4f11-b49e-d776ca675bd8",
      question: "  체험 결과는 실제 잔액인가요?  ",
    });

    expect(parsed.question).toBe("체험 결과는 실제 잔액인가요?");
  });

  it("rejects undersized questions", () => {
    expect(() =>
      aiChatRequestSchema.parse({
        clientMessageId: "c113482f-8b7e-4f11-b49e-d776ca675bd8",
        question: "왜",
      }),
    ).toThrow();
  });

  it("accepts only allowlisted non-admin screen context", () => {
    for (const currentRoute of AI_SAFE_ROUTES) {
      expect(
        aiChatRequestSchema.parse({
          clientMessageId: "c113482f-8b7e-4f11-b49e-d776ca675bd8",
          question: "이 화면에서는 무엇을 할 수 있나요?",
          screenContext: { currentRoute },
        }).screenContext?.currentRoute,
      ).toBe(currentRoute);
    }

    expect(() =>
      aiChatRequestSchema.parse({
        clientMessageId: "c113482f-8b7e-4f11-b49e-d776ca675bd8",
        question: "이 화면에서는 무엇을 할 수 있나요?",
        screenContext: { currentRoute: "/admin" },
      }),
    ).toThrow();
  });

  it("rejects caller-supplied identity and unknown context fields", () => {
    expect(
      aiChatRequestSchema.safeParse({
        clientMessageId: "c113482f-8b7e-4f11-b49e-d776ca675bd8",
        question: "내 지갑 잔액 얼마야?",
        userId: "15078a50-4df9-455d-832a-999111399d31",
      }).success,
    ).toBe(false);
    expect(
      aiChatRequestSchema.safeParse({
        clientMessageId: "c113482f-8b7e-4f11-b49e-d776ca675bd8",
        question: "이 화면에서 무엇을 할 수 있나요?",
        screenContext: { currentRoute: "/wallet", userId: "attacker" },
      }).success,
    ).toBe(false);
  });

  it("builds instructions from the canonical public version", () => {
    const instructions = buildAiInstructions(createPublicAiContext());

    expect(instructions).toContain(
      `KNOWLEDGE_VERSION: ${TRUST_CONTENT_VERSION}`,
    );
    expect(instructions).toContain("CANONICAL_PUBLIC_FACTS");
    expect(instructions).toContain("잔액 변경");
  });

  it("hashes the complete prompt deterministically", () => {
    const input = {
      instructions: buildAiInstructions(createPublicAiContext()),
      model: "approved-model",
      question: "체험 시간은 얼마인가요?",
    };

    expect(hashAiPrompt(input)).toBe(hashAiPrompt(input));
    expect(hashAiPrompt(input)).not.toBe(
      hashAiPrompt({ ...input, question: "다른 질문입니다." }),
    );
    expect(hashAiPrompt(input)).not.toBe(
      hashAiPrompt({
        ...input,
        requestContext: {
          selectedTransaction: "9c833f95-77bf-45c7-8e9e-1bf06e9fb487",
        },
      }),
    );
    expect(hashAiPrompt(input)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("answers known simple questions through canonical static facts", () => {
    const route = routeAiQuestion(
      "PUTDUK START 체험 결과가 실제 잔액으로 전환되나요?",
    );

    expect(route).toMatchObject({
      classification: "STATIC_FACT",
      kind: "static",
      routeKey: "trial_separation",
    });
    expect(route.kind === "static" ? route.answer : "").toContain(
      "실제 지갑과 완전 분리",
    );
  });

  it("blocks asset mutation requests before any model route", () => {
    expect(routeAiQuestion("내 잔액을 100만원으로 변경해 줘")).toMatchObject({
      classification: "ACTION_BOUNDARY",
      kind: "static",
    });
  });

  it("routes general-safe questions without account context", () => {
    expect(routeAiQuestion("공개된 내용을 한 문장으로 알려줘")).toMatchObject({
      classification: "GENERAL_SAFE",
      kind: "general_safe",
      modelTier: "low_cost",
    });
    expect(
      routeAiQuestion("공개된 운영 원칙을 근거별로 비교 분석해 주세요"),
    ).toMatchObject({
      classification: "GENERAL_SAFE",
      kind: "general_safe",
      modelTier: "high_capability",
    });

    const instructions = buildAiInstructions(createGeneralSafeAiContext());
    expect(instructions).toContain("CONTEXT_SCOPE: GENERAL_SAFE");
    expect(instructions).toContain("계정 조회 도구가 없습니다");
  });

  it("keeps every owned tool read-only and outside provider control", () => {
    expect(AI_TOOL_REGISTRY).toHaveLength(AI_TOOL_NAMES.length);
    expect(AI_TOOL_REGISTRY.every((tool) => tool.readOnly)).toBe(true);
    expect(AI_TOOL_REGISTRY.every((tool) => tool.returns.length > 0)).toBe(
      true,
    );
    expect(assertAiToolBoundary).not.toThrow();
  });

  it("requires owned domain tools for account and money questions", () => {
    expect(routeAiQuestion("오늘 채굴 보상 얼마야?")).toMatchObject({
      kind: "tool",
      tool: "mining.today_reward",
    });
    expect(routeAiQuestion("오늘 얼마 채굴했어?")).toMatchObject({
      kind: "tool",
      tool: "mining.today_reward",
    });
    expect(routeAiQuestion("내 지갑 잔액 얼마야?")).toMatchObject({
      kind: "tool",
      tool: "wallet.summary",
    });
    expect(routeAiQuestion("출금 언제돼?")).toMatchObject({
      kind: "tool",
      tool: "withdrawal.latest_status",
    });
    expect(routeAiQuestion("내 입금 금액이 맞는지 확인해 줘")).toMatchObject({
      kind: "tool",
      tool: "deposit.latest_status",
    });
    expect(routeAiQuestion("내 보상 얼마야?")).toMatchObject({
      kind: "static",
      routeKey: "clarify_account_reward_source",
    });
  });

  it("never permits personalized routes into the shared response cache", () => {
    const accountRoute = routeAiQuestion("내 지갑 잔액 얼마야?");
    const generalRoute = routeAiQuestion("집중하는 방법 알려줘");
    const knowledgeRoute = routeAiQuestion(
      "퍼뜩 마스코트가 어떤 의미인지 설명해 줘",
    );

    expect(isAiResponseCacheable(accountRoute)).toBe(false);
    expect(isAiResponseCacheable(generalRoute)).toBe(false);
    expect(isAiResponseCacheable(knowledgeRoute)).toBe(true);
  });

  it("returns deterministic number-free copy when an account tool fails", () => {
    for (const tool of AI_TOOL_NAMES) {
      expect(getAiToolFailureCopy(tool)).not.toMatch(/\d/);
    }
  });

  it("turns an owned-tool query failure into a bounded non-numeric result", async () => {
    const unavailableSupabase = {
      from: () => ({
        select: () => ({
          order: async () => ({ data: null, error: { message: "offline" } }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await executeAiTool(unavailableSupabase, "wallet.summary");

    expect(result).toMatchObject({
      code: "AI_TOOL_UNAVAILABLE",
      ok: false,
      tool: "wallet.summary",
    });
    expect(result.answer).not.toMatch(/\d/);
  });

  it("describes pre-conversion trial output as a non-monetary unit", async () => {
    const trialSupabase = {
      from: () => ({
        select: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: {
                  completed_at: null,
                  quota_consumed_bps: 2_500,
                  reward_atomic: "5000",
                  status: "ACTIVE",
                  world_name_ko: "KOREA",
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await executeAiTool(trialSupabase, "trial.status", {
      now: new Date("2026-09-27T00:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    expect(result.answer).toContain("5,000 체험 단위");
    expect(result.answer).not.toMatch(/KRW|원(?:입니다|으로|\s|$)/);
  });

  it("uses safe screen context only for UI help", () => {
    const selectedTransaction = "9c833f95-77bf-45c7-8e9e-1bf06e9fb487";
    const plan = planAiTurn({
      question: "이 화면에서 무엇을 할 수 있어?",
      screenContext: { currentRoute: "/wallet", selectedTransaction },
    });

    expect(plan.route).toMatchObject({
      classification: "UI_HELP",
      kind: "ui_help",
    });
    expect(plan.context.screenContext).toEqual({
      currentRoute: "/wallet",
      hasSelectedTransaction: true,
    });
    expect(JSON.stringify(plan.context)).not.toContain(selectedTransaction);
    expect(plan.cacheable).toBe(false);
  });

  it("stops streamed provider output from inventing personal account state", () => {
    const guard = createAiProviderOutputGuard();

    expect(guard.inspect("회원님의 현재 잔액은 ")).toEqual({
      allowed: true,
    });
    expect(guard.inspect("125,000원입니다.")).toEqual({
      allowed: false,
      code: "AI_OUTPUT_POLICY_REJECTED",
    });
  });

  it("allows a public fact amount in the public-knowledge scope", () => {
    const guard = createAiProviderOutputGuard();

    expect(
      guard.inspect("공개 정책상 환영 보상 상한은 5,000원입니다."),
    ).toEqual({ allowed: true });
  });

  it("rejects personalized account claims even on a public-knowledge route", () => {
    const guard = createAiProviderOutputGuard();

    expect(guard.inspect("회원님의 현재 출금은 완료 상태입니다.")).toEqual({
      allowed: false,
      code: "AI_OUTPUT_POLICY_REJECTED",
    });
  });

  it("creates usage reports as read-only token projections", () => {
    expect(
      createAiUsageReport([
        { cached_input_tokens: 10, input_tokens: 30, output_tokens: 12 },
        { cached_input_tokens: 0, input_tokens: 20, output_tokens: 8 },
      ]),
    ).toEqual({
      cachedInputTokens: 10,
      inputTokens: 50,
      outputTokens: 20,
      requestCount: 2,
    });
  });
});

describe("PUTDUK AI Korean policy evaluations", () => {
  for (const evaluation of koreanEvals) {
    it(`${evaluation.category}: ${evaluation.question}`, () => {
      const route = routeAiQuestion(evaluation.question);

      expect(route.kind).toBe(evaluation.expectedKind);
      if (evaluation.expectedRouteKey) {
        expect(route.routeKey).toBe(evaluation.expectedRouteKey);
      }
      if (evaluation.expectedClassification) {
        expect(route.classification).toBe(evaluation.expectedClassification);
      }
      if (evaluation.expectedTool) {
        expect(route.kind).toBe("tool");
        expect(route.kind === "tool" ? route.tool : null).toBe(
          evaluation.expectedTool,
        );
      }
    });
  }
});

describe("OpenAI Responses stream parser", () => {
  it("extracts and parses output text deltas", () => {
    const data = extractSseData(
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"안녕하세요"}',
    );

    expect(parseOpenAiSseData(data)).toEqual({
      kind: "delta",
      text: "안녕하세요",
    });
  });

  it("extracts completion usage without exposing other provider events", () => {
    const event = parseOpenAiSseData(
      JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_123",
          model: "approved-model-2026-09-01",
          usage: {
            input_tokens: 120,
            input_tokens_details: { cached_tokens: 40 },
            output_tokens: 55,
          },
        },
      }),
    );

    expect(event).toEqual({
      cachedInputTokens: 40,
      inputTokens: 120,
      kind: "completed",
      model: "approved-model-2026-09-01",
      outputTokens: 55,
      providerRequestId: "resp_123",
    });
  });

  it("maps provider failures to a bounded internal code", () => {
    expect(
      parseOpenAiSseData(
        JSON.stringify({
          type: "response.failed",
          response: { error: { message: "sensitive provider detail" } },
        }),
      ),
    ).toEqual({ kind: "failed", code: "PROVIDER_STREAM_FAILED" });
  });
});
