"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_QUESTION_MAX_CHARACTERS,
  aiScreenContextSchema,
  type AiScreenContext,
} from "@/domain/ai/chat";
import { AI_PRESENTATION_OWNER_HEADER } from "@/domain/ai/presentation-owner";
import { AI_FEEDBACK_REASON_LABELS } from "@/domain/ai/member-feedback";
import { trackAnalyticsEvent } from "@/lib/analytics/client";
import type { SupabaseBrowserAuthConfig } from "@/lib/env/public";
import {
  listOwnAiConversations,
  readOwnAiMessages,
  type OwnAiConversationCursor,
  type OwnAiConversationSummary,
  type OwnAiMessage,
} from "@/lib/ai/member-conversation-read";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

import {
  aiFailure,
  applyAiStreamEvent,
  createAiEventDecoder,
  readAiHttpFailure,
  PutdukAiProtocolError,
  type PutdukAiMessage,
} from "./putduk-ai-protocol";
import { restoreOwnAiMessages } from "./putduk-ai-history";

export type PutdukAiFeedbackResult = "exists" | "failed" | "saved";
type TranscriptPosition = {
  conversationId: string;
  scrollTop: number;
  followLatest: boolean;
};

export type PutdukAiSession = {
  /** Verified server owner; read-only presentation binding, never owner selection. */
  readonly ownerUserId: string;
  activeConversationId: string | null;
  canSubmit: boolean;
  draft: string;
  history: readonly OwnAiConversationSummary[];
  historyStatus: "hidden" | "loading" | "ready" | "unavailable";
  historyHasEarlierMessages: boolean;
  historyListHasMore: boolean;
  historyListPageStatus: "idle" | "loading" | "error";
  earlierMessagesStatus: "idle" | "loading" | "error";
  knowledgeVersion: string;
  messages: readonly PutdukAiMessage[];
  pending: boolean;
  ownerStatus: "checking" | "ready" | "refreshing";
  online: boolean;
  providerConfigured: boolean;
  setDraft: (question: string) => void;
  submit: (options?: { screenContext?: AiScreenContext }) => Promise<void>;
  cancel: () => void;
  restoreQuestion: (messageId: string) => boolean;
  startNewConversation: () => void;
  openConversation: (conversationId: string) => Promise<void>;
  reloadHistory: () => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  loadEarlierMessages: () => Promise<boolean>;
  readTranscriptPosition: (
    surface: "dock" | "page",
  ) => TranscriptPosition | null;
  rememberTranscriptPosition: (
    surface: "dock" | "page",
    position: TranscriptPosition,
  ) => void;
  sendFeedback: (
    messageId: string,
    rating: "DOWN" | "UP",
    reasonCode?: keyof typeof AI_FEEDBACK_REASON_LABELS,
  ) => Promise<PutdukAiFeedbackResult>;
};

type ProviderProps = {
  children?: ReactNode;
  ownerUserId: string;
  /** Observes a new server verification; it is not an authentication token. */
  ownerVerificationId: string;
  browserAuthConfig: SupabaseBrowserAuthConfig;
  knowledgeVersion: string;
  providerConfigured: boolean;
};

type ActiveRequest = {
  controller: AbortController;
  message: PutdukAiMessage;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
};

const SessionContext = createContext<PutdukAiSession | null>(null);

function subscribeConnection(observe: () => void) {
  window.addEventListener("online", observe);
  window.addEventListener("offline", observe);
  return () => {
    window.removeEventListener("online", observe);
    window.removeEventListener("offline", observe);
  };
}

const browserConnectionSnapshot = () => navigator.onLine;
const serverConnectionSnapshot = () => true;

/** Account changes replace the entire owner before another presentation renders. */
export function PutdukAiSessionProvider(props: ProviderProps) {
  return <OwnedAiSession key={props.ownerUserId} {...props} />;
}

