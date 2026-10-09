import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { runMemberProviderChain } from "@/lib/ai/provider-chain";
import {
  NVIDIA_CHAT_URL,
  OPENROUTER_CHAT_URL,
  OPENROUTER_FREE_MODEL,
} from "@/lib/ai/provider-models";
import { readProviderRegistry } from "@/lib/ai/provider-registry";
import { createProviderSseDecoder } from "@/lib/ai/provider-stream";
import { createProviderAttemptPort } from "@/lib/ai/provider-attempts";
import { beginAiRequest, completeAiRequest } from "@/lib/ai/usage";
import {
  appendOwnMemberTurn,
  createSupabaseMemberConversationPort,
} from "@/lib/ai/member-conversation";
import { readOwnAiMessages } from "@/lib/ai/member-conversation-read";
import { readOwnProviderUsage } from "@/lib/ai/member-usage";

// Mixed evidence: two controlled pre-answer NVIDIA transport failures, then one
// REAL verified free OpenRouter request. Not a claim of actual NVIDIA outage.
it.skipIf(process.env.PUTDUK_LOCAL_OPENROUTER_SMOKE !== "1")(
  "verified OpenRouter free fallback has actual response, independent count and durable owner transcript",
  async () => {
    loadEnvFile(".env.local");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url !== "http://127.0.0.1:61421")
      throw new Error("BLOCKED_TARGET_SCOPE");
    const secret = process.env.SUPABASE_SECRET_KEY;
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const nvidia = process.env.NVIDIA_API_KEY || process.env.AI_API_KEY;
    const free = process.env.OPENROUTER_FREE_API_KEY;
    if (!secret || !publishable || !nvidia || !free)
      throw new Error("LOCAL_SMOKE_KEYS_MISSING");
    // No inference or secret transfer unless the exact approved free model and
    // text-only zero-price endpoint can be verified from public current registry.
    const modelProof = await readProviderRegistry(
      OPENROUTER_FREE_MODEL,
      AbortSignal.timeout(15_000),
    );
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `free-recovery-${randomUUID()}@example.invalid`;
    const password = randomUUID() + randomUUID();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        signup_source: "PUBLIC_V1",
        login_id: `qa_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
        legal_name: "무료경로검증",
        date_of_birth: "1990-01-01",
        phone_e164: `+8210${String(randomInt(100_000_000)).padStart(8, "0")}`,
        recovery_email: email,
        service_terms_version: "TERMS-KO-2026-09-27",
        privacy_version: "PRIVACY-KO-2026-09-27",
        marketing_version: "MARKETING-KO-2026-09-27",
        service_terms_granted: true,
        privacy_granted: true,
        marketing_granted: false,
      },
    });
    if (created.error || !created.data.user)
      throw new Error("LOCAL_FREE_FIXTURE_FAILED");
    const userId = created.data.user.id;
    const member = createClient(url, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    if ((await member.auth.signInWithPassword({ email, password })).error)
      throw new Error("LOCAL_FREE_LOGIN_FAILED");
    const clientMessageId = randomUUID();
    const admitted = await beginAiRequest(admin, {
      clientMessageId,
      contextScope: "GENERAL_SAFE",
      inputRedacted: { controlledNvidiaTransportFailure: true },
      knowledgeVersion: "2026.09",
      model: OPENROUTER_FREE_MODEL,
      perDayLimit: 100,
      perMinuteLimit: 5,
      promptHash: "c".repeat(64),
      routeKey: "general_safe",
      routeKind: "general_safe",
      safetyClassification: "GENERAL_SAFE",
      userId,
    });
    if (admitted.error) throw new Error("LOCAL_FREE_ADMISSION_FAILED");
    const admission = Array.isArray(admitted.data)
      ? admitted.data[0]
      : admitted.data;
    if (!admission?.is_new || typeof admission.request_id !== "string")
      throw new Error("LOCAL_FREE_ADMISSION_UNVERIFIED");
    let answer = "";
    let simulatedNvidia = 0;
    let actualFreeCalls = 0;
    let startedAt = 0;
    let firstTokenMs: number | null = null;
    const finishes: string[] = [];
    const completed = await runMemberProviderChain({
      nvidiaApiKey: nvidia,
      openRouterFreeApiKey: free,
      paidCallAuthorized: false,
      instructions: "한국어로 쉽고 짧게 답하세요. 내부 추론은 쓰지 마세요.",
      question: "책상 정리를 시작하는 쉬운 방법을 한 문장으로 알려 주세요.",
      history: [],
      maxOutputTokens: 900,
      firstTokenTimeoutMs: 15_000,
      signal: AbortSignal.timeout(60_000),
      port: createProviderAttemptPort(admin, {
        userId,
        requestId: admission.request_id,
        perMinuteLimit: 5,
        perDayLimit: 100,
      }),
      onDelta: (text) => {
        firstTokenMs ??= Math.round(performance.now() - startedAt);
        answer += text;
      },
      registryReader: async () => modelProof,
      fetcher: async (target, options) => {
        if (target === NVIDIA_CHAT_URL) {
          simulatedNvidia++;
          return new Response("", { status: 503 });
        }
        if (target !== OPENROUTER_CHAT_URL)
          throw new Error("BLOCKED_PROVIDER_TARGET");
        actualFreeCalls++;
        startedAt = performance.now();
        const response = await fetch(target, options);
        if (!response.body) return response;
        const decode = createProviderSseDecoder();
        const inspect = new TransformStream<Uint8Array, Uint8Array>({
          transform(bytes, controller) {
            for (const data of decode(bytes)) {
              if (data === "[DONE]") continue;
              const frame = JSON.parse(data) as {
                choices?: { finish_reason?: unknown }[];
              };
              for (const choice of frame.choices ?? []) {
                if (typeof choice.finish_reason === "string")
                  finishes.push(
                    [
                      "stop",
                      "length",
                      "tool_calls",
                      "content_filter",
                      "error",
                    ].includes(choice.finish_reason)
                      ? choice.finish_reason
                      : "UNCLASSIFIED",
                  );
              }
            }
            controller.enqueue(bytes);
          },
        });
        return new Response(response.body.pipeThrough(inspect), {
          status: response.status,
          headers: response.headers,
        });
      },
    }).catch((error: unknown) => {
      const code =
        error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "UNCLASSIFIED";
      const failure = {
        evidenceKind: "REAL_FREE_ATTEMPT_FAILED",
        userId,
        requestId: admission.request_id,
        code,
        finishes,
        simulatedNvidiaAttempts: simulatedNvidia,
        actualNvidiaCalls: 0,
        actualFreeCalls,
        paidCalls: 0,
      };
      mkdirSync("test-results/provider-smoke", { recursive: true });
      writeFileSync(
        `test-results/provider-smoke/openrouter-failed-${admission.request_id}.json`,
        JSON.stringify(failure, null, 2) + "\n",
      );
      console.info(JSON.stringify(failure));
      throw error;
    });
    expect(simulatedNvidia).toBe(2);
    expect(actualFreeCalls).toBe(1);
    expect(completed.model).toBe(OPENROUTER_FREE_MODEL);
    expect(completed.inputTokens).toBeGreaterThan(0);
    expect(completed.outputTokens).toBeGreaterThan(0);
    expect(completed.costNanoUsd).toBe(0n);
    expect(answer).toMatch(/[가-힣]/);
    const saved = await appendOwnMemberTurn(
      createSupabaseMemberConversationPort(admin),
      {
        userId,
        clientMessageId,
        question: "책상 정리를 시작하는 쉬운 방법을 한 문장으로 알려 주세요.",
        answer,
        sourceKey: "guide:provider",
        knowledgeVersion: "2026.09",
      },
    );
    if (!saved.ok) throw new Error("LOCAL_FREE_TRANSCRIPT_NOT_SAVED");
    const finished = await completeAiRequest(admin, {
      userId,
      requestId: admission.request_id,
      providerRequestId: completed.providerRequestId,
      model: completed.model,
      inputTokens: completed.inputTokens,
      outputTokens: completed.outputTokens,
      cachedInputTokens: completed.cachedInputTokens,
      responseCharacterCount: answer.length,
    });
    if (finished.error) throw new Error("LOCAL_FREE_COMPLETION_NOT_SAVED");
    const history = await readOwnAiMessages(
      member,
      userId,
      saved.conversationId,
    );
    expect(history.ok).toBe(true);
    if (history.ok) expect(history.messages).toHaveLength(2);
    const usage = await readOwnProviderUsage(admin, userId);
    expect(usage.free.attemptCount).toBe(1);
    expect(usage.free.succeeded).toBe(1);
    expect(usage.paid.attemptCount).toBe(0);
    const proof = {
      evidenceKind: "REAL_OPENROUTER_AFTER_CONTROLLED_NVIDIA_FAILURES",
      userId,
      requestId: admission.request_id,
      conversationId: saved.conversationId,
      model: completed.model,
      upstreamProvider: completed.upstreamProvider,
      inputTokens: completed.inputTokens,
      outputTokens: completed.outputTokens,
      costNanoUsd: completed.costNanoUsd?.toString() ?? null,
      firstTokenMs,
      firstTokenTimeoutMs: 15_000,
      finishes,
      simulatedNvidiaAttempts: simulatedNvidia,
      actualNvidiaCalls: 0,
      actualFreeCalls,
      paidCalls: 0,
    };
    mkdirSync("test-results/provider-smoke", { recursive: true });
    writeFileSync(
      `test-results/provider-smoke/openrouter-${admission.request_id}.json`,
      JSON.stringify(proof, null, 2) + "\n",
    );
    console.info(JSON.stringify(proof));
    await member.auth.signOut();
  },
  90_000,
);
