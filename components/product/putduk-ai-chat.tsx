"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { AI_QUESTION_MAX_CHARACTERS } from "@/domain/ai/chat";
import {
  AI_CONVERSATION_CONTINUITY_COPY,
  AI_CONVERSATION_CONTINUITY_MODE,
} from "@/domain/ai/continuity";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

import styles from "./putduk-ai-chat.module.css";
import {
  buildPutdukAiScreenContext,
  type PutdukAiExplicitScreenContext,
} from "./putduk-ai-screen-context";

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
  initialScreenContext,
  knowledgeVersion,
  providerConfigured,
}: {
  initialScreenContext?: PutdukAiExplicitScreenContext;
  knowledgeVersion: string;
  providerConfigured: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [question, setQuestion] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    void trackAnalyticsEvent("ai_open", {
      continuity_mode: AI_CONVERSATION_CONTINUITY_MODE,
      knowledge_version: knowledgeVersion,
      provider_configured: providerConfigured,
    }).catch(() => undefined);

    return () => abortRef.current?.abort();
  }, [knowledgeVersion, providerConfigured]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  function updateMessage(id: string, update: (message: Message) => Message) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? update(message) : message)),
    );
  }

  function focusComposer() {
    questionInputRef.current?.focus();
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
    const screenContext = buildPutdukAiScreenContext({
      ...(initialScreenContext
        ? { explicitContext: initialScreenContext }
        : {}),
      pathname,
      searchParams,
    });

    try {
      const response = await fetch("/api/v1/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientMessageId,
          question: trimmedQuestion,
          ...(screenContext ? { screenContext } : {}),
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response
          .json()
          .catch(() => null)) as ApiErrorPayload | null;
        throw new Error(payload?.error?.message ?? "답변을 시작하지 못했어요.");
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
                  : "답변을 완료하지 못했어요.",
            }));
          }
        }

        if (done) {
          break;
        }
      }

      if (!terminalEventReceived) {
        throw new Error("연결이 예기치 않게 종료됐어요. 다시 시도해 주세요.");
      }
    } catch (error) {
      const cancelled = abortController.signal.aborted;
      updateMessage(assistantMessageId, (message) => ({
        ...message,
        state: cancelled ? "cancelled" : "error",
        text: cancelled
          ? message.text || "답변 생성을 중단했어요."
          : error instanceof Error
            ? error.message
            : "답변을 완료하지 못했어요.",
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
    <section
      className="ai-chat"
      aria-label="PUTDUK AI 질문"
      data-ai-continuity={AI_CONVERSATION_CONTINUITY_MODE}
      data-provider-configured={providerConfigured ? "true" : "false"}
    >
      <header className="ai-chat__status">
        <span className="ai-chat__indicator is-ready" aria-hidden="true" />
        <span>
          <strong>
            {providerConfigured ? "계정·일반 질문 도움말" : "계정·퍼뜩 도움말"}
          </strong>
          <small>확인된 정보만 사용하고, 찾지 못하면 추측하지 않아요</small>
        </span>
      </header>

      <p className={styles.continuityNotice} data-testid="ai-continuity-notice">
        {AI_CONVERSATION_CONTINUITY_COPY}
      </p>

      <div className="ai-chat__messages" role="log" aria-live="polite">
        {messages.length === 0 ? (
          <div className="ai-chat__welcome">
            <p className="eyebrow">ASK PUTDUK</p>
            <h2>궁금한 내용을 편하게 물어보세요.</h2>
            <p>
              오늘 채굴 상태, 입출금 진행 상황, 이벤트 참여 조건이나 퍼뜩 이용
              방법을 질문할 수 있어요. 확인할 수 없는 수치는 만들어 답하지
              않습니다.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={`ai-message ai-message--${message.role}`}
              key={message.id}
              data-message-state={message.state}
            >
              <span>{message.role === "assistant" ? "PUTDUK AI" : "나"}</span>
              {message.role === "assistant" &&
              message.state === "streaming" &&
              !message.text ? (
                reducedMotion ? (
                  <p className={styles.thinkingStatic}>확인 중</p>
                ) : (
                  <div
                    className="ai-message__thinking"
                    aria-label="확인 가능한 정보를 찾는 중"
                  >
                    <i />
                    <i />
                    <i />
                  </div>
                )
              ) : (
                <p>{message.text}</p>
              )}
              {message.role === "assistant" &&
              ["cancelled", "error"].includes(message.state) ? (
                <>
                  <small>
                    {message.state === "cancelled" ? "답변 중단됨" : "연결 실패"}
                  </small>
                  {message.state === "error" ? (
                    <button
                      className={`button button--secondary ${styles.recoveryButton}`}
                      type="button"
                      onClick={focusComposer}
                    >
                      다시 질문하기
                    </button>
                  ) : null}
                </>
              ) : null}
            </article>
          ))
        )}
      </div>

      <form className="ai-composer" onSubmit={submit}>
        <label htmlFor="putduk-ai-question">질문 입력</label>
        <textarea
          id="putduk-ai-question"
          ref={questionInputRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={AI_QUESTION_MAX_CHARACTERS}
          placeholder="예: 체험 보상 5,000원은 언제 출금할 수 있어?"
          disabled={pending}
          required
        />
        <footer>
          <p>
            PUTDUK AI는 확인과 설명을 돕지만 송금·승인·보상 지급이나 잔액 변경을
            대신하지 않습니다.
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
                답변 중단
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
