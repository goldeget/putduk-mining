import { mkdirSync, writeFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ownerQaCorpus } from "../fixtures/ai-owner-qa-corpus";
import { planAiTurn } from "@/lib/ai/orchestrator";
import { buildAiInstructions } from "@/lib/ai/prompt";
import { executeAiTool } from "@/lib/ai/tool-executor";
import { runMemberProviderChain } from "@/lib/ai/provider-chain";
import type { ProviderAttemptPort } from "@/lib/ai/provider-attempts";
import { NVIDIA_MODELS } from "@/lib/ai/provider-models";
import { createAiProviderOutputGuard } from "@/lib/ai/response-guard";

type Evidence = {
  id: string;
  category: string;
  authority: string;
  routeKind: string;
  routeKey: string;
  deterministicStatus: "PASS" | "GAP";
  gaps: string[];
  exercised: string[];
  providerFixtureCalls: number;
  realProviderCalls: 0;
  paidCalls: 0;
  actualResponseQuality: "UNVERIFIED";
  accountEvidence: string;
  safetyRubric: string;
  responseRubric: string;
  accountSuccessState:
    "NOT_APPLICABLE" | "SOURCE_FAILURE_PATH_ONLY" | "NOT_IMPLEMENTED";
  runtimeScenario: "SEPARATE_RUNTIME_GATE_PENDING" | "QUESTION_PATH_EXECUTED";
};
const results: Evidence[] = [];
const runtimeCategories = new Set([
  "recovery-experience",
  "durable-context",
  "provider-and-cost",
]);

function unavailableOwnClient() {
  const query: Record<string, unknown> = {};
  for (const method of [
    "select",
    "order",
    "limit",
    "eq",
    "gte",
    "lt",
    "or",
    "in",
    "is",
    "not",
    "maybeSingle",
    "single",
  ])
    query[method] = () => query;
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({
      data: null,
      error: { code: "QA_OWN_SOURCE_UNAVAILABLE" },
    }).then(resolve);
  return {
    from: () => query,
    rpc: async () => ({
      data: null,
      error: { code: "QA_OWN_SOURCE_UNAVAILABLE" },
    }),
  } as unknown as SupabaseClient;
}
function attempts(): ProviderAttemptPort {
  return {
    admitFree: async () => {
      throw new Error("UNEXPECTED_FREE_ADMISSION");
    },
    reserve: async (input) => {
      if (input.paid || input.provider !== "nvidia")
        throw new Error("UNEXPECTED_PAID_OR_EXTERNAL_PROVIDER");
      return {
        id: "00000000-0000-4000-8000-000000000001",
        status: "RESERVED",
        replay: false,
      };
    },
    settle: async (input) => ({
      id: input.attemptId,
      status: input.status,
      replay: false,
    }),
  };
}

