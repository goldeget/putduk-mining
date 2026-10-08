"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
import { PutdukAiMascot } from "./putduk-ai-mascot";
import { PutdukAiMessageBody } from "./putduk-ai-message-body";
import { PutdukAiProviderUsage } from "./putduk-ai-usage";
import { aiGroundingTime, aiSourceLabel } from "./putduk-ai-protocol";
import {
  buildPutdukAiScreenContext,
  type PutdukAiExplicitScreenContext,
} from "./putduk-ai-screen-context";
import { usePutdukAiSession } from "./putduk-ai-session";

export type PutdukAiPageFacts = {
  ownerUserId: string;
  displayName: string;
  rankName: string | null;
  availableKrwLabel: string;
};

export type PutdukAiChatProps = {
  pageFacts?: PutdukAiPageFacts;
  pageTools?: ReactNode;
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

type UsageWindow = {
  used: number;
  limit: number;
  nextAvailableAt: string | null;
};
type OwnUsage = {
  ownerId: string;
  observedAt: string;
  providerAttempts?: unknown;
  rolling24h: UsageWindow;
  rollingMinute: UsageWindow;
};

function readOwnUsage(value: unknown, ownerId: string): OwnUsage | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<OwnUsage>;
  if (
    data.ownerId !== ownerId ||
    typeof data.observedAt !== "string" ||
    !Number.isFinite(Date.parse(data.observedAt))
  )
    return null;
  for (const window of [data.rolling24h, data.rollingMinute]) {
    if (
      !window ||
      !Number.isSafeInteger(window.used) ||
      window.used < 0 ||
      !Number.isSafeInteger(window.limit) ||
      window.limit < 1 ||
      (window.nextAvailableAt !== null &&
        (typeof window.nextAvailableAt !== "string" ||
          !Number.isFinite(Date.parse(window.nextAvailableAt))))
    )
      return null;
  }
  return data as OwnUsage;
}

