"use client";

import { useEffect, useId, useRef, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { AI_QUESTION_MAX_CHARACTERS } from "@/domain/ai/chat";
import {
  AI_CONVERSATION_CONTINUITY_COPY,
  AI_CONVERSATION_CONTINUITY_MODE,
} from "@/domain/ai/continuity";
import { trackAnalyticsEvent } from "@/lib/analytics/client";

import styles from "./putduk-ai-chat.module.css";
import { aiGroundingTime, aiSourceLabel } from "./putduk-ai-protocol";
import {
  buildPutdukAiScreenContext,
  type PutdukAiExplicitScreenContext,
} from "./putduk-ai-screen-context";
import { usePutdukAiSession } from "./putduk-ai-session";

export type PutdukAiChatProps = {
  initialScreenContext?: PutdukAiExplicitScreenContext;
  presentation?: "page" | "panel";
  /** Existing page callers remain compatible; the shared owner supplies truth. */
  knowledgeVersion?: string;
  providerConfigured?: boolean;
};

export function PutdukAiChat({
  initialScreenContext,
  presentation = "page",
}: PutdukAiChatProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const session = usePutdukAiSession();
  const composerId = useId();
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const lastMessage = session.messages.at(-1);
  const status =
    session.ownerStatus !== "ready"
      ? "로그인 상태를 다시 확인하고 있어요."
      : session.pending
        ? "답변을 기다리고 있어요."
        : lastMessage?.role !== "assistant"
          ? ""
          : lastMessage.state === "complete"
            ? "답변이 도착했어요."
            : (lastMessage.failure?.label ?? "");

  useEffect(() => {
    void trackAnalyticsEvent("ai_open", {
      continuity_mode: AI_CONVERSATION_CONTINUITY_MODE,
      knowledge_version: session.knowledgeVersion,
      provider_configured: session.providerConfigured,
    }).catch(() => undefined);
  }, [session.knowledgeVersion, session.providerConfigured]);

  useEffect(() => {
    if (followLatest.current && transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [session.messages]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const screenContext = buildPutdukAiScreenContext({
      ...(initialScreenContext
        ? { explicitContext: initialScreenContext }
        : {}),
      pathname,
      searchParams,
    });
    void session.submit(screenContext ? { screenContext } : {});
  }

  return (
    <section
      className={`ai-chat ${styles.chat} ${presentation === "panel" ? styles.panel : styles.page}`}
      aria-label="퍼뜩 AI 대화"
      data-ai-continuity={AI_CONVERSATION_CONTINUITY_MODE}
      data-ai-presentation={presentation}
      data-provider-configured={session.providerConfigured ? "true" : "false"}
    >
      {presentation === "page" ? (
        <header className={styles.pageStatus}>
          <strong>내 기록과 퍼뜩 이용 안내</strong>
          <span>확인하지 못한 내용은 추측하지 않아요.</span>
        </header>
      ) : null}

      <div
        className={styles.notices}
        role="note"
        aria-label="대화 안내"
        tabIndex={0}
      >
        <p
          className={styles.continuityNotice}
          data-testid="ai-continuity-notice"
        >
          {AI_CONVERSATION_CONTINUITY_COPY}
        </p>
        {session.ownerStatus !== "ready" ? (
          <p className={styles.providerNotice}>
            {session.ownerStatus === "checking"
              ? "로그인 상태를 확인하고 있어요."
              : "로그인 상태를 다시 확인하고 있어요."}
          </p>
        ) : null}
        {!session.providerConfigured ? (
          <p className={styles.providerNotice}>
            내 기록과 퍼뜩 안내를 확인해요. 일반 질문은 답변이 제한돼요.
          </p>
        ) : null}
      </div>

      <div
        ref={transcriptRef}
        className={`ai-chat__messages ${styles.transcript}`}
        role="log"
        aria-live="off"
        aria-label="대화 내용"
        tabIndex={0}
        onScroll={(event) => {
          const node = event.currentTarget;
          followLatest.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 72;
        }}
      >
        {session.messages.length === 0 ? (
          <div className={`ai-chat__welcome ${styles.welcome}`}>
            <h2>궁금한 내용을 편하게 물어보세요.</h2>
            <p>내 기록과 퍼뜩 이용 방법을 함께 확인해요.</p>
          </div>
        ) : (
          session.messages.map((message) => (
            <article
              className={`ai-message ai-message--${message.role} ${styles.message}`}
              key={message.id}
              data-message-state={message.state}
              data-answer-source={message.source}
            >
              <span>{message.role === "assistant" ? "퍼뜩 AI" : "나"}</span>
              {message.text ? <p>{message.text}</p> : null}
              {message.state === "streaming" && !message.text ? (
                <p className={styles.waiting}>
                  {message.source === "tool"
                    ? "내 기록을 확인하고 있어요."
                    : "답변을 기다리고 있어요."}
                </p>
              ) : null}
              {message.source ? (
                <div className={styles.answerEvidence}>
                  <span>{aiSourceLabel(message.source)}</span>
                  {message.grounding ? (
                    <time dateTime={message.grounding.asOf}>
                      {aiGroundingTime(message.grounding)} KST 조회
                    </time>
                  ) : null}
                </div>
              ) : null}
              {message.failure ? (
                <div className={styles.failure}>
                  <strong>{message.failure.label}</strong>
                  <p>{message.failure.message}</p>
                  <button
                    className={`button button--secondary ${styles.recoveryButton}`}
                    type="button"
                    disabled={!session.canSubmit || session.pending}
                    onClick={() => {
                      if (session.restoreQuestion(message.id)) {
                        questionInputRef.current?.focus();
                      }
                    }}
                  >
                    다시 질문하기
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      <p
        className={styles.liveStatus}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status}
      </p>

      <form className={`ai-composer ${styles.composer}`} onSubmit={submit}>
        <label htmlFor={composerId}>질문 입력</label>
        <textarea
          id={composerId}
          data-testid="putduk-ai-question"
          ref={questionInputRef}
          value={session.draft}
          onChange={(event) => session.setDraft(event.target.value)}
          maxLength={AI_QUESTION_MAX_CHARACTERS}
          placeholder="어떤 내용을 확인할까요?"
          disabled={!session.canSubmit}
          required
          rows={2}
        />
        <footer>
          <p>확인과 설명을 도와요. 송금이나 잔액 변경은 할 수 없어요.</p>
          <span>
            <small>
              {session.draft.length.toLocaleString("ko-KR")} /{" "}
              {AI_QUESTION_MAX_CHARACTERS.toLocaleString("ko-KR")}
            </small>
            {session.pending ? (
              <button
                className="button button--secondary"
                type="button"
                onClick={session.cancel}
              >
                답변 중단
              </button>
            ) : (
              <button
                className="button button--primary"
                type="submit"
                disabled={!session.canSubmit || session.draft.trim().length < 3}
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