describe("QA-001 distinct question pathways — controlled Local transport", () => {
  it.each(ownerQaCorpus)("$id $category: $question", async (item) => {
    const plan = planAiTurn({ question: item.question });
    const gaps: string[] = [];
    const exercised = ["planAiTurn", "routeAiQuestion", "guardAiQuestion"];
    let answer = "";
    let providerFixtureCalls = 0;
    if (plan.route.kind === "static") {
      answer = plan.route.answer;
      exercised.push("canonicalStaticAnswer");
    } else if (plan.route.kind === "tool") {
      const result = await executeAiTool(
        unavailableOwnClient(),
        plan.route.tool,
      );
      expect(result.ok).toBe(false);
      expect(result.answer).not.toMatch(/\d[\d,.]*\s*(원|KRW|USDT)/);
      answer = result.answer;
      exercised.push(
        "executeAiTool",
        "ownedSourceFailureWithoutInventedAccountFacts",
      );
    } else {
      const instructions = buildAiInstructions(plan.context);
      expect(instructions).toContain("계정 조회 도구가 없습니다");
      expect(instructions).toContain("CANONICAL_PUBLIC_FACTS");
      expect(plan.cacheable).toBe(false);
      const outputGuard = createAiProviderOutputGuard();
      const registryReader = vi.fn();
      const responseText =
        item.authority === "OWN_ACCOUNT"
          ? "현재 계정 정보는 확인하지 못했어요. 해당 화면에서 다시 확인해 주세요."
          : "이 답변은 서버 경로 확인용 시험 문장이에요. 실제 모델 품질을 검증한 답변이 아니에요.";
      const completed = await runMemberProviderChain({
        nvidiaApiKey: "local-fixture-not-an-api-key",
        paidCallAuthorized: false,
        instructions,
        question: item.question,
        history: [],
        maxOutputTokens: 900,
        firstTokenTimeoutMs: 15_000,
        signal: new AbortController().signal,
        port: attempts(),
        registryReader,
        onDelta: (text) => {
          expect(outputGuard.inspect(text).allowed).toBe(true);
          answer += text;
        },
        fetcher: async (_target, init) => {
          void _target;
          providerFixtureCalls++;
          const sent = JSON.parse(String(init?.body)) as {
            model: string;
            messages: { role: string; content: string }[];
          };
          expect(sent.model).toBe(NVIDIA_MODELS[0]);
          expect(sent.messages.at(-1)?.role).toBe("user");
          const frame = (data: object) =>
            `data: ${JSON.stringify({ id: `qa-${item.id}`, model: NVIDIA_MODELS[0], ...data })}\n\n`;
          return new Response(
            [
              frame({
                choices: [
                  {
                    index: 0,
                    delta: { reasoning_content: "DO_NOT_DISCLOSE_REASONING" },
                    finish_reason: null,
                  },
                ],
              }),
              frame({
                choices: [
                  {
                    index: 0,
                    delta: { content: responseText },
                    finish_reason: null,
                  },
                ],
              }),
              frame({
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              }),
              frame({
                choices: [],
                usage: {
                  prompt_tokens: 11,
                  completion_tokens: 12,
                  total_tokens: 23,
                },
              }),
              "data: [DONE]\n\n",
            ].join(""),
            { headers: { "content-type": "text/event-stream" } },
          );
        },
      });
      expect(completed.inputTokens).toBe(11);
      expect(completed.outputTokens).toBe(12);
      expect(completed.costNanoUsd).toBeNull();
      expect(registryReader).not.toHaveBeenCalled();
      expect(answer).not.toContain("DO_NOT_DISCLOSE_REASONING");
      exercised.push(
        "buildAiInstructions",
        "runMemberProviderChain",
        "providerSseParser",
        "outputGuard",
        "attemptLeaseStateMachine",
      );
    }
    expect(answer).toMatch(/[가-힣]/);
    if (item.authority === "DENY" && !plan.route.routeKey.startsWith("guard_"))
      gaps.push("REQUIRES_PRE_DISPATCH_AUTHORITY_REFUSAL");
    const legitimateRewardClarification =
      item.id === "QA-049" &&
      plan.route.kind === "static" &&
      plan.route.routeKey === "clarify_account_reward_source";
    if (
      item.authority === "OWN_ACCOUNT" &&
      plan.route.kind !== "tool" &&
      !legitimateRewardClarification
    )
      gaps.push("OWN_STATE_NOT_GROUNDED_IN_AUTHENTICATED_TOOL");
    if (["QA-044", "QA-053"].includes(item.id))
      gaps.push("ACTUAL_PRODUCT_ENTITLEMENT_CONTRACT_UNPROVEN");
    const evidence: Evidence = {
      id: item.id,
      category: item.category,
      authority: item.authority,
      routeKind: plan.route.kind,
      routeKey: plan.route.routeKey,
      deterministicStatus: gaps.length ? "GAP" : "PASS",
      gaps,
      exercised,
      providerFixtureCalls,
      realProviderCalls: 0,
      paidCalls: 0,
      actualResponseQuality: "UNVERIFIED",
      accountEvidence: item.accountEvidence,
      safetyRubric: item.safetyRubric,
      responseRubric: item.responseRubric,
      accountSuccessState:
        item.authority !== "OWN_ACCOUNT" || legitimateRewardClarification
          ? "NOT_APPLICABLE"
          : plan.route.kind === "tool"
            ? "SOURCE_FAILURE_PATH_ONLY"
            : "NOT_IMPLEMENTED",
      runtimeScenario: runtimeCategories.has(item.category)
        ? "SEPARATE_RUNTIME_GATE_PENDING"
        : "QUESTION_PATH_EXECUTED",
    };
    results.push(evidence);
    // This assertion proves execution, not semantic accuracy of fixture text.
    expect(evidence.exercised.length).toBeGreaterThan(2);
  });
  afterAll(() => {
    mkdirSync("test-results/provider-qa", { recursive: true });
    const report = {
      proof: "200_DISTINCT_QUESTION_PATHS_CONTROLLED_LOCAL_TRANSPORT",
      executed: results.length,
      deterministicPass: results.filter(
        (item) => item.deterministicStatus === "PASS",
      ).length,
      deterministicGap: results.filter(
        (item) => item.deterministicStatus === "GAP",
      ).length,
      separateRuntimePending: results.filter(
        (item) => item.runtimeScenario === "SEPARATE_RUNTIME_GATE_PENDING",
      ).length,
      actualModelQualityEvaluations: 0,
      realProviderCalls: 0,
      paidCalls: 0,
      cases: results,
    };
    writeFileSync(
      "test-results/provider-qa/owner-qa-200-execution.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.info(
      JSON.stringify({
        executed: report.executed,
        deterministicPass: report.deterministicPass,
        deterministicGap: report.deterministicGap,
        separateRuntimePending: report.separateRuntimePending,
        actualModelQualityEvaluations: 0,
        realProviderCalls: 0,
      }),
    );
  });
});
