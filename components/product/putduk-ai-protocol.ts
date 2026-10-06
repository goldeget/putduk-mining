import {
  aiClientStreamEventSchema,
  type AiAnswerGrounding,
  type AiAnswerSource,
  type AiClientStreamEvent,
} from "@/domain/ai/chat";
import type { MemberAiHelpTopic } from "@/domain/ai/member-help";

export type PutdukAiMessage = {
  id: string;
  role: "assistant" | "user";
  state: "cancelled" | "complete" | "error" | "streaming" | "unverified";
  text: string;
  question?: string;
  requestId?: string;
  source?: AiAnswerSource;
  grounding?: AiAnswerGrounding;
  knowledgeVersion?: string;
  saved?: boolean;
  conversationId?: string;
  assistantMessageId?: string;
  failure?: PutdukAiFailure;
  historical?: boolean;
  recordedAt?: string;
  helpTopic?: MemberAiHelpTopic;
};

export type PutdukAiFailure = {
  code: string;
  label: string;
  message: string;
};

export class PutdukAiProtocolError extends Error {
  constructor() {
    super("AI_STREAM_INVALID");
  }
}

export function aiFailure(code: string, message?: string): PutdukAiFailure {
  const copy = (() => {
    switch (code) {
      case "AI_TOOL_UNAVAILABLE":
        return [
          "상태 확인 실패",
          "내 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
        ];
      case "UNAUTHENTICATED":
        return ["로그인 필요", "다시 로그인한 뒤 질문해 주세요."];
      case "AI_SESSION_CHANGED":
        return [
          "로그인 상태 확인",
          "로그인 상태가 바뀌었어요. 다시 확인해 주세요.",
        ];
      case "AI_RATE_LIMITED":
        return ["요청 제한", "요청이 많아요. 잠시 후 다시 질문해 주세요."];
      case "AI_TIMEOUT":
        return [
          "응답 지연",
          "답변이 늦어지고 있어요. 잠시 후 다시 질문해 주세요.",
        ];
      case "AI_PROVIDER_UNAVAILABLE":
        return [
          "AI 응답 불가",
          "AI 답변을 시작하지 못했어요. 잠시 후 다시 질문해 주세요.",
        ];
      case "AI_SERVICE_NOT_CONFIGURED":
        return ["서비스 준비 필요", "지금은 AI 질문을 받을 수 없어요."];
      case "AI_REQUEST_ALREADY_EXISTS":
        return [
          "이미 접수된 질문",
          "이미 접수된 질문이에요. 다시 질문하려면 내용을 확인해 주세요.",
        ];
      case "AI_CONVERSATION_NOT_FOUND":
        return ["대화 확인", "대화를 찾지 못했어요. 새 대화로 질문해 주세요."];
      case "AI_FEEDBACK_EXISTS":
        return ["이미 남긴 의견", "이미 남긴 의견이에요."];
      case "AI_HISTORY_UNVERIFIED":
        return [
          "저장된 답변 확인",
          "답변 근거를 확인하지 못했어요. 현재 상태는 다시 질문해 주세요.",
        ];
      case "AI_REQUEST_UNAVAILABLE":
        return [
          "질문 접수 실패",
          "질문을 접수하지 못했어요. 잠시 후 다시 질문해 주세요.",
        ];
      case "ORIGIN_REJECTED":
        return [
          "요청 확인 실패",
          "요청을 확인하지 못했어요. 앱에서 다시 질문해 주세요.",
        ];
      case "INVALID_AI_QUESTION":
        return [
          "질문 확인 필요",
          "질문을 3자 이상 2,000자 이하로 입력해 주세요.",
        ];
      case "CLIENT_CANCELLED":
        return [
          "답변 중단됨",
          "답변을 중단했어요. 받은 내용은 완성된 답변이 아니에요.",
        ];
      case "AI_CONNECTION_FAILED":
        return ["연결 실패", "연결을 확인한 뒤 다시 질문해 주세요."];
      case "AI_STREAM_INTERRUPTED":
      case "PROVIDER_STREAM_INCOMPLETE":
        return [
          "답변 수신 중단",
          "답변이 끝까지 도착하지 않았어요. 다시 질문해 주세요.",
        ];
      case "AI_STREAM_INVALID":
      case "AI_AUDIT_PERSISTENCE_FAILED":
      case "AI_OUTPUT_POLICY_REJECTED":
        return [
          "답변 확인 실패",
          "답변을 확인하지 못했어요. 완료된 답변으로 볼 수 없어요.",
        ];
      default:
        return [
          "답변 실패",
          "답변을 완료하지 못했어요. 잠시 후 다시 질문해 주세요.",
        ];
    }
  })();
  return { code, label: copy[0]!, message: message?.trim() || copy[1]! };
}

