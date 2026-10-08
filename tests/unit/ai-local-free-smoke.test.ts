import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { runMemberProviderChain } from "@/lib/ai/provider-chain";
import { NVIDIA_MODELS } from "@/lib/ai/provider-models";
import { createProviderAttemptPort } from "@/lib/ai/provider-attempts";
import { beginAiRequest, completeAiRequest } from "@/lib/ai/usage";
import {
  appendOwnMemberTurn,
  createSupabaseMemberConversationPort,
} from "@/lib/ai/member-conversation";
import { readOwnAiMessages } from "@/lib/ai/member-conversation-read";
import { readOwnAiQuota } from "@/lib/ai/member-usage";

// Opt-in only: authorized fresh Local DB + NVIDIA trial. Never run via CI and
// never enable paid keys. Ordinary unit runs do not read an environment file.
it.skipIf(process.env.PUTDUK_LOCAL_FREE_SMOKE !== "1")(
  "real NVIDIA response has durable admission, actual usage and owned transcript",
  async () => {
    loadEnvFile(".env.local");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (url !== "http://127.0.0.1:61421")
      throw new Error("BLOCKED_TARGET_SCOPE");
    const secret = process.env.SUPABASE_SECRET_KEY;
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const nvidia = process.env.NVIDIA_API_KEY || process.env.AI_API_KEY;
    if (!secret || !publishable || !nvidia)
      throw new Error("LOCAL_SMOKE_KEYS_MISSING");
    const admin = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `provider-recovery-${randomUUID()}@example.invalid`;
    const password = randomUUID() + randomUUID();
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user)
      throw new Error("LOCAL_FIXTURE_NOT_CREATED");
    const userId = created.data.user.id;
    const member = createClient(url, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await member.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error("LOCAL_FIXTURE_AUTH_FAILED");
    const clientMessageId = randomUUID();
    const admitted = await beginAiRequest(admin, {
      clientMessageId,
      contextScope: "GENERAL_SAFE",
      inputRedacted: { fixture: true },
      knowledgeVersion: "2026.09",
      model: NVIDIA_MODELS[0],
      perDayLimit: 100,
      perMinuteLimit: 5,
      promptHash: "b".repeat(64),
      routeKey: "general_safe",
      routeKind: "general_safe",
      safetyClassification: "GENERAL_SAFE",
      userId,
    });
    if (admitted.error) throw new Error("LOCAL_ADMISSION_FAILED");
    const admission = Array.isArray(admitted.data)
      ? admitted.data[0]
      : admitted.data;
    if (!admission?.is_new || typeof admission.request_id !== "string")
      throw new Error("LOCAL_ADMISSION_UNVERIFIED");
    let answer = "";
    let attemptStartedAt = 0;
    let firstTokenMs: number | null = null;
    const dispatchEvidence: { model: string; status: number }[] = [];
    const metadata = vi.fn();
    const completed = await runMemberProviderChain({
      nvidiaApiKey: nvidia,
      paidCallAuthorized: false,
      instructions:
        "한국어로 쉽고 짧게 답하세요. 내부 추론은 답변에 쓰지 마세요.",
      question: "집중을 위해 잠깐 쉬는 방법을 한 문장으로 알려 주세요.",
      history: [],
      maxOutputTokens: 256,
      firstTokenTimeoutMs: 15_000,
      signal: AbortSignal.timeout(60_000),
      port: createProviderAttemptPort(admin, {
        userId,
        requestId: admission.request_id,
        perMinuteLimit: 5,
        perDayLimit: 100,
      }),
      onDelta: (text) => {
        firstTokenMs ??= Math.round(performance.now() - attemptStartedAt);
        answer += text;
      },
      registryReader: metadata,
      fetcher: async (target, options) => {
        // Log only model/status/timing. Never headers, request or response bodies.
        const model = (JSON.parse(String(options?.body)) as { model: string })
          .model;
        attemptStartedAt = performance.now();
        const response = await fetch(target, options);
        dispatchEvidence.push({ model, status: response.status });
        return response;
      },
    });
    expect(metadata).not.toHaveBeenCalled();
    expect(completed.model).toBe(NVIDIA_MODELS[0]);
    expect(completed.inputTokens).toBeGreaterThan(0);
    expect(completed.outputTokens).toBeGreaterThan(0);
    expect(completed.costMicroUsd).toBeNull();
    expect(answer).toMatch(/[가-힣]/);
    expect(answer).not.toMatch(/<think>|analysis|숨겨진 추론/i);
    const saved = await appendOwnMemberTurn(
      createSupabaseMemberConversationPort(admin),
      {
        userId,
        clientMessageId,
        question: "집중을 위해 잠깐 쉬는 방법을 한 문장으로 알려 주세요.",
        answer,
        knowledgeVersion: "2026.09",
        sourceKey: "guide:provider",
      },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error("LOCAL_TRANSCRIPT_NOT_SAVED");
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
    if (finished.error) throw new Error("LOCAL_COMPLETION_NOT_SAVED");
    const history = await readOwnAiMessages(
      member,
      userId,
      saved.conversationId,
    );
    expect(history.ok).toBe(true);
    if (history.ok) expect(history.messages).toHaveLength(2);
    const quota = await readOwnAiQuota(member, {
      userId,
      observedAtMs: Date.now(),
      windowMs: 86_400_000,
      limit: 100,
    });
    expect(quota.used).toBe(1);
    const actual = await member
      .from("ai_usage")
      .select("input_tokens, output_tokens, model_key")
      .eq("user_id", userId)
      .eq("request_id", admission.request_id)
      .single();
    if (actual.error) throw new Error("LOCAL_USAGE_NOT_READABLE");
    expect(actual.data).toEqual({
      input_tokens: completed.inputTokens,
      output_tokens: completed.outputTokens,
      model_key: completed.model,
    });
    // No secret/body in test logs. Fixture rows remain durable QA evidence.
    console.info(
      JSON.stringify({
        proof: "NVIDIA_LOCAL_DURABLE",
        userId,
        requestId: admission.request_id,
        conversationId: saved.conversationId,
        model: completed.model,
        inputTokens: completed.inputTokens,
        outputTokens: completed.outputTokens,
        firstTokenMs,
        firstTokenTimeoutMs: 15_000,
        dispatchEvidence,
        paidCalls: 0,
      }),
    );
    await member.auth.signOut();
  },
  90_000,
);
