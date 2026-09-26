"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { AI_QUESTION_MAX_CHARACTERS } from "@/domain/ai/chat";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

type MessageState = "cancelled" | "complete" | "error" | "streaming";

type Message = {
  id: string;
  role: "assistant" | "user";
  state: MessageState;
  text: string;
};

type ApiErrorPayload = {
  error?: { code?: string; message?: string };
};

function getDataFromSseBlock(block: string) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");

  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function PutdukAiChat({
  knowledgeVersion,
  providerConfigured,
}: {
  knowledgeVersion: string;
  providerConfigured: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [question, setQuestion] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void trackAnalyticsEvent("ai_open", {
      knowledge_version: knowledgeVersion,
      provider_configured: providerConfigured,
    }).catch(() => undefined);

    return () => abortRef.current?.abort();
  }, [knowledgeVersion, providerConfigured]);

  function updateMessage(id: string, update: (message: Message) => Message) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? update(message) : message)),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (pending || trimmedQuestion.length < 3) {
      return;
    }

    const clientMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setPending(true);
    setQuestion("");
    setMessages((current) => [
      ...current,
      {
        id: clientMessageId,
        role: "user",
        state: "complete",
        text: trimmedQuestion,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        state: "streaming",
        text: "",
      },
    ]);

    void trackAnalyticsEvent("ai_question", {
      character_count: trimmedQuestion.length,
      knowledge_version: knowledgeVersion,
    }).catch(() => undefined);

    let terminalEventReceived = false;

    try {
      const response = await fetch("/api/v1/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientMessageId,
          question: trimmedQuestion,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response
          .json()
          .catch(() => null)) as ApiErrorPayload | null;
        throw new Error(
          payload?.error?.message ?? "AI 응답을 시작하지 못했습니다.",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder
          .decode(value, { stream: !done })
          .replaceAll("\r\n", "\n");
        const blocks = buffer.split("\n\n");
        buffer = done ? "" : (blocks.pop() ?? "");

        for (const block of blocks) {
          const data = getDataFromSseBlock(block);
          if (!data || typeof data.type !== "string") {
            continue;
          }

          if (data.type === "delta" && typeof data.text === "string") {
            updateMessage(assistantMessageId, (message) => ({
              ...message,
              text: message.text + data.text,
            }));
          }

          if (data.type === "done") {
            terminalEventReceived = true;
            updateMessage(assistantMessageId, (message) => ({
              ...message,
              state: "complete",
            }));
          }

          if (data.type === "error") {
            terminalEventReceived = true;
            updateMessage(assistantMessageId, (message) => ({
              ...message,
              state: "error",
              text:
                typeof data.message === "string"
                  ? data.message
                  : "AI 응답을 완료하지 못했습니다.",
            }));
          }
        }

        if (done) {
          break;
        }
      }

      if (!terminalEventReceived) {
        throw new Error("응답 연결이 완전히 종료되지 않았습니다.");
      }
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      updateMessage(assistantMessageId, (message) => ({
        ...message,
        state: cancelled ? "cancelled" : "error",
        text: cancelled
          ? message.text || "응답 생성을 중단했습니다."
          : error instanceof Error
            ? error.message
            : "AI 응답을 완료하지 못했습니다.",
      }));
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
      setPending(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  return (
    <section className="ai-chat" aria-label="PUTDUK AI 질문">
      <header className="ai-chat__status">
        <span className="ai-chat__indicator is-ready" aria-hidden="true" />
        <span>
          <strong>
            {providerConfigured ? "라우팅 활성" : "공식 사실 모드"}
          </strong>
          <small>STATIC → CACHE → MODEL · {knowledgeVersion}</small>
        </span>
      </header>

      <div className="ai-chat__messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="ai-chat__welcome">
            <p className="eyebrow">ASK WITH EVIDENCE</p>
            <h2>공식 정보 안에서, 근거 있는 답을 드립니다.</h2>
            <p>
              체험 방식, 채굴 원칙, 입출금 경계처럼 공개된 PUTDUK 정보를 질문해
              보세요. 확인되지 않은 수치나 운영 상태는 추측하지 않습니다.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`ai-message ai-message--${message.role}`}
              key={message.id}
            >
              <span>{message.role === "assistant" ? "PUTDUK AI" : "YOU"}</span>
              {message.role === "assistant" &&
              message.state === "streaming" &&
              !message.text ? (
                <div className="ai-message__thinking" aria-label="응답 연결 중">
                  <i />
                  <i />
                  <i />
                </div>
              ) : (
                <p>{message.text}</p>
              )}
              {message.role === "assistant" &&
              ["cancelled", "error"].includes(message.state) ? (
                <small>
                  {message.state === "cancelled"
                    ? "CANCELLED"
                    : "NOT COMPLETED"}
                </small>
              ) : null}
            </article>
          ))
        )}
      </div>

      <form className="ai-composer" onSubmit={submit}>
        <label htmlFor="putduk-ai-question">공식 제품 정보 질문</label>
        <textarea
          id="putduk-ai-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={AI_QUESTION_MAX_CHARACTERS}
          placeholder="예: PUTDUK START 결과가 실제 잔액으로 전환되나요?"
          disabled={pending}
          required
        />
        <footer>
          <p>
            원문은 PUTDUK DB에 저장하지 않습니다. 모델이 필요한 경우에만 응답
            객체 저장 기능을 끈 제공자 요청을 사용합니다.
          </p>
          <span>
            <small>
              {question.length.toLocaleString("ko-KR")} /{" "}
              {AI_QUESTION_MAX_CHARACTERS.toLocaleString("ko-KR")}
            </small>
            {pending ? (
              <button
                className="button button--secondary"
                type="button"
                onClick={cancel}
              >
                생성 중단
              </button>
            ) : (
              <button
                className="button button--primary"
                type="submit"
                disabled={question.trim().length < 3}
              >
                질문 보내기
              </button>
            )}
          </span>
        </footer>
      </form>
    </section>
  );
}
