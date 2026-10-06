import { NextResponse } from "next/server";

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
import { extractSseData, parseOpenAiSseData } from "@/lib/ai/openai-stream";
import { planAiTurn } from "@/lib/ai/orchestrator";
import { buildAiInstructions, hashAiPrompt } from "@/lib/ai/prompt";
import { buildMemberProviderRequestBody } from "@/lib/ai/provider-turn";
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
const PROVIDER_TIMEOUT_MS = 90_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const STATIC_MODEL_KEY = "putduk-static-v1";
const TOOL_MODEL_KEY = "putduk-owned-read-tool-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StreamSource = "cache" | "provider" | "static" | "tool";

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

function providerFailureCode(status: number) {
  if (status === 429) {
    return "PROVIDER_RATE_LIMITED";
  }
  if (status === 401 || status === 403) {
    return "PROVIDER_AUTH_REJECTED";
  }
  return status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REQUEST_REJECTED";
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
      message: "PUTDUK AI 서비스 구성이 아직 완료되지 않았습니다.",
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
    env.AI_PROVIDER && env.AI_API_KEY && env.AI_MODEL_LOW_COST,
  );
  const needsHighCapability =
    aiRoute.kind === "high_capability" ||
    (aiRoute.kind === "general_safe" &&
      aiRoute.modelTier === "high_capability");
  const selectedModel =
    aiRoute.kind === "static"
      ? STATIC_MODEL_KEY
      : aiRoute.kind === "tool"
        ? TOOL_MODEL_KEY
        : needsHighCapability && env.AI_MODEL_HIGH_CAPABILITY
          ? env.AI_MODEL_HIGH_CAPABILITY
          : (env.AI_MODEL_LOW_COST ?? "provider-unconfigured");
  const instructions = buildAiInstructions(aiContext);
  const providerQuestion = redactMemberTranscript(parsed.data.question);
  const promptHash = hashAiPrompt({
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
  const cachedResponse =
    aiPlan.cacheable && providerConfigured
      ? await readAiCache(
          admin,
          promptHash,
          TRUST_CONTENT_VERSION,
          "PUBLIC_KNOWLEDGE",
        )
      : null;
  const source: StreamSource =
    aiRoute.kind === "static"
      ? "static"
      : aiRoute.kind === "tool"
        ? "tool"
        : cachedResponse
          ? "cache"
          : "provider";
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
        message: "응답 기록을 검증하지 못해 완료 처리하지 않았습니다.",
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
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    providerAbort.abort();
  }, PROVIDER_TIMEOUT_MS);
  const handleRequestAbort = () => providerAbort.abort();
  request.signal.addEventListener("abort", handleRequestAbort, { once: true });

  let providerResponse: Response;
  try {
    providerResponse = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildMemberProviderRequestBody({
          instructions,
          maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
          model: selectedModel,
          question: providerQuestion,
        }),
      ),
      cache: "no-store",
      signal: providerAbort.signal,
    });
  } catch {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", handleRequestAbort);
    const cancelled = request.signal.aborted && !timedOut;
    await recordFailure(
      cancelled ? "CANCELLED" : "FAILED",
      timedOut
        ? "PROVIDER_TIMEOUT"
        : cancelled
          ? "CLIENT_CANCELLED"
          : "PROVIDER_UNREACHABLE",
    );

    if (cancelled) {
      return new NextResponse(null, { status: 499 });
    }

    return apiError({
      code: timedOut ? "AI_TIMEOUT" : "AI_PROVIDER_UNAVAILABLE",
      message: timedOut
        ? "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
        : "AI 제공자에 연결하지 못했습니다.",
      status: 503,
    });
  }

  if (!providerResponse.ok || !providerResponse.body) {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", handleRequestAbort);
    const failureCode = providerFailureCode(providerResponse.status);
    await recordFailure("FAILED", failureCode);
    return apiError({
      code: "AI_PROVIDER_UNAVAILABLE",
      message:
        providerResponse.status === 429
          ? "AI 제공자 사용량이 혼잡합니다. 잠시 후 다시 시도해 주세요."
          : "AI 응답을 시작하지 못했습니다.",
      status: providerResponse.status === 429 ? 429 : 503,
    });
  }

  const providerHeaderRequestId = providerResponse.headers.get("x-request-id");
  const encoder = new TextEncoder();
  const reader = providerResponse.body.getReader();
  let clientStreamCancelled = false;
  let terminalStateRecorded = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let responseCharacterCount = 0;
      let responseText = "";
      const decoder = new TextDecoder();
      const outputGuard = createAiProviderOutputGuard();

      const emit = (event: AiClientStreamEvent) => {
        if (!clientStreamCancelled) {
          controller.enqueue(encoder.encode(sseEvent(event)));
        }
      };

      const failStream = async (code: string, message: string) => {
        if (!terminalStateRecorded) {
          terminalStateRecorded = true;
          await recordFailure("FAILED", code);
        }
        emit({ code, message, type: "error" });
        providerAbort.abort();
      };

      emit({ requestId: aiRequestId, source, type: "ready" });

      try {
        while (!terminalStateRecorded) {
          const { done, value } = await reader.read();
          buffer += decoder
            .decode(value, { stream: !done })
            .replaceAll("\r\n", "\n");

          const blocks = buffer.split("\n\n");
          buffer = done ? "" : (blocks.pop() ?? "");

          for (const block of blocks) {
            const data = extractSseData(block);
            if (!data) {
              continue;
            }

            const event = parseOpenAiSseData(data);
            if (event.kind === "delta") {
              const outputDecision = outputGuard.inspect(event.text);
              if (!outputDecision.allowed) {
                await failStream(
                  outputDecision.code,
                  "안전 정책에 맞는 응답을 완료하지 못했습니다.",
                );
                break;
              }
              responseCharacterCount += event.text.length;
              if (responseCharacterCount > MAX_RESPONSE_CHARACTERS) {
                await failStream(
                  "AI_RESPONSE_LIMIT_EXCEEDED",
                  "응답 안전 한도를 초과해 생성을 중단했습니다.",
                );
                break;
              }
              responseText += event.text;
              emit({ text: event.text, type: "delta" });
              continue;
            }

            if (event.kind === "failed") {
              await failStream(
                event.code,
                "AI 응답을 완료하지 못했습니다. 다시 시도해 주세요.",
              );
              break;
            }

            if (event.kind === "completed") {
              const providerModel = event.model ?? selectedModel;
              const { error } = await completeAiRequest(admin, {
                cachedInputTokens: event.cachedInputTokens,
                inputTokens: event.inputTokens,
                model: providerModel,
                outputTokens: event.outputTokens,
                providerRequestId:
                  event.providerRequestId ??
                  providerHeaderRequestId ??
                  "unreported",
                requestId: aiRequestId,
                responseCharacterCount,
                userId,
              });

              if (error) {
                await failStream(
                  "AI_AUDIT_PERSISTENCE_FAILED",
                  "응답 기록을 검증하지 못해 완료 처리하지 않았습니다.",
                );
                break;
              }

              terminalStateRecorded = true;
              if (responseText && aiPlan.cacheable) {
                await writeAiCache(admin, {
                  answer: redactMemberTranscript(responseText),
                  cacheKey: promptHash,
                  knowledgeVersion: TRUST_CONTENT_VERSION,
                  model: providerModel,
                  scope: "PUBLIC_KNOWLEDGE",
                  ttlSeconds: env.AI_CACHE_TTL_SECONDS,
                });
              }
              const saved = await saveMemberTurn({
                answer: responseText,
                sourceKey: "guide:provider",
              });
              emit({
                knowledgeVersion: TRUST_CONTENT_VERSION,
                requestId: aiRequestId,
                type: "done",
                ...savedFields(saved),
              });
              break;
            }
          }

          if (done || terminalStateRecorded) {
            break;
          }
        }

        if (!terminalStateRecorded && !providerAbort.signal.aborted) {
          await failStream(
            "PROVIDER_STREAM_INCOMPLETE",
            "AI 응답이 완전히 도착하지 않았습니다. 다시 시도해 주세요.",
          );
        }
      } catch {
        if (!terminalStateRecorded) {
          const cancelled = clientStreamCancelled || request.signal.aborted;
          terminalStateRecorded = true;
          await recordFailure(
            cancelled ? "CANCELLED" : "FAILED",
            timedOut
              ? "PROVIDER_TIMEOUT"
              : cancelled
                ? "CLIENT_CANCELLED"
                : "PROVIDER_STREAM_INTERRUPTED",
          );
          emit({
            code: timedOut ? "AI_TIMEOUT" : "AI_STREAM_INTERRUPTED",
            message: timedOut
              ? "응답 시간이 초과되었습니다."
              : "응답 연결이 중단되었습니다. 다시 시도해 주세요.",
            type: "error",
          });
        }
      } finally {
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", handleRequestAbort);
        reader.releaseLock();
        try {
          controller.close();
        } catch {
          // The client may have already cancelled the response stream.
        }
      }
    },
    async cancel() {
      clientStreamCancelled = true;
      providerAbort.abort();
      if (!terminalStateRecorded) {
        terminalStateRecorded = true;
        await recordFailure("CANCELLED", "CLIENT_CANCELLED");
      }
    },
  });

  return createSseResponse(stream);
}
