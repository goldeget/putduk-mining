import {
  type AiClientStreamEvent,
  aiChatRequestSchema,
} from "@/domain/ai/chat";
import { redactMemberTranscript } from "@/domain/ai/member-transcript";
import {
  getMemberAiHelp,
  memberAiHelpFromSourceKey,
} from "@/domain/ai/member-help";
import { matchesAiPresentationOwner } from "@/domain/ai/presentation-owner";
import { readAiCache, writeAiCache } from "@/lib/ai/cache";
import {
  appendOwnMemberTurn,
  createSupabaseMemberConversationPort,
  MemberConversationWriteError,
} from "@/lib/ai/member-conversation";
import { readOwnAiMessages } from "@/lib/ai/member-conversation-read";
import { createProviderAttemptPort } from "@/lib/ai/provider-attempts";
import {
  runMemberProviderChain,
  ProviderChainError,
} from "@/lib/ai/provider-chain";
import { buildOwnedProviderHistory } from "@/lib/ai/provider-history";
import { NVIDIA_MODELS } from "@/lib/ai/provider-models";
import { planAiTurn } from "@/lib/ai/orchestrator";
import { buildAiInstructions, hashAiPrompt } from "@/lib/ai/prompt";
import { createAiProviderOutputGuard } from "@/lib/ai/response-guard";
import { executeAiTool } from "@/lib/ai/tool-executor";
import { assertAiToolBoundary } from "@/lib/ai/tools";
import {
  beginAiRequest,
  completeAiRequest,
  failAiRequest,
} from "@/lib/ai/usage";
import { apiError } from "@/lib/api/http";
import { readBoundedJsonBody } from "@/lib/api/request-body";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TRUST_CONTENT_VERSION } from "@/lib/trust/public-content";

const MAX_BODY_BYTES = 8_192;
const MAX_RESPONSE_CHARACTERS = 32_000;
const STATIC_MODEL_KEY = "putduk-static-v1";
const TOOL_MODEL_KEY = "putduk-owned-read-tool-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sseEvent(event: AiClientStreamEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function streamResponse(events: readonly AiClientStreamEvent[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(sseEvent(event)));
      }
      controller.close();
    },
  });

  return createSseResponse(stream);
}

function createSseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function hasAllowedOrigin(request: Request, appUrl: string) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(appUrl).origin);
}