function OwnedAiSession({
  children,
  browserAuthConfig: {
    url: supabaseUrl,
    publishableKey: supabasePublishableKey,
  },
  knowledgeVersion,
  ownerUserId,
  ownerVerificationId,
  providerConfigured,
}: ProviderProps) {
  const { refresh } = useRouter();
  const [draft, setDraftState] = useState("");
  const [messages, setMessages] = useState<PutdukAiMessage[]>([]);
  const [history, setHistory] = useState<readonly OwnAiConversationSummary[]>(
    [],
  );
  const [historyStatus, setHistoryStatus] =
    useState<PutdukAiSession["historyStatus"]>("hidden");
  const [historyHasEarlierMessages, setHistoryHasEarlierMessages] =
    useState(false);
  const [historyListHasMore, setHistoryListHasMore] = useState(false);
  const [historyListPageStatus, setHistoryListPageStatus] =
    useState<PutdukAiSession["historyListPageStatus"]>("idle");
  const [earlierMessagesStatus, setEarlierMessagesStatus] =
    useState<PutdukAiSession["earlierMessagesStatus"]>("idle");
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [pending, setPending] = useState(false);
  const [authObservationVersion, setAuthObservationVersion] = useState(0);
  const [ownerStatus, setOwnerStatus] =
    useState<PutdukAiSession["ownerStatus"]>("checking");
  const online = useSyncExternalStore(
    subscribeConnection,
    browserConnectionSnapshot,
    serverConnectionSnapshot,
  );
  const draftRef = useRef("");
  const activeRef = useRef<ActiveRequest | null>(null);
  const liveRef = useRef(false);
  const ownerAllowedRef = useRef(false);
  const browserOwnerRef = useRef<string | null | undefined>(undefined);
  const initialOwnerObservedRef = useRef(false);
  const verificationRef = useRef(ownerVerificationId);
  const lockedVerificationRef = useRef<string | null>(null);
  const browserClientRef = useRef<SupabaseClient | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const historyTokenRef = useRef(0);
  const historyListTokenRef = useRef(0);
  const historyRetryConversationRef = useRef<string | null>(null);
  const historyCursorRef = useRef<OwnAiConversationCursor | null>(null);
  const historyPageRequestRef = useRef<number | null>(null);
  const earlierRequestRef = useRef<number | null>(null);
  const historyRowsRef = useRef<readonly OwnAiMessage[]>([]);
  const transcriptPositionsRef = useRef<
    Partial<Record<"dock" | "page", TranscriptPosition>>
  >({});
  const ownerEpochRef = useRef(0);
  const localTurnStartedRef = useRef(false);

  const writeMessage = useCallback((message: PutdukAiMessage) => {
    setMessages((current) =>
      current.map((row) => (row.id === message.id ? message : row)),
    );
  }, []);

  const abortActiveRequest = useCallback(
    (code: "CLIENT_CANCELLED" | "AI_STREAM_INTERRUPTED") => {
      const active = activeRef.current;
      if (!active) return;
      activeRef.current = null;
      active.controller.abort();
      void active.reader?.cancel().catch(() => undefined);
      if (active.message.state === "streaming")
        writeMessage({
          ...active.message,
          state: "cancelled",
          failure: aiFailure(code),
        });
      setPending(false);
    },
    [writeMessage],
  );

  const confirmMatchingOwner = useCallback(() => {
    if (
      !liveRef.current ||
      !initialOwnerObservedRef.current ||
      browserOwnerRef.current !== ownerUserId ||
      (lockedVerificationRef.current !== null &&
        lockedVerificationRef.current === verificationRef.current)
    )
      return;
    lockedVerificationRef.current = null;
    ownerAllowedRef.current = true;
    setOwnerStatus("ready");
  }, [ownerUserId]);

  const invalidateOwner = useCallback(() => {
    if (!liveRef.current) return;
    const refreshNeeded = lockedVerificationRef.current === null;
    lockedVerificationRef.current ??= verificationRef.current;
    ownerAllowedRef.current = false;
    ownerEpochRef.current += 1;
    historyTokenRef.current += 1;
    historyListTokenRef.current += 1;
    const active = activeRef.current;
    activeRef.current = null;
    active?.controller.abort();
    void active?.reader?.cancel().catch(() => undefined);
    draftRef.current = "";
    setDraftState("");
    setMessages([]);
    setHistoryHasEarlierMessages(false);
    setHistoryListHasMore(false);
    setHistoryListPageStatus("idle");
    setEarlierMessagesStatus("idle");
    historyCursorRef.current = null;
    historyPageRequestRef.current = null;
    earlierRequestRef.current = null;
    historyRowsRef.current = [];
    transcriptPositionsRef.current = {};
    historyRetryConversationRef.current = null;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setHistory([]);
    setHistoryStatus("hidden");
    setPending(false);
    setOwnerStatus("refreshing");
    if (refreshNeeded)
      queueMicrotask(() => {
        if (liveRef.current) refresh();
      });
  }, [refresh]);

  useEffect(() => {
    liveRef.current = true;
    // A replacement observer must establish its own initial session. Neither
    // the previous browser owner nor a new server nonce opens this gap.
    browserOwnerRef.current = undefined;
    initialOwnerObservedRef.current = false;
    ownerAllowedRef.current = false;
    earlierRequestRef.current = null;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      setEarlierMessagesStatus("idle");
      if (!ownerAllowedRef.current)
        setOwnerStatus(
          lockedVerificationRef.current === null ? "checking" : "refreshing",
        );
    });
    let unsubscribe: (() => void) | undefined;
    try {
      const browser = createSupabaseBrowserClient({
        url: supabaseUrl,
        publishableKey: supabasePublishableKey,
      });
      browserClientRef.current = browser;
      const { data } = browser.auth.onAuthStateChange(
        (event, browserSession) => {
          if (disposed || !liveRef.current) return;
          browserOwnerRef.current =
            event === "SIGNED_OUT" ? null : (browserSession?.user?.id ?? null);
          if (event === "INITIAL_SESSION")
            initialOwnerObservedRef.current =
              browserOwnerRef.current === ownerUserId;
          if (browserOwnerRef.current !== ownerUserId) invalidateOwner();
          else confirmMatchingOwner();
        },
      );
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // No browser auth observer means no question may be sent.
      queueMicrotask(() => {
        if (!disposed) invalidateOwner();
      });
    }
    return () => {
      disposed = true;
      liveRef.current = false;
      ownerAllowedRef.current = false;
      ownerEpochRef.current += 1;
      historyTokenRef.current += 1;
      historyListTokenRef.current += 1;
      browserClientRef.current = null;
      unsubscribe?.();
      abortActiveRequest("AI_STREAM_INTERRUPTED");
    };
  }, [
    abortActiveRequest,
    authObservationVersion,
    supabaseUrl,
    supabasePublishableKey,
    confirmMatchingOwner,
    invalidateOwner,
    ownerUserId,
  ]);

  useEffect(() => {
    verificationRef.current = ownerVerificationId;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) confirmMatchingOwner();
    });
    return () => {
      disposed = true;
    };
  }, [confirmMatchingOwner, ownerVerificationId]);

  const setDraft = useCallback((value: string) => {
    if (!liveRef.current || !ownerAllowedRef.current) return;
    draftRef.current = value.slice(0, AI_QUESTION_MAX_CHARACTERS);
    setDraftState(draftRef.current);
  }, []);

  const rememberConversation = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId;
    setActiveConversationId(conversationId);
  }, []);

  const readTranscriptPosition = useCallback((surface: "dock" | "page") => {
    const position = transcriptPositionsRef.current[surface];
    return position &&
      ownerAllowedRef.current &&
      position.conversationId === activeConversationIdRef.current
      ? position
      : null;
  }, []);

  const rememberTranscriptPosition = useCallback(
    (surface: "dock" | "page", position: TranscriptPosition) => {
      if (
        !ownerAllowedRef.current ||
        position.conversationId !== activeConversationIdRef.current ||
        !Number.isFinite(position.scrollTop) ||
        position.scrollTop < 0
      )
        return;
      transcriptPositionsRef.current[surface] = { ...position };
    },
    [],
  );

  const loadHistoryList = useCallback(async () => {
    const browser = browserClientRef.current;
    if (
      !liveRef.current ||
      !ownerAllowedRef.current ||
      !browser ||
      typeof browser.from !== "function"
    ) {
      return null;
    }
    const epoch = ownerEpochRef.current;
    const token = ++historyListTokenRef.current;
    const current = () =>
      liveRef.current &&
      ownerAllowedRef.current &&
      epoch === ownerEpochRef.current &&
      token === historyListTokenRef.current &&
      browser === browserClientRef.current;
    setHistoryStatus((current) => (current === "hidden" ? "loading" : current));
    const listed = await listOwnAiConversations(browser, ownerUserId).catch(
      () => null,
    );
    if (!current()) return null;
    if (!listed?.ok) {
      setHistoryStatus("unavailable");
      return null;
    }
    setHistory(listed.conversations);
    historyCursorRef.current = listed.nextCursor ?? null;
    setHistoryListHasMore(Boolean(listed.hasMore && listed.nextCursor));
    setHistoryListPageStatus("idle");
    setHistoryStatus("ready");
    return listed.conversations;
  }, [ownerUserId]);

  const applyOwnMessages = useCallback(
    (
      conversationId: string,
      rows: readonly OwnAiMessage[],
      hasEarlierMessages: boolean,
    ) => {
      setMessages(restoreOwnAiMessages(conversationId, rows));
      historyRowsRef.current = rows;
      earlierRequestRef.current = null;
      setEarlierMessagesStatus("idle");
      setHistoryHasEarlierMessages(hasEarlierMessages);
    },
    [],
  );

  const loadMoreHistory = useCallback(async () => {
    const browser = browserClientRef.current;
    const cursor = historyCursorRef.current;
    if (
      !liveRef.current ||
      !ownerAllowedRef.current ||
      !navigator.onLine ||
      !browser ||
      !cursor ||
      activeRef.current ||
      historyPageRequestRef.current !== null
    )
      return;
    const epoch = ownerEpochRef.current;
    const token = ++historyListTokenRef.current;
    historyPageRequestRef.current = token;
    setHistoryListPageStatus("loading");
    const current = () =>
      liveRef.current &&
      ownerAllowedRef.current &&
      epoch === ownerEpochRef.current &&
      token === historyListTokenRef.current &&
      browser === browserClientRef.current;
    try {
      const listed = await listOwnAiConversations(
        browser,
        ownerUserId,
        cursor,
      ).catch(() => null);
      if (!current()) return;
      if (!listed?.ok) {
        setHistoryListPageStatus("error");
        return;
      }
      setHistory((rows) => {
        const ids = new Set(rows.map((row) => row.id));
        return [
          ...rows,
          ...listed.conversations.filter((row) => !ids.has(row.id)),
        ];
      });
      historyCursorRef.current = listed.nextCursor ?? null;
      setHistoryListHasMore(Boolean(listed.hasMore && listed.nextCursor));
      setHistoryListPageStatus("idle");
    } finally {
      if (historyPageRequestRef.current === token)
        historyPageRequestRef.current = null;
    }
  }, [ownerUserId]);

  const loadEarlierMessages = useCallback(async () => {
    const browser = browserClientRef.current;
    const conversationId = activeConversationIdRef.current;
    const beforePosition = historyRowsRef.current[0]?.position;
    if (
      !liveRef.current ||
      !ownerAllowedRef.current ||
      !navigator.onLine ||
      !browser ||
      !conversationId ||
      !beforePosition ||
      !historyHasEarlierMessages ||
      activeRef.current ||
      earlierRequestRef.current !== null
    )
      return false;
    const epoch = ownerEpochRef.current;
    const token = historyTokenRef.current;
    earlierRequestRef.current = token;
    setEarlierMessagesStatus("loading");
    const current = () =>
      liveRef.current &&
      ownerAllowedRef.current &&
      epoch === ownerEpochRef.current &&
      token === historyTokenRef.current &&
      conversationId === activeConversationIdRef.current &&
      !activeRef.current &&
      browser === browserClientRef.current;
    try {
      const read = await readOwnAiMessages(
        browser,
        ownerUserId,
        conversationId,
        beforePosition,
      ).catch(() => null);
      if (!current()) return false;
      const existing = historyRowsRef.current;
      const ids = new Set(existing.map((row) => row.id));
      if (
        !read?.ok ||
        read.messages.some(
          (row) => row.position >= beforePosition || ids.has(row.id),
        )
      ) {
        setEarlierMessagesStatus("error");
        return false;
      }
      const combined = [...read.messages, ...existing];
      historyRowsRef.current = combined;
      // Restore raw stored chunks together, preserving evidence across a page boundary.
      // Fresh turns remain separate from this historical read.
      setMessages((rows) => [
        ...restoreOwnAiMessages(conversationId, combined),
        ...rows.filter((row) => !row.historical),
      ]);
      setHistoryHasEarlierMessages(read.hasEarlierMessages);
      setEarlierMessagesStatus("idle");
      return read.messages.length > 0;
    } finally {
      if (earlierRequestRef.current === token) earlierRequestRef.current = null;
    }
  }, [historyHasEarlierMessages, ownerUserId]);

  const openConversation = useCallback(
    async (conversationId: string) => {
      if (!ownerAllowedRef.current || activeRef.current) return;
      historyTokenRef.current += 1;
      earlierRequestRef.current = null;
      setEarlierMessagesStatus("idle");
      const token = historyTokenRef.current;
      const epoch = ownerEpochRef.current;
      const browser = browserClientRef.current;
      if (!browser || typeof browser.from !== "function") return;
      const read = await readOwnAiMessages(
        browser,
        ownerUserId,
        conversationId,
      ).catch(() => null);
      if (
        !liveRef.current ||
        !ownerAllowedRef.current ||
        epoch !== ownerEpochRef.current ||
        token !== historyTokenRef.current
      )
        return;
      if (!read?.ok) {
        historyRetryConversationRef.current = conversationId;
        setHistoryStatus("unavailable");
        return;
      }
      historyRetryConversationRef.current = null;
      setHistoryStatus("ready");
      rememberConversation(conversationId);
      applyOwnMessages(conversationId, read.messages, read.hasEarlierMessages);
    },
    [applyOwnMessages, ownerUserId, rememberConversation],
  );

  const startNewConversation = useCallback(() => {
    if (!ownerAllowedRef.current || activeRef.current) return;
    historyTokenRef.current += 1;
    historyRetryConversationRef.current = null;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
    setHistoryHasEarlierMessages(false);
    historyRowsRef.current = [];
    transcriptPositionsRef.current = {};
    earlierRequestRef.current = null;
    setEarlierMessagesStatus("idle");
  }, []);

  useEffect(() => {
    if (ownerStatus !== "ready") return;
    let cancelled = false;
    const token = historyTokenRef.current;
    const epoch = ownerEpochRef.current;
    void (async () => {
      const conversations = await loadHistoryList();
      if (
        cancelled ||
        !ownerAllowedRef.current ||
        epoch !== ownerEpochRef.current ||
        token !== historyTokenRef.current ||
        localTurnStartedRef.current ||
        activeConversationIdRef.current ||
        !conversations?.[0]
      ) {
        return;
      }
      const browser = browserClientRef.current;
      if (!browser) return;
      const read = await readOwnAiMessages(
        browser,
        ownerUserId,
        conversations[0].id,
      ).catch(() => null);
      if (
        cancelled ||
        !ownerAllowedRef.current ||
        epoch !== ownerEpochRef.current ||
        token !== historyTokenRef.current ||
        localTurnStartedRef.current
      ) {
        return;
      }
      if (!read?.ok) {
        historyRetryConversationRef.current = conversations[0].id;
        setHistoryStatus("unavailable");
        return;
      }
      historyRetryConversationRef.current = null;
      rememberConversation(conversations[0].id);
      applyOwnMessages(
        conversations[0].id,
        read.messages,
        read.hasEarlierMessages,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [
    applyOwnMessages,
    loadHistoryList,
    ownerUserId,
    ownerStatus,
    rememberConversation,
  ]);

  const cancel = useCallback(() => {
    abortActiveRequest("CLIENT_CANCELLED");
  }, [abortActiveRequest]);

  const reloadHistory = useCallback(async () => {
    const epoch = ownerEpochRef.current;
    const selection = historyTokenRef.current;
    const listed = await loadHistoryList();
    if (
      !liveRef.current ||
      !ownerAllowedRef.current ||
      epoch !== ownerEpochRef.current ||
      selection !== historyTokenRef.current
    )
      return;
    const retryConversation = historyRetryConversationRef.current;
    if (listed && retryConversation && !activeRef.current) {
      await openConversation(retryConversation);
    } else if (
      listed?.[0] &&
      !activeRef.current &&
      !activeConversationIdRef.current &&
      !localTurnStartedRef.current
    ) {
      await openConversation(listed[0].id);
    }
  }, [loadHistoryList, openConversation]);

  const submit = useCallback(
    async (options: { screenContext?: AiScreenContext } = {}) => {
      const question = draftRef.current.trim();
      if (
        !liveRef.current ||
        !ownerAllowedRef.current ||
        !navigator.onLine ||
        activeRef.current ||
        question.length < 3 ||
        question.length > AI_QUESTION_MAX_CHARACTERS
      )
        return;
      historyTokenRef.current += 1;
      earlierRequestRef.current = null;
      setEarlierMessagesStatus("idle");
      historyRetryConversationRef.current = null;
      localTurnStartedRef.current = true;
      const epoch = ownerEpochRef.current;
      const clientMessageId = crypto.randomUUID();
      const request: ActiveRequest = {
        controller: new AbortController(),
        message: {
          id: crypto.randomUUID(),
          role: "assistant",
          state: "streaming",
          text: "",
          question,
        },
      };
      activeRef.current = request;
      setPending(true);
      setDraft("");
      setMessages((current) => [
        ...current,
        {
          id: clientMessageId,
          role: "user",
          state: "complete",
          text: question,
        },
        request.message,
      ]);
      void trackAnalyticsEvent("ai_question", {
        character_count: question.length,
        knowledge_version: knowledgeVersion,
      }).catch(() => undefined);
      const isCurrent = () =>
        liveRef.current &&
        ownerAllowedRef.current &&
        epoch === ownerEpochRef.current &&
        activeRef.current === request &&
        !request.controller.signal.aborted;
      const context = aiScreenContextSchema.safeParse(options.screenContext);
      let receiving = false;
      try {
        const response = await fetch("/api/v1/ai/chat", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            // A comparison hint only; the API independently verifies its user.
            [AI_PRESENTATION_OWNER_HEADER]: ownerUserId,
          },
          body: JSON.stringify({
            clientMessageId,
            question,
            ...(activeConversationIdRef.current
              ? { conversationId: activeConversationIdRef.current }
              : {}),
            ...(context.success ? { screenContext: context.data } : {}),
          }),
          signal: request.controller.signal,
        });
        if (!isCurrent()) {
          void response.body?.cancel().catch(() => undefined);
          return;
        }
        if (!response.ok || !response.body) {
          const failure = readAiHttpFailure(
            await response.json().catch(() => null),
            response.status,
          );
          if (isCurrent()) {
            if (
              response.status === 409 &&
              failure.code === "AI_SESSION_CHANGED"
            ) {
              browserOwnerRef.current = undefined;
              initialOwnerObservedRef.current = false;
              invalidateOwner();
              setAuthObservationVersion((current) => current + 1);
            } else
              writeMessage({ ...request.message, state: "error", failure });
          }
          return;
        }
        receiving = true;
        const reader = response.body.getReader();
        request.reader = reader;
        const decoder = createAiEventDecoder();
        while (isCurrent()) {
          const { done, value } = await reader.read();
          if (!isCurrent()) return;
          for (const event of decoder.push(value, done)) {
            request.message = applyAiStreamEvent(request.message, event);
            writeMessage(request.message);
            if (request.message.state !== "streaming") break;
          }
          if (request.message.state !== "streaming") {
            if (request.message.state === "complete" && !done) {
              // A verified done receipt ends the answer, not the HTTP body.
              // Let normal EOF finish so transport observers can read its ACK.
              const closeTimer = setTimeout(() => {
                request.controller.abort();
                void reader.cancel().catch(() => undefined);
              }, 5_000);
              try {
                let trailingBytes = 0;
                while (isCurrent()) {
                  const trailing = await reader.read();
                  if (trailing.done) break;
                  trailingBytes += trailing.value?.byteLength ?? 0;
                  if (trailingBytes > 64_000) {
                    request.controller.abort();
                    await reader.cancel().catch(() => undefined);
                    break;
                  }
                }
              } finally {
                clearTimeout(closeTimer);
              }
            } else if (request.message.state !== "complete") {
              await reader.cancel().catch(() => undefined);
            }
            break;
          }
          if (done) throw new Error("AI_STREAM_INTERRUPTED");
        }
      } catch (error) {
        // A later transport close cannot undo a genuine terminal receipt.
        if (isCurrent() && request.message.state === "streaming") {
          const code =
            error instanceof PutdukAiProtocolError
              ? "AI_STREAM_INVALID"
              : receiving
                ? "AI_STREAM_INTERRUPTED"
                : "AI_CONNECTION_FAILED";
          writeMessage({
            ...request.message,
            state: "error",
            failure: aiFailure(code),
          });
        }
        request.controller.abort();
        void request.reader?.cancel().catch(() => undefined);
      } finally {
        request.reader?.releaseLock();
        if (liveRef.current && activeRef.current === request) {
          activeRef.current = null;
          setPending(false);
        }
        if (
          liveRef.current &&
          ownerAllowedRef.current &&
          epoch === ownerEpochRef.current &&
          request.message.conversationId
        ) {
          rememberConversation(request.message.conversationId);
          void loadHistoryList();
        }
      }
    },
    [
      invalidateOwner,
      knowledgeVersion,
      loadHistoryList,
      ownerUserId,
      rememberConversation,
      setDraft,
      writeMessage,
    ],
  );

  const restoreQuestion = useCallback(
    (messageId: string) => {
      if (!ownerAllowedRef.current || activeRef.current) return false;
      const message = messages.find((row) => row.id === messageId);
      if (
        !message?.question ||
        !["error", "cancelled", "unverified"].includes(message.state)
      )
        return false;
      setDraft(message.question);
      return true;
    },
    [messages, setDraft],
  );

  const sendFeedback = useCallback(
    async (
      messageId: string,
      rating: "DOWN" | "UP",
      reasonCode?: keyof typeof AI_FEEDBACK_REASON_LABELS,
    ) => {
      const conversationId = activeConversationIdRef.current;
      if (!liveRef.current || !ownerAllowedRef.current || !conversationId) {
        return "failed" as const;
      }
      const epoch = ownerEpochRef.current;
      try {
        const response = await fetch("/api/v1/ai/feedback", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            [AI_PRESENTATION_OWNER_HEADER]: ownerUserId,
          },
          body: JSON.stringify({
            conversationId,
            messageId,
            rating,
            ...(reasonCode ? { reasonCode } : {}),
          }),
        });
        if (
          !liveRef.current ||
          !ownerAllowedRef.current ||
          epoch !== ownerEpochRef.current
        )
          return "failed" as const;
        if (response.status === 409) {
          const payload = await response.json().catch(() => null);
          if (
            !liveRef.current ||
            !ownerAllowedRef.current ||
            epoch !== ownerEpochRef.current
          )
            return "failed" as const;
          if (payload?.error?.code === "AI_SESSION_CHANGED") {
            browserOwnerRef.current = undefined;
            initialOwnerObservedRef.current = false;
            invalidateOwner();
            setAuthObservationVersion((current) => current + 1);
            return "failed" as const;
          }
          return payload?.error?.code === "AI_FEEDBACK_EXISTS"
            ? ("exists" as const)
            : ("failed" as const);
        }
        if (!response.ok) return "failed" as const;
        return "saved" as const;
      } catch {
        return "failed" as const;
      }
    },
    [invalidateOwner, ownerUserId],
  );

  return (
    <SessionContext.Provider
      value={{
        ownerUserId,
        activeConversationId,
        canSubmit: ownerStatus === "ready",
        draft,
        history,
        historyStatus,
        historyHasEarlierMessages,
        historyListHasMore,
        historyListPageStatus,
        earlierMessagesStatus,
        readTranscriptPosition,
        rememberTranscriptPosition,
        knowledgeVersion,
        messages,
        pending,
        ownerStatus,
        online,
        providerConfigured,
        setDraft,
        submit,
        cancel,
        restoreQuestion,
        startNewConversation,
        openConversation,
        reloadHistory,
        loadMoreHistory,
        loadEarlierMessages,
        sendFeedback,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function usePutdukAiSession(): PutdukAiSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("PUTDUK_AI_SESSION_PROVIDER_REQUIRED");
  return session;
}
