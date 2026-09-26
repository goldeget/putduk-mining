import { describe, expect, it } from "vitest";

import { aiChatRequestSchema } from "@/domain/ai/chat";
import { createPublicAiContext } from "@/lib/ai/context";
import { extractSseData, parseOpenAiSseData } from "@/lib/ai/openai-stream";
import { buildAiInstructions, hashAiPrompt } from "@/lib/ai/prompt";
import { createAiUsageReport } from "@/lib/ai/report";
import { routeAiQuestion } from "@/lib/ai/router";
import { AI_TOOL_REGISTRY, assertAiToolBoundary } from "@/lib/ai/tools";
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

  it("routes unmatched simple and complex questions to different model tiers", () => {
    expect(routeAiQuestion("공개된 내용을 한 문장으로 알려줘")).toMatchObject({
      kind: "low_cost",
    });
    expect(
      routeAiQuestion("공개된 운영 원칙을 근거별로 비교 분석해 주세요"),
    ).toMatchObject({ kind: "high_capability" });
  });

  it("keeps the provider tool registry mutation-free in V1", () => {
    expect(AI_TOOL_REGISTRY).toHaveLength(0);
    expect(assertAiToolBoundary).not.toThrow();
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