export async function POST(request: Request) {
  const identity = await getVerifiedIdentity();
  if (!identity) {
    return apiError({
      code: "UNAUTHENTICATED",
      message: "로그인이 필요합니다.",
      status: 401,
    });
  }
  const userId = identity.userId;

  if (!matchesAiPresentationOwner(request.headers, userId)) {
    return apiError({
      code: "AI_SESSION_CHANGED",
      message: "로그인 상태가 바뀌었어요. 다시 확인해 주세요.",
      status: 409,
    });
  }

  let env: ReturnType<typeof getServerEnv>;
  try {
    env = getServerEnv();
  } catch {
    return apiError({
      code: "AI_SERVICE_NOT_CONFIGURED",
      message:
        "지금은 AI 답변을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.",
      status: 503,
    });
  }

  if (!hasAllowedOrigin(request, env.NEXT_PUBLIC_APP_URL)) {
    return apiError({
      code: "ORIGIN_REJECTED",
      message: "허용되지 않은 요청 출처입니다.",
      status: 403,
    });
  }

  const body = await readBoundedJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return apiError({
      code: body.code,
      message:
        body.code === "PAYLOAD_TOO_LARGE"
          ? "질문이 너무 깁니다."
          : "요청 형식이 올바르지 않습니다.",
      status: body.code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
    });
  }

  const parsed = aiChatRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return apiError({
      code: "INVALID_AI_QUESTION",
      message: "질문은 3자 이상 2,000자 이하로 입력해 주세요.",
      status: 400,
    });
  }
  const chatRequest = parsed.data;

  assertAiToolBoundary();
  const aiPlan = planAiTurn({
    question: parsed.data.question,
    ...(parsed.data.screenContext
      ? { screenContext: parsed.data.screenContext }
      : {}),
  });
  const aiContext = aiPlan.context;
  const aiRoute = aiPlan.route;
  const providerConfigured = Boolean(
    env.AI_PROVIDER === "nvidia" &&
    env.AI_API_KEY &&
    env.AI_MODEL_LOW_COST === NVIDIA_MODELS[0] &&
    env.APP_ENV !== "production",
  );
  const selectedModel =
    aiRoute.kind === "static"
      ? STATIC_MODEL_KEY
      : aiRoute.kind === "tool"
        ? TOOL_MODEL_KEY
        : NVIDIA_MODELS[0];
  const instructions = buildAiInstructions(aiContext);
  const providerQuestion = redactMemberTranscript(parsed.data.question);
  let promptHash = hashAiPrompt({
    instructions,
    model: selectedModel,
    question: providerQuestion,
    ...(aiRoute.kind === "tool" && parsed.data.screenContext
      ? { requestContext: parsed.data.screenContext }
      : {}),
  });
  const admin = createSupabaseAdminClient();
  const memberPort = createSupabaseMemberConversationPort(admin);
  if (parsed.data.conversationId) {
    try {
      const owned = await memberPort.findOwnConversation(
        userId,
        parsed.data.conversationId,
      );
      if (!owned) {
        return apiError({
          code: "AI_CONVERSATION_NOT_FOUND",
          message: "대화를 찾지 못했어요.",
          status: 404,
        });
      }
    } catch (error) {
      if (error instanceof MemberConversationWriteError) {
        return apiError({
          code: "AI_CONVERSATION_UNAVAILABLE",
          message: "대화를 확인하지 못했어요.",
          status: 503,
        });
      }
      throw error;
    }
  }
  let providerHistory: ReturnType<typeof buildOwnedProviderHistory> = [];
  if (
    chatRequest.conversationId &&
    aiRoute.kind !== "static" &&
    aiRoute.kind !== "tool"
  ) {
    const history = await readOwnAiMessages(
      identity.supabase,
      userId,
      chatRequest.conversationId,
    );
    if (!history.ok)
      return apiError({
        code: "AI_HISTORY_UNAVAILABLE",
        message: "이전 대화를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
        status: 503,
      });
    try {
      providerHistory = buildOwnedProviderHistory(history.messages);
    } catch {
      return apiError({
        code: "AI_HISTORY_UNAVAILABLE",
        message: "이전 대화를 확인하지 못했어요.",
        status: 503,
      });
    }
    promptHash = hashAiPrompt({
      instructions,
      model: selectedModel,
      question: providerQuestion,
      requestContext: providerHistory,
    });
  }
  const cachedResponse =
    aiPlan.cacheable && providerConfigured && !chatRequest.conversationId
      ? await readAiCache(
          admin,
          promptHash,
          TRUST_CONTENT_VERSION,
          "PUBLIC_KNOWLEDGE",
        )
      : null;
  const auditContextScope =
    aiRoute.kind === "tool"
      ? "ACCOUNT_STATE"
      : aiRoute.kind === "general_safe"
        ? "GENERAL_SAFE"
        : aiRoute.kind === "ui_help"
          ? "UI_HELP"
          : "PUBLIC_FACTS_ONLY";
  const auditRouteKind = cachedResponse ? "cache" : aiRoute.kind;

  const { data: admissionRows, error: admissionError } = await beginAiRequest(
    admin,
    {
      clientMessageId: parsed.data.clientMessageId,
      contextScope: auditContextScope,
      inputRedacted: {
        character_count: parsed.data.question.length,
        classification: aiRoute.classification,
        knowledge_version: TRUST_CONTENT_VERSION,
        locale: "ko-KR",
        provider_configured: providerConfigured,
        screen_context_fields: parsed.data.screenContext
          ? Object.keys(parsed.data.screenContext).sort().join(",")
          : "none",
        route_kind: cachedResponse ? "cache" : aiRoute.kind,
        route_key: aiRoute.routeKey,
      },
      knowledgeVersion: TRUST_CONTENT_VERSION,
      model: cachedResponse?.model ?? selectedModel,
      perDayLimit: env.AI_MAX_REQUESTS_PER_DAY,
      perMinuteLimit: env.AI_MAX_REQUESTS_PER_MINUTE,
      promptHash,
      routeKey: aiRoute.routeKey,
      routeKind: auditRouteKind,
      safetyClassification: aiRoute.classification,
      ...(aiRoute.kind === "tool" ? { toolName: aiRoute.tool } : {}),
      userId,
    },
  );

  if (admissionError) {
    const rateLimited = admissionError.message.includes("AI_RATE_LIMITED");
    return apiError({
      code: rateLimited ? "AI_RATE_LIMITED" : "AI_REQUEST_UNAVAILABLE",
      message: rateLimited
        ? "요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
        : "AI 요청을 시작하지 못했습니다.",
      status: rateLimited ? 429 : 503,
    });
  }

  const admission = Array.isArray(admissionRows)
    ? admissionRows[0]
    : admissionRows;
  const aiRequestId = admission?.request_id;
  if (typeof aiRequestId !== "string") {
    return apiError({
      code: "AI_REQUEST_UNAVAILABLE",
      message: "AI 요청을 시작하지 못했습니다.",
      status: 503,
    });
  }

  if (!admission.is_new) {
    return apiError({
      code: "AI_REQUEST_ALREADY_EXISTS",
      message: "이미 접수된 질문입니다. 새 질문으로 다시 시도해 주세요.",
      status: 409,
    });
  }

  async function recordFailure(
    status: "CANCELLED" | "FAILED",
    errorCode: string,
  ) {
    await failAiRequest(admin, {
      errorCode,
      requestId: aiRequestId,
      status,
      userId,
    });
  }

  async function saveMemberTurn(turn: {
    answer: string;
    sourceKey: string;
    toolCall?: {
      latencyMs: number | null;
      outcome: "FAILED" | "SUCCEEDED";
      toolName: string;
    };
  }) {
    return appendOwnMemberTurn(memberPort, {
      answer: turn.answer,
      clientMessageId: chatRequest.clientMessageId,
      knowledgeVersion: TRUST_CONTENT_VERSION,
      question: chatRequest.question,
      sourceKey: turn.sourceKey,
      userId,
      ...(chatRequest.conversationId
        ? { conversationId: chatRequest.conversationId }
        : {}),
      ...(turn.toolCall ? { toolCall: turn.toolCall } : {}),
    });
  }

  function savedFields(
    saved: Awaited<ReturnType<typeof saveMemberTurn>>,
  ): Pick<
    Extract<AiClientStreamEvent, { type: "done" }>,
    "assistantMessageId" | "conversationId" | "saved"
  > {
    if (!saved.ok) return { saved: false };
    return {
      assistantMessageId: saved.assistantMessageId,
      conversationId: saved.conversationId,
      saved: true,
    };
  }

  async function returnAuditedImmediateAnswer(
    answer: string,
    responseSource: "cache" | "static" | "tool",
    model: string,
    providerRequestId: string,
    grounding?: {
      asOf: string;
      source: "domain_tool";
      tool: string;
    },
    toolLatencyMs?: number,
  ) {
    const { error } = await completeAiRequest(admin, {
      cachedInputTokens: 0,
      inputTokens: 0,
      model,
      outputTokens: 0,
      providerRequestId,
      requestId: aiRequestId,
      responseCharacterCount: answer.length,
      userId,
    });

    if (error) {
      await recordFailure("FAILED", "AI_AUDIT_PERSISTENCE_FAILED");
      return apiError({
        code: "AI_AUDIT_PERSISTENCE_FAILED",
        message: "답변을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
        status: 503,
      });
    }

    const sourceKey = grounding
      ? `tool:${grounding.tool}`
      : responseSource === "cache"
        ? "guide:cache"
        : providerRequestId.startsWith("static:")
          ? `guide:${providerRequestId.slice("static:".length)}`
          : "guide:putduk";
    const helpTopic =
      responseSource === "static"
        ? memberAiHelpFromSourceKey(sourceKey)
        : undefined;
    const saved = await saveMemberTurn({
      answer,
      sourceKey,
      ...(grounding
        ? {
            toolCall: {
              latencyMs: toolLatencyMs ?? null,
              outcome: "SUCCEEDED" as const,
              toolName: grounding.tool,
            },
          }
        : {}),
    });

    const doneEvent: AiClientStreamEvent = {
      knowledgeVersion: TRUST_CONTENT_VERSION,
      requestId: aiRequestId,
      type: "done",
      ...(helpTopic ? { helpTopic } : {}),
      ...(grounding ? { grounding } : {}),
      ...savedFields(saved),
    };

    return streamResponse([
      { requestId: aiRequestId, source: responseSource, type: "ready" },
      { text: answer, type: "delta" },
      doneEvent,
    ]);
  }

  if (aiRoute.kind === "static") {
    return returnAuditedImmediateAnswer(
      aiRoute.answer,
      "static",
      STATIC_MODEL_KEY,
      `static:${aiRoute.routeKey}`,
    );
  }

  if (aiRoute.kind === "tool") {
    const toolStarted = Date.now();
    const toolResult = await executeAiTool(identity.supabase, aiRoute.tool, {
      ...(parsed.data.screenContext
        ? { screenContext: parsed.data.screenContext }
        : {}),
    });
    const latencyMs = Math.max(0, Date.now() - toolStarted);

    if (!toolResult.ok) {
      await recordFailure("FAILED", toolResult.code);
      const saved = await saveMemberTurn({
        answer: toolResult.answer,
        sourceKey: `tool:${toolResult.tool}`,
        toolCall: {
          latencyMs,
          outcome: "FAILED",
          toolName: toolResult.tool,
        },
      });
      const fields = savedFields(saved);
      return streamResponse([
        { requestId: aiRequestId, source: "tool", type: "ready" },
        {
          code: toolResult.code,
          message: toolResult.answer,
          type: "error",
          ...(fields.saved
            ? { saved: true as const }
            : { saved: false as const }),
          ...(fields.conversationId
            ? { conversationId: fields.conversationId }
            : {}),
        },
      ]);
    }

    return returnAuditedImmediateAnswer(
      toolResult.answer,
      "tool",
      TOOL_MODEL_KEY,
      `tool:${toolResult.tool}`,
      {
        asOf: toolResult.asOf,
        source: "domain_tool",
        tool: toolResult.tool,
      },
      latencyMs,
    );
  }

  if (cachedResponse) {
    return returnAuditedImmediateAnswer(
      cachedResponse.answer,
      "cache",
      cachedResponse.model,
      `cache:${promptHash.slice(0, 48)}`,
    );
  }

  if (!providerConfigured || !env.AI_API_KEY || !env.AI_MODEL_LOW_COST) {
    return returnAuditedImmediateAnswer(
      `이 질문에 답할 수 있는 근거를 확인하지 못했어요. 확인할 수 없는 내용은 추측하지 않아요.\n\n${getMemberAiHelp("ai").answer}`,
      "static",
      STATIC_MODEL_KEY,
      "static:member_help_ai",
    );
  }

  const providerAbort = new AbortController();
  const abortClient = () => providerAbort.abort();
  request.signal.addEventListener("abort", abortClient, { once: true });
  if (request.signal.aborted) providerAbort.abort();
  const encoder = new TextEncoder();
  let clientCancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let sent = 0;
      let emittedPrefix = "";
      const guard = createAiProviderOutputGuard();
      const emit = (event: AiClientStreamEvent) => {
        if (!clientCancelled)
          controller.enqueue(encoder.encode(sseEvent(event)));
      };
      const emitSafePrefix = (final = false) => {
        const safe = redactMemberTranscript(answer);
        if (!safe.startsWith(emittedPrefix))
          throw new ProviderChainError("AI_OUTPUT_REDACTION_CHANGED");
        // Keep a bounded trailing window so split secret labels/keys and hidden
        // reasoning markers cannot be emitted before the next network frame.
        const boundary = Math.max(0, safe.length - 256);
        // Never emit the beginning of an unfinished token (for example a long
        // email/key arriving in several frames before its identifying suffix).
        const end = final
          ? safe.length
          : Math.max(0, safe.slice(0, boundary).search(/\S+$/));
        if (end > sent) {
          emit({ type: "delta", text: safe.slice(sent, end) });
          sent = end;
          emittedPrefix = safe.slice(0, end);
        }
      };
      emit({ requestId: aiRequestId, source: "provider", type: "ready" });
      try {
        const completed = await runMemberProviderChain({
          nvidiaApiKey: env.AI_API_KEY!,
          ...(env.OPENROUTER_FREE_API_KEY
            ? { openRouterFreeApiKey: env.OPENROUTER_FREE_API_KEY }
            : {}),
          ...(env.OPENROUTER_API_KEY
            ? { openRouterPaidApiKey: env.OPENROUTER_API_KEY }
            : {}),
          // This task has no approval for paid calls. A key or .env flag cannot
          // enable them. A future authorized phase must change this boundary.
          paidCallAuthorized: false,
          instructions,
          question: providerQuestion,
          history: providerHistory,
          maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
          firstTokenTimeoutMs: env.AI_FIRST_TOKEN_TIMEOUT_MS,
          signal: providerAbort.signal,
          port: createProviderAttemptPort(admin, {
            userId,
            requestId: aiRequestId,
            perMinuteLimit: env.AI_MAX_REQUESTS_PER_MINUTE,
            perDayLimit: env.AI_MAX_REQUESTS_PER_DAY,
          }),
          onDelta(text) {
            const decision = guard.inspect(text);
            if (
              !decision.allowed ||
              answer.length + text.length > MAX_RESPONSE_CHARACTERS ||
              /<think>|<\|(?:channel|im_start)\|>\s*analysis|\[start_header_id\]analysis/i.test(
                answer.slice(-80) + text,
              )
            )
              throw new Error("AI_OUTPUT_POLICY_REJECTED");
            answer += text;
            emitSafePrefix();
          },
        });
        if (providerAbort.signal.aborted)
          throw new ProviderChainError("CLIENT_CANCELLED", true);
        const safeAnswer = redactMemberTranscript(answer);
        const saved = await saveMemberTurn({
          answer: safeAnswer,
          sourceKey: "guide:provider",
        });
        if (!saved.ok)
          throw new ProviderChainError("AI_CONVERSATION_SAVE_FAILED");
        const { error } = await completeAiRequest(admin, {
          requestId: aiRequestId,
          userId,
          model: completed.model,
          providerRequestId: completed.providerRequestId,
          inputTokens: completed.inputTokens,
          outputTokens: completed.outputTokens,
          cachedInputTokens: completed.cachedInputTokens,
          responseCharacterCount: safeAnswer.length,
        });
        if (error) throw new ProviderChainError("AI_AUDIT_PERSISTENCE_FAILED");
        if (aiPlan.cacheable && !chatRequest.conversationId)
          await writeAiCache(admin, {
            answer: safeAnswer,
            cacheKey: promptHash,
            knowledgeVersion: TRUST_CONTENT_VERSION,
            model: completed.model,
            scope: "PUBLIC_KNOWLEDGE",
            ttlSeconds: env.AI_CACHE_TTL_SECONDS,
          });
        emitSafePrefix(true);
        emit({
          type: "done",
          knowledgeVersion: TRUST_CONTENT_VERSION,
          requestId: aiRequestId,
          ...savedFields(saved),
        });
      } catch (error) {
        const cancelled =
          providerAbort.signal.aborted ||
          (error instanceof ProviderChainError && error.cancelled);
        const code =
          error instanceof ProviderChainError
            ? error.code
            : "AI_PROVIDER_UNAVAILABLE";
        await recordFailure(cancelled ? "CANCELLED" : "FAILED", code);
        const message = cancelled
          ? "답변 생성을 중단했어요."
          : code === "AI_FREE_POOL_LIMIT" ||
              code === "AI_PAID_CALL_NOT_AUTHORIZED"
            ? "현재 AI 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요."
            : "답변을 완료하지 못했어요. 다시 시도해 주세요.";
        const saved = await saveMemberTurn({
          answer: message,
          sourceKey: "failure:provider",
        });
        emit({
          type: "error",
          code,
          message,
          ...(saved.ok
            ? { saved: true, conversationId: saved.conversationId }
            : { saved: false }),
        });
      } finally {
        providerAbort.abort();
        request.signal.removeEventListener("abort", abortClient);
        try {
          controller.close();
        } catch {
          /* cancelled response */
        }
      }
    },
    cancel() {
      clientCancelled = true;
      providerAbort.abort();
    },
  });
  return createSseResponse(stream);
}
