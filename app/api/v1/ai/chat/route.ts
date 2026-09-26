import { NextResponse } from "next/server";

import {
  type AiClientStreamEvent,
  aiChatRequestSchema,
} from "@/domain/ai/chat";
import { readAiCache, writeAiCache } from "@/lib/ai/cache";
import { createPublicAiContext } from "@/lib/ai/context";
import { extractSseData, parseOpenAiSseData } from "@/lib/ai/openai-stream";
import { buildAiInstructions, hashAiPrompt } from "@/lib/ai/prompt";
import { routeAiQuestion } from "@/lib/ai/router";
import { assertAiToolBoundary } from "@/lib/ai/tools";
import {
  beginAiRequest,
  completeAiRequest,
  failAiRequest,
} from "@/lib/ai/usage";
import { apiError } from "@/lib/api/http";
import { getVerifiedIdentity } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/env/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { TRUST_CONTENT_VERSION } from "@/lib/trust/public-content";

const MAX_BODY_BYTES = 8_192;
const MAX_RESPONSE_CHARACTERS = 32_000;
const PROVIDER_TIMEOUT_MS = 90_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const STATIC_MODEL_KEY = "putduk-static-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StreamSource = "cache" | "provider" | "static";

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

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return apiError({
      code: "PAYLOAD_TOO_LARGE",
      message: "질문이 너무 깁니다.",
      status: 413,
    });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return apiError({
      code: "PAYLOAD_TOO_LARGE",
      message: "질문이 너무 깁니다.",
      status: 413,
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return apiError({
      code: "INVALID_JSON",
      message: "요청 형식이 올바르지 않습니다.",
      status: 400,
    });
  }

  const parsed = aiChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "INVALID_AI_QUESTION",
      message: "질문은 3자 이상 2,000자 이하로 입력해 주세요.",
      status: 400,
    });
  }

  assertAiToolBoundary();
  const aiContext = createPublicAiContext();
  const aiRoute = routeAiQuestion(parsed.data.question);
  const providerConfigured = Boolean(
    env.AI_PROVIDER && env.AI_API_KEY && env.AI_MODEL_LOW_COST,
  );
  const selectedModel =
    aiRoute.kind === "static"
      ? STATIC_MODEL_KEY
      : aiRoute.kind === "high_capability" && env.AI_MODEL_HIGH_CAPABILITY
        ? env.AI_MODEL_HIGH_CAPABILITY
        : (env.AI_MODEL_LOW_COST ?? "provider-unconfigured");
  const instructions = buildAiInstructions(aiContext);
  const promptHash = hashAiPrompt({
    instructions,
    model: selectedModel,
    question: parsed.data.question,
  });
  const admin = createSupabaseAdminClient();
  const cachedResponse =
    aiRoute.kind !== "static" && providerConfigured
      ? await readAiCache(admin, promptHash, TRUST_CONTENT_VERSION)
      : null;
  const source: StreamSource =
    aiRoute.kind === "static"
      ? "static"
      : cachedResponse
        ? "cache"
        : "provider";

  const { data: admissionRows, error: admissionError } = await beginAiRequest(
    admin,
    {
      clientMessageId: parsed.data.clientMessageId,
      inputRedacted: {
        character_count: parsed.data.question.length,
        classification: aiRoute.classification,
        knowledge_version: TRUST_CONTENT_VERSION,
        locale: "ko-KR",
        provider_configured: providerConfigured,
        route_kind: cachedResponse ? "cache" : aiRoute.kind,
        route_key: aiRoute.routeKey,
      },
      knowledgeVersion: TRUST_CONTENT_VERSION,
      model: cachedResponse?.model ?? selectedModel,
      perDayLimit: env.AI_MAX_REQUESTS_PER_DAY,
      perMinuteLimit: env.AI_MAX_REQUESTS_PER_MINUTE,
      promptHash,
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

  async function returnAuditedImmediateAnswer(
    answer: string,
    responseSource: "cache" | "static",
    model: string,
    providerRequestId: string,
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

    return streamResponse([
      { requestId: aiRequestId, source: responseSource, type: "ready" },
      { text: answer, type: "delta" },
      {
        knowledgeVersion: TRUST_CONTENT_VERSION,
        requestId: aiRequestId,
        type: "done",
      },
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
      "이 질문은 현재 공개 사실만으로 결정적으로 답하기 어렵습니다. 운영 승인된 AI 제공자가 구성되기 전에는 추측하지 않으며, 공식 안내 페이지에서 확인 가능한 범위만 답변합니다.",
      "static",
      STATIC_MODEL_KEY,
      "static:provider-unconfigured",
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
      body: JSON.stringify({
        input: [
          {
            content: [
              {
                text: parsed.data.question,
                type: "input_text",
              },
            ],
            role: "user",
          },
        ],
        instructions,
        max_output_tokens: env.AI_MAX_OUTPUT_TOKENS,
        model: selectedModel,
        store: false,
        stream: true,
      }),
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
              if (responseText) {
                await writeAiCache(admin, {
                  answer: responseText,
                  cacheKey: promptHash,
                  knowledgeVersion: TRUST_CONTENT_VERSION,
                  model: providerModel,
                  ttlSeconds: env.AI_CACHE_TTL_SECONDS,
                });
              }
              emit({
                knowledgeVersion: TRUST_CONTENT_VERSION,
                requestId: aiRequestId,
                type: "done",
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
