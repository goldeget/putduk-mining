import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { expect, it } from "vitest";
import { buildAiInstructions } from "@/lib/ai/prompt";
import { createGeneralSafeAiContext } from "@/lib/ai/context";
import { runMemberProviderChain } from "@/lib/ai/provider-chain";
import { NVIDIA_MODELS } from "@/lib/ai/provider-models";

// One explicitly authorized free request. Controlled attempt storage is NOT a
// real DB admission proof; earlier separate Local DB smoke supplies that proof.
it.skipIf(process.env.PUTDUK_LOCAL_PLAIN_KOREAN_QUALITY !== "1")(
  "one actual NVIDIA sample checks strengthened plain Korean instructions",
  async () => {
    loadEnvFile(".env.local");
    const key = process.env.NVIDIA_API_KEY || process.env.AI_API_KEY;
    if (!key) throw Error("NVIDIA_KEY_MISSING");
    let calls = 0,
      answer = "",
      firstTokenMs: number | null = null,
      start = 0;
    const question = "집중을 위해 잠깐 쉬는 방법을 한 문장으로 알려 주세요.";
    const completed = await runMemberProviderChain({
      nvidiaApiKey: key,
      paidCallAuthorized: false,
      instructions: buildAiInstructions(createGeneralSafeAiContext()),
      question,
      history: [],
      maxOutputTokens: 900,
      firstTokenTimeoutMs: 15000,
      signal: new AbortController().signal,
      port: {
        admitFree: async () => {
          throw Error("UNAUTHORIZED_FREE_FALLBACK");
        },
        reserve: async () => ({
          id: "00000000-0000-4000-8000-000000000001",
          status: "RESERVED",
          replay: false,
        }),
        settle: async (input) => ({
          id: input.attemptId,
          status: input.status,
          replay: false,
        }),
      },
      registryReader: async () => {
        throw Error("UNAUTHORIZED_REGISTRY_FALLBACK");
      },
      onDelta: (text) => {
        if (firstTokenMs === null) firstTokenMs = Date.now() - start;
        answer += text;
      },
      fetcher: async (target, init) => {
        if (
          String(target) !==
            "https://integrate.api.nvidia.com/v1/chat/completions" ||
          JSON.parse(String(init?.body)).model !== NVIDIA_MODELS[0] ||
          calls !== 0
        )
          throw Error("ONE_CALL_SCOPE_LIMIT");
        calls++;
        start = Date.now();
        return fetch(target, init);
      },
    });
    expect(calls).toBe(1);
    expect(completed.model).toBe(NVIDIA_MODELS[0]);
    expect(answer).toMatch(/[가-힣]/);
    expect(answer).not.toMatch(/관음|<think>|숨겨진 추론/);
    mkdirSync("test-results/provider-qa", { recursive: true });
    writeFileSync(
      "test-results/provider-qa/actual-plain-korean-retest.json",
      JSON.stringify(
        {
          proof: "ONE_REAL_NVIDIA_REQUEST_CONTROLLED_ATTEMPT_PORT",
          question,
          answer,
          model: completed.model,
          inputTokens: completed.inputTokens,
          outputTokens: completed.outputTokens,
          costNanoUsd:
            completed.costNanoUsd === null
              ? null
              : String(completed.costNanoUsd),
          firstTokenMs,
          firstTokenTimeoutMs: 15000,
          actualNvidiaCalls: calls,
          actualFreeCalls: 0,
          paidCalls: 0,
          actualDatabaseAdmission: false,
          previousQualityGapPreserved: true,
          broad200Quality: "UNVERIFIED",
        },
        null,
        2,
      ),
    );
  },
  60000,
);