export function readAiHttpFailure(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;
    if (error && typeof error === "object") {
      const code =
        "code" in error && typeof error.code === "string"
          ? error.code
          : "AI_HTTP_ERROR";
      const message =
        "message" in error && typeof error.message === "string"
          ? error.message
          : undefined;
      return aiFailure(code, message);
    }
  }
  return aiFailure(
    status === 401
      ? "UNAUTHENTICATED"
      : status === 429
        ? "AI_RATE_LIMITED"
        : "AI_HTTP_ERROR",
  );
}

/** Handles UTF-8 and SSE boundaries across network chunks, including CRLF. */
export function createAiEventDecoder() {
  const decoder = new TextDecoder();
  let buffer = "";
  function eventFromBlock(block: string): AiClientStreamEvent | null {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return null;
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      throw new PutdukAiProtocolError();
    }
    if (!value || typeof value !== "object" || !("type" in value)) return null;
    if (!["ready", "delta", "done", "error"].includes(String(value.type)))
      return null;
    const parsed = aiClientStreamEventSchema.safeParse(value);
    if (!parsed.success) throw new PutdukAiProtocolError();
    return parsed.data;
  }
  return {
    push(chunk?: Uint8Array, done = false): AiClientStreamEvent[] {
      buffer = (buffer + decoder.decode(chunk, { stream: !done })).replaceAll(
        "\r\n",
        "\n",
      );
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      if (
        buffer.length > 64_000 ||
        blocks.some((block) => block.length > 64_000)
      )
        throw new PutdukAiProtocolError();
      if (done && buffer.trim()) {
        blocks.push(buffer);
        buffer = "";
      }
      return blocks
        .map(eventFromBlock)
        .filter((event): event is AiClientStreamEvent => event !== null);
    },
  };
}

export function applyAiStreamEvent(
  message: PutdukAiMessage,
  event: AiClientStreamEvent,
): PutdukAiMessage {
  if (message.state !== "streaming") throw new PutdukAiProtocolError();
  if (event.type === "ready") {
    if (message.source) throw new PutdukAiProtocolError();
    return { ...message, source: event.source, requestId: event.requestId };
  }
  if (event.type === "error")
    return {
      ...message,
      state: "error",
      failure: aiFailure(event.code, event.message),
      ...(event.saved !== undefined ? { saved: event.saved } : {}),
      ...(event.conversationId ? { conversationId: event.conversationId } : {}),
    };
  if (!message.source) throw new PutdukAiProtocolError();
  if (event.type === "delta") {
    if (message.text.length + event.text.length > 32_000)
      throw new PutdukAiProtocolError();
    return { ...message, text: message.text + event.text };
  }
  if (
    !message.text.trim() ||
    event.requestId !== message.requestId ||
    (message.source === "tool") !== Boolean(event.grounding) ||
    (event.helpTopic !== undefined && message.source !== "static")
  )
    throw new PutdukAiProtocolError();
  return {
    ...message,
    state: "complete",
    knowledgeVersion: event.knowledgeVersion,
    ...(event.helpTopic ? { helpTopic: event.helpTopic } : {}),
    ...(event.grounding ? { grounding: event.grounding } : {}),
    ...(event.saved !== undefined ? { saved: event.saved } : {}),
    ...(event.conversationId ? { conversationId: event.conversationId } : {}),
    ...(event.assistantMessageId
      ? { assistantMessageId: event.assistantMessageId }
      : {}),
  };
}

export function aiSourceLabel(source: AiAnswerSource) {
  return {
    cache: "이전 답변",
    provider: "AI 도움말",
    static: "퍼뜩 안내",
    tool: "내 기록 조회",
  }[source];
}

export function aiGroundingTime(grounding: AiAnswerGrounding) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(grounding.asOf));
}
