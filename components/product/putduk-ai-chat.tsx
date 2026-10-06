"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PutdukIcon } from "@/components/icons/putduk-icon";

import { AI_QUESTION_MAX_CHARACTERS } from "@/domain/ai/chat";
import {
  getMemberAiHelp,
  getMemberAiPageTopic,
  getMemberAiSuggestions,
} from "@/domain/ai/member-help";
import {
  AI_CONVERSATION_CONTINUITY_COPY,
  AI_CONVERSATION_CONTINUITY_MODE,
} from "@/domain/ai/continuity";
import { AI_FEEDBACK_REASON_LABELS } from "@/domain/ai/member-feedback";
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
  surface?: "dock" | "page";
  /** Existing page callers remain compatible; the shared owner supplies truth. */
  knowledgeVersion?: string;
  providerConfigured?: boolean;
};

function conversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function PutdukAiChat({
  initialScreenContext,
  presentation = "page",
  surface = "dock",
}: PutdukAiChatProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const session = usePutdukAiSession();
  const composerId = useId();
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const screenContext = buildPutdukAiScreenContext({
    ...(initialScreenContext ? { explicitContext: initialScreenContext } : {}),
    pathname,
    searchParams,
  });
  const pageHelp = getMemberAiHelp(
    getMemberAiPageTopic(screenContext?.currentRoute),
  );
  const suggestions = getMemberAiSuggestions(screenContext?.currentRoute);
  const [feedbackChoice, setFeedbackChoice] = useState<
    Record<string, "choosing" | "exists" | "failed" | "saved">
  >({});
  const lastMessage = session.messages.at(-1);
  const status =
    session.ownerStatus !== "ready"
      ? "로그인 상태를 다시 확인하고 있어요."
      : session.pending
        ? "답변을 기다리고 있어요."
        : lastMessage?.role !== "assistant"
          ? ""
          : lastMessage.state === "complete"
            ? lastMessage.historical
              ? "저장된 대화를 보고 있어요."
              : "답변이 도착했어요."
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
    void session.submit(screenContext ? { screenContext } : {});
  }

  function suggestionCards() {
    return (
      <div className={styles.suggestions} role="group" aria-label="추천 질문">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.question}
            type="button"
            disabled={!session.canSubmit || session.pending}
            onClick={() => {
              session.setDraft(suggestion.question);
              questionInputRef.current?.focus();
            }}
          >
            <span>
              <strong>{suggestion.label}</strong>
              <small>{suggestion.question}</small>
            </span>
            <PutdukIcon name="arrow-right" size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <section
      className={`ai-chat ${styles.chat} ${presentation === "panel" ? styles.panel : styles.page} ${
        surface === "page" ? styles.surfacePage : ""
      }`}
      aria-label="퍼뜩 AI 대화"
      data-ai-continuity={AI_CONVERSATION_CONTINUITY_MODE}
      data-ai-presentation={presentation}
      data-ai-surface={surface}
      data-provider-configured={session.providerConfigured ? "true" : "false"}
    >
      <div className={styles.workspace}>
        <details className={styles.history}>
          <summary>이전 대화</summary>
          <div className={styles.historyBody}>
            <button
              className="button button--secondary"
              type="button"
              disabled={session.pending}
              onClick={session.startNewConversation}
            >
              새 대화
            </button>
            {session.historyStatus === "loading" ? (
              <p>이전 대화를 불러오고 있어요.</p>
            ) : null}
            {session.historyStatus === "unavailable" ? (
              <div>
                <p>이전 대화를 불러오지 못했어요.</p>
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={
                    !session.canSubmit || !session.online || session.pending
                  }
                  onClick={() => void session.reloadHistory()}
                >
                  다시 불러오기
                </button>
              </div>
            ) : null}
            {session.historyStatus === "ready" &&
            session.history.length === 0 ? (
              <p>아직 이전 대화가 없어요.</p>
            ) : null}
            <ul>
              {session.history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={
                      session.activeConversationId === item.id
                        ? "true"
                        : undefined
                    }
                    disabled={session.pending}
                    onClick={() => void session.openConversation(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <small>{conversationTime(item.updatedAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
        <div className={styles.thread}>
          {session.historyHasEarlierMessages ? (
            <p className={styles.unsaved}>
              최근 대화 일부를 표시해요. 더 오래된 내용은 여기에 표시되지
              않아요.
            </p>
          ) : null}
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
            <span className={styles.screenLabel}>{pageHelp.title}</span>
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
            {!session.online ? (
              <p className={styles.providerNotice} role="status">
                인터넷 연결이 끊겼어요. 작성한 질문은 그대로 남아 있어요.
                연결되면 직접 다시 보내 주세요.
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
                <div className={styles.welcomeHeader}>
                  <picture className={styles.welcomeMascot}>
                    <source
                      type="image/avif"
                      srcSet="/brand/mascot/putduk-ai-help-face-128-v1.avif 128w, /brand/mascot/putduk-ai-help-face-256-v1.avif 256w"
                      sizes="128px"
                    />
                    <img
                      src="/brand/mascot/putduk-ai-help-face-256-v1.webp"
                      width="256"
                      height="256"
                      alt=""
                      decoding="async"
                    />
                  </picture>
                  <div>
                    <h2>궁금한 내용을 편하게 물어보세요.</h2>
                    <p>내 기록과 퍼뜩 이용 방법을 함께 확인해요.</p>
                  </div>
                </div>
                {suggestionCards()}
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
                  {message.historical && message.role === "assistant" ? (
                    <div className={styles.answerEvidence}>
                      <span>저장된 답변 · 현재 상태는 다시 질문해 주세요.</span>
                      {message.recordedAt ? (
                        <time dateTime={message.recordedAt}>
                          저장 {conversationTime(message.recordedAt)} KST
                        </time>
                      ) : (
                        <span>저장 시각 확인할 수 없음</span>
                      )}
                      {!message.source ? (
                        <span>답변 근거 확인할 수 없음</span>
                      ) : null}
                      {message.source === "tool" ? (
                        <span>당시 조회 시각은 저장되지 않았어요.</span>
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
                  {message.saved === false ? (
                    <p className={styles.unsaved}>
                      이번 답변은 계정에 남지 않았어요.
                    </p>
                  ) : null}
                  {message.state === "complete" &&
                  message.source === "static" &&
                  message.helpTopic ? (
                    <nav className={styles.nextActions} aria-label="관련 화면">
                      {getMemberAiHelp(message.helpTopic).actions.map(
                        (action) => (
                          <Link
                            key={action.href}
                            href={action.href}
                            prefetch={false}
                          >
                            {action.label}
                            <PutdukIcon
                              name="arrow-right"
                              size={15}
                              aria-hidden="true"
                            />
                          </Link>
                        ),
                      )}
                    </nav>
                  ) : null}
                  {message.role === "assistant" &&
                  message.state === "complete" &&
                  message.assistantMessageId &&
                  message.saved !== false ? (
                    <div className={styles.feedback}>
                      {feedbackChoice[message.assistantMessageId] === "saved" ||
                      feedbackChoice[message.assistantMessageId] ===
                        "exists" ? (
                        <p role="status">의견을 남겼어요.</p>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={
                              !session.canSubmit ||
                              !session.online ||
                              session.pending
                            }
                            onClick={() => {
                              const messageId = message.assistantMessageId;
                              if (!messageId) return;
                              void session
                                .sendFeedback(messageId, "UP")
                                .then((result) =>
                                  setFeedbackChoice((current) => ({
                                    ...current,
                                    [messageId]: result,
                                  })),
                                );
                            }}
                          >
                            도움 됨
                          </button>
                          <button
                            type="button"
                            disabled={
                              !session.canSubmit ||
                              !session.online ||
                              session.pending
                            }
                            onClick={() => {
                              const messageId = message.assistantMessageId;
                              if (!messageId) return;
                              setFeedbackChoice((current) => ({
                                ...current,
                                [messageId]: "choosing",
                              }));
                            }}
                          >
                            아쉬움
                          </button>
                          {feedbackChoice[message.assistantMessageId] ===
                          "choosing" ? (
                            <div role="group" aria-label="아쉬운 이유">
                              {Object.entries(AI_FEEDBACK_REASON_LABELS).map(
                                ([reasonCode, label]) => (
                                  <button
                                    key={reasonCode}
                                    type="button"
                                    disabled={
                                      !session.canSubmit ||
                                      !session.online ||
                                      session.pending
                                    }
                                    onClick={() => {
                                      const messageId =
                                        message.assistantMessageId;
                                      if (!messageId) return;
                                      void session
                                        .sendFeedback(
                                          messageId,
                                          "DOWN",
                                          reasonCode as keyof typeof AI_FEEDBACK_REASON_LABELS,
                                        )
                                        .then((result) =>
                                          setFeedbackChoice((current) => ({
                                            ...current,
                                            [messageId]: result,
                                          })),
                                        );
                                    }}
                                  >
                                    {label}
                                  </button>
                                ),
                              )}
                            </div>
                          ) : null}
                          {feedbackChoice[message.assistantMessageId] ===
                          "failed" ? (
                            <p role="status">의견을 남기지 못했어요.</p>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          {session.messages.length > 0 ? (
            <details className={styles.followUpSuggestions}>
              <summary>이 화면 추천 질문</summary>
              {suggestionCards()}
            </details>
          ) : null}

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
                    disabled={
                      !session.canSubmit ||
                      !session.online ||
                      session.draft.trim().length < 3
                    }
                  >
                    질문 보내기
                  </button>
                )}
              </span>
            </footer>
          </form>
        </div>
      </div>
    </section>
  );
}