export function PutdukAiChat({
  initialScreenContext,
  pageFacts,
  pageTools,
  presentation = "page",
  surface = "dock",
}: PutdukAiChatProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const session = usePutdukAiSession();
  const chatRef = useRef<HTMLElement | null>(null);
  const [copyStatus, setCopyStatus] = useState<Record<string, string>>({});
  const composerId = useId();
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const [readingEarlier, setReadingEarlier] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageRead, setUsageRead] = useState<{
    ownerId: string;
    value: OwnUsage | null;
  } | null>(null);
  const screenContext = buildPutdukAiScreenContext({
    ...(initialScreenContext ? { explicitContext: initialScreenContext } : {}),
    pathname,
    searchParams,
  });
  const pageHelp = getMemberAiHelp(
    getMemberAiPageTopic(screenContext?.currentRoute),
  );
  const contextualSuggestions = getMemberAiSuggestions(
    screenContext?.currentRoute,
  );
  const suggestions =
    surface === "page" &&
    (!screenContext?.currentRoute ||
      ["/ai", "/menu/ai"].includes(screenContext.currentRoute))
      ? [
          { label: "내 채굴 상태", question: "내 채굴 상태 알려줘" },
          { label: "출금 준비", question: "첫 출금은 어떻게 준비하나요?" },
          { label: "이벤트 안내", question: "이벤트 참여 방법 알려줘" },
          session.providerConfigured
            ? {
                label: "자유롭게 질문",
                question: "일상에서 스트레스를 줄이는 방법을 알려 주세요.",
              }
            : { label: "고객지원", question: "고객지원은 어디에 있나요?" },
        ]
      : [
          ...contextualSuggestions,
          ...(session.providerConfigured
            ? [
                {
                  label: "자유롭게 질문",
                  question: "일상에서 스트레스를 줄이는 방법을 알려 주세요.",
                },
              ]
            : []),
        ];
  const [feedbackChoice, setFeedbackChoice] = useState<
    Record<string, "choosing" | "exists" | "failed" | "saved">
  >({});
  const lastMessage = session.messages.at(-1);
  const visibleUsage =
    session.ownerStatus === "ready" &&
    usageRead?.ownerId === session.ownerUserId
      ? usageRead
      : null;

  useEffect(() => {
    if (
      !usageOpen ||
      session.ownerStatus !== "ready" ||
      !session.online ||
      session.pending
    )
      return;
    const ownerId = session.ownerUserId;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    let current = true;
    void fetch("/api/v1/ai/usage", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        const value = response.ok
          ? readOwnUsage(await response.json(), ownerId)
          : null;
        if (current) setUsageRead({ ownerId, value });
      })
      .catch(() => {
        if (current) setUsageRead({ ownerId, value: null });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      current = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    usageOpen,
    session.ownerStatus,
    session.ownerUserId,
    session.online,
    session.pending,
    lastMessage?.id,
    lastMessage?.state,
  ]);
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
      transcriptRef.current.scrollTop =
        session.messages.length === 0 ? 0 : transcriptRef.current.scrollHeight;
    }
  }, [session.messages]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current && session.messages.length > 0)
        node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    // Fonts, formatted paragraphs and the on-screen keyboard can resize an
    // existing answer without producing another stream delta.
    for (const child of node.children) observer.observe(child);
    return () => observer.disconnect();
  }, [session.messages.length]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    followLatest.current = true;
    setReadingEarlier(false);
    void session.submit(screenContext ? { screenContext } : {});
  }

  function showLatest() {
    followLatest.current = true;
    setReadingEarlier(false);
    const node = transcriptRef.current;
    if (node) node.scrollTop = node.scrollHeight;
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

  useEffect(() => {
    function resize() {
      const node = chatRef.current;
      if (!node) return;
      const viewport = window.visualViewport;
      node.dataset.aiCompact = String(
        (viewport?.height ?? window.innerHeight) < 560,
      );
      if (presentation !== "page") return;
      const bottom =
        (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0);
      node.style.setProperty(
        "--ai-page-height",
        `${Math.max(160, bottom - node.getBoundingClientRect().top - 12)}px`,
      );
    }
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
    };
  }, [presentation]);

  return (
    <section
      ref={chatRef}
      className={`ai-chat ${styles.chat} ${presentation === "panel" ? styles.panel : styles.page} ${
        surface === "page" ? styles.surfacePage : ""
      }`}
      aria-label="퍼뜩 AI 도우미 대화"
      data-ai-continuity={AI_CONVERSATION_CONTINUITY_MODE}
      data-ai-presentation={presentation}
      data-ai-surface={surface}
      data-provider-configured={session.providerConfigured ? "true" : "false"}
    >
      {surface === "page" ? (
        <header className={styles.pageHeader}>
          <div className={styles.identity}>
            <PutdukAiMascot />
            <div>
              <h1>퍼뜩 AI 도우미</h1>
              <p>텍스트 대화</p>
            </div>
          </div>
          <div className={styles.pageTools}>{pageTools}</div>
        </header>
      ) : null}
      <div className={styles.workspace}>
        <aside
          className={styles.contextRail}
          aria-label="화면 도움과 이전 대화"
        >
          <button
            className={styles.newConversation}
            type="button"
            disabled={session.pending || !session.canSubmit}
            onClick={() => {
              followLatest.current = true;
              setReadingEarlier(false);
              session.startNewConversation();
              questionInputRef.current?.focus();
            }}
          >
            <span aria-hidden="true">＋</span> 새 대화
          </button>
          <details className={styles.history}>
            <summary>이전 대화</summary>
            <div className={styles.historyBody}>
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
                      onClick={(event) => {
                        followLatest.current = true;
                        setReadingEarlier(false);
                        void session.openConversation(item.id);
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      <strong>{item.title}</strong>
                      <small>{conversationTime(item.updatedAt)}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
          <details
            className={styles.contextGuide}
            aria-label="현재 화면 도움"
            onToggle={(event) => setUsageOpen(event.currentTarget.open)}
          >
            <summary>이용 안내</summary>
            <div>
              <strong>{pageHelp.title}</strong>
              <p>{pageHelp.answer.split("\n\n")[0]}</p>
              <section className={styles.usage} aria-label="AI 이용 횟수">
                <strong>AI 이용 횟수</strong>
                {visibleUsage?.value ? (
                  <>
                    <p>
                      최근 24시간 질문{" "}
                      {visibleUsage.value.rolling24h.used.toLocaleString(
                        "ko-KR",
                      )}{" "}
                      /{" "}
                      {visibleUsage.value.rolling24h.limit.toLocaleString(
                        "ko-KR",
                      )}
                      회
                    </p>
                    <p>
                      최근 1분 질문{" "}
                      {visibleUsage.value.rollingMinute.used.toLocaleString(
                        "ko-KR",
                      )}{" "}
                      /{" "}
                      {visibleUsage.value.rollingMinute.limit.toLocaleString(
                        "ko-KR",
                      )}
                      회
                    </p>
                    {visibleUsage.value.rolling24h.used >=
                      visibleUsage.value.rolling24h.limit ||
                    visibleUsage.value.rollingMinute.used >=
                      visibleUsage.value.rollingMinute.limit ? (
                      <p role="status" aria-live="polite" aria-atomic="true">
                        지금은 이용 한도에 도달했어요. 잠시 후 다시 질문해
                        주세요.
                      </p>
                    ) : null}
                    <small>
                      확인 시각:{" "}
                      {conversationTime(visibleUsage.value.observedAt)} KST
                    </small>
                  </>
                ) : (
                  <p role="status" aria-live="polite" aria-atomic="true">
                    {session.ownerStatus !== "ready"
                      ? "로그인 상태를 확인한 뒤 이용 횟수를 볼 수 있어요."
                      : !session.online || visibleUsage
                        ? "이용 횟수를 확인할 수 없어요."
                        : session.pending
                          ? "답변이 끝나면 이용 횟수를 확인해요."
                          : "이용 횟수를 확인하고 있어요."}
                  </p>
                )}
                {visibleUsage?.value ? (
                  <PutdukAiProviderUsage
                    value={visibleUsage.value.providerAttempts}
                  />
                ) : null}
                <small>
                  자정을 기준으로 초기화되지 않아요. 최근 이용 시간을 기준으로
                  계산해요.
                </small>
              </section>
              <nav className={styles.contextActions} aria-label="이 화면 안내">
                {pageHelp.actions.map((action) => (
                  <Link key={action.href} href={action.href} prefetch={false}>
                    {action.label}
                    <PutdukIcon
                      name="arrow-right"
                      size={15}
                      aria-hidden="true"
                    />
                  </Link>
                ))}
              </nav>
            </div>
          </details>
          {surface === "page" &&
          pageFacts &&
          session.ownerStatus === "ready" &&
          session.ownerUserId === pageFacts.ownerUserId ? (
            <details className={styles.accountDetails} data-ai-account-facts>
              <summary>내 기록</summary>
              <div>
                <strong>{pageFacts.displayName}님</strong>
                <p>현재 등급: {pageFacts.rankName ?? "확인할 수 없음"}</p>
                <p>지갑 사용 가능 금액: {pageFacts.availableKrwLabel}</p>
                <Link href="/wallet" prefetch={false}>
                  내 지갑 보기 →
                </Link>
              </div>
            </details>
          ) : null}
          {surface === "page" &&
          pageFacts &&
          (session.ownerStatus !== "ready" ||
            session.ownerUserId !== pageFacts.ownerUserId) ? (
            <span data-ai-account-facts>
              <span className={styles.liveStatus} role="status">
                로그인 상태를 다시 확인하고 있어요.
              </span>
            </span>
          ) : null}
        </aside>
        <div className={styles.thread}>
          {session.historyHasEarlierMessages ? (
            <p className={styles.unsaved}>
              최근 대화 일부를 표시해요. 더 오래된 내용은 여기에 표시되지
              않아요.
            </p>
          ) : null}
          {presentation === "page" && surface !== "page" ? (
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
            {surface !== "page" ? (
              <span className={styles.screenLabel}>{pageHelp.title}</span>
            ) : null}
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
                {surface === "page"
                  ? "내 기록과 이용 안내만 답변해요."
                  : "내 기록과 퍼뜩 안내를 확인해요. 일반 질문은 답변이 제한돼요."}
              </p>
            ) : null}
            {!session.online ? (
              <p className={styles.providerNotice} role="status">
                인터넷 연결이 끊겼어요. 작성한 질문은 그대로 남아 있어요.
                연결되면 직접 다시 보내 주세요.
              </p>
            ) : null}
          </div>

          <div className={styles.transcriptFrame}>
            <div
              ref={transcriptRef}
              id={`${composerId}-transcript`}
              className={`ai-chat__messages ${styles.transcript}`}
              role="log"
              aria-live="off"
              aria-label="대화 내용"
              tabIndex={0}
              onScroll={(event) => {
                const node = event.currentTarget;
                followLatest.current =
                  node.scrollHeight - node.scrollTop - node.clientHeight < 72;
                setReadingEarlier(!followLatest.current);
              }}
            >
              {session.messages.length === 0 ? (
                <div className={`ai-chat__welcome ${styles.welcome}`}>
                  <picture className={styles.welcomeMascot}>
                    <source
                      type="image/avif"
                      srcSet="/brand/mascot/putduk-ai-help-face-128-v1.avif 128w, /brand/mascot/putduk-ai-help-face-256-v1.avif 256w"
                      sizes="96px"
                    />
                    <img
                      src="/brand/mascot/putduk-ai-help-face-256-v1.webp"
                      width="256"
                      height="256"
                      alt=""
                      decoding="async"
                    />
                  </picture>
                  <span className={styles.welcomeEyebrow}>PUTDUK AI</span>
                  <h2>무엇이 궁금하세요?</h2>
                  <p>
                    {session.providerConfigured
                      ? "퍼뜩 이용 안내부터 일상의 궁금한 것까지."
                      : "내 기록과 퍼뜩 이용 방법을 함께 확인해요."}
                  </p>
                  {suggestionCards()}
                  <p className={styles.welcomeHint}>
                    궁금한 내용을 편하게 적어 주세요.
                  </p>
                </div>
              ) : (
                session.messages.map((message) => (
                  <article
                    className={`ai-message ai-message--${message.role} ${styles.message}`}
                    key={message.id}
                    data-message-state={message.state}
                    data-answer-source={message.source}
                  >
                    <span className={styles.messageIdentity}>
                      {message.role === "assistant" ? (
                        <>
                          <PutdukAiMascot /> 퍼뜩 AI 도우미
                        </>
                      ) : (
                        "나"
                      )}
                    </span>
                    {message.text ? (
                      <PutdukAiMessageBody
                        text={message.text}
                        formatted={message.role === "assistant"}
                      />
                    ) : null}
                    {message.role === "assistant" &&
                    message.state === "complete" &&
                    message.text ? (
                      <div className={styles.copyAction}>
                        <button
                          type="button"
                          aria-label="답변 복사"
                          onClick={async () => {
                            try {
                              if (!navigator.clipboard)
                                throw new Error("CLIPBOARD_UNAVAILABLE");
                              await navigator.clipboard.writeText(message.text);
                              setCopyStatus((current) => ({
                                ...current,
                                [message.id]: "복사했어요.",
                              }));
                            } catch {
                              setCopyStatus((current) => ({
                                ...current,
                                [message.id]: "복사하지 못했어요.",
                              }));
                            }
                          }}
                        >
                          복사
                        </button>
                        <span role="status">{copyStatus[message.id]}</span>
                      </div>
                    ) : null}
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
                        <span>
                          저장된 답변 · 현재 상태는 다시 질문해 주세요.
                        </span>
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
                      <nav
                        className={styles.nextActions}
                        aria-label="관련 화면"
                      >
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
                        {feedbackChoice[message.assistantMessageId] ===
                          "saved" ||
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

            {readingEarlier && session.messages.length > 0 ? (
              <button
                className={styles.latestButton}
                type="button"
                onClick={showLatest}
                aria-controls={`${composerId}-transcript`}
              >
                최신 답변 보기 <span aria-hidden="true">↓</span>
              </button>
            ) : null}
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
              placeholder="궁금한 내용을 적어 주세요."
              disabled={!session.canSubmit}
              required
              rows={2}
            />
            <footer>
              <p>비밀번호나 인증번호는 입력하지 마세요.</p>
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
                    className={styles.sendButton}
                    type="submit"
                    aria-label="질문 보내기"
                    disabled={
                      !session.canSubmit ||
                      !session.online ||
                      session.draft.trim().length < 3
                    }
                  >
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      aria-hidden="true"
                    >
                      <path d="m21 3-7 18-4-7-7-4 18-7Z" />
                      <path d="m10 14 11-11" />
                    </svg>
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
