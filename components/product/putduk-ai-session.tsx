"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
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

export type PutdukAiFeedbackResult = "exists" | "failed" | "saved";

export type PutdukAiSession = {
  activeConversationId: string | null;
  canSubmit: boolean;
  draft: string;
  history: readonly OwnAiConversationSummary[];
  historyStatus: "hidden" | "loading" | "ready" | "unavailable";
  knowledgeVersion: string;
  messages: readonly PutdukAiMessage[];
  pending: boolean;
  ownerStatus: "checking" | "ready" | "refreshing";
  providerConfigured: boolean;
  setDraft: (question: string) => void;
  submit: (options?: { screenContext?: AiScreenContext }) => Promise<void>;
  cancel: () => void;
  restoreQuestion: (messageId: string) => boolean;
  startNewConversation: () => void;
  openConversation: (conversationId: string) => Promise<void>;
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
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [pending, setPending] = useState(false);
  const [authObservationVersion, setAuthObservationVersion] = useState(0);
  const [ownerStatus, setOwnerStatus] =
    useState<PutdukAiSession["ownerStatus"]>("checking");
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
    const active = activeRef.current;
    activeRef.current = null;
    active?.controller.abort();
    void active?.reader?.cancel().catch(() => undefined);
    draftRef.current = "";
    setDraftState("");
    setMessages([]);
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setHistory([]);
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
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed && !ownerAllowedRef.current)
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

  const loadHistoryList = useCallback(async () => {
    const browser = browserClientRef.current;
    if (!liveRef.current || !browser || typeof browser.from !== "function") {
      return null;
    }
    setHistoryStatus((current) => (current === "hidden" ? "loading" : current));
    const listed = await listOwnAiConversations(browser, ownerUserId);
    if (!liveRef.current) return null;
    if (!listed.ok) {
      setHistoryStatus("unavailable");
      return null;
    }
    setHistory(listed.conversations);
    setHistoryStatus("ready");
    return listed.conversations;
  }, [ownerUserId]);

  const applyOwnMessages = useCallback(
    (conversationId: string, rows: readonly OwnAiMessage[]) => {
      setMessages(
        rows.map((row) => ({
          id: row.id,
          role: row.authorRole === "ASSISTANT" ? "assistant" : "user",
          state: "complete" as const,
          text: row.bodyText,
          saved: true,
          conversationId,
          ...(row.authorRole === "ASSISTANT"
            ? { assistantMessageId: row.id }
            : {}),
        })),
      );
    },
    [],
  );

  const openConversation = useCallback(
    async (conversationId: string) => {
      if (!ownerAllowedRef.current || activeRef.current) return;
      historyTokenRef.current += 1;
      const token = historyTokenRef.current;
      const browser = browserClientRef.current;
      if (!browser || typeof browser.from !== "function") return;
      const read = await readOwnAiMessages(
        browser,
        ownerUserId,
        conversationId,
      );
      if (!liveRef.current || token !== historyTokenRef.current) return;
      if (!read.ok) {
        setHistoryStatus("unavailable");
        return;
      }
      rememberConversation(conversationId);
      applyOwnMessages(conversationId, read.messages);
    },
    [applyOwnMessages, ownerUserId, rememberConversation],
  );

  const startNewConversation = useCallback(() => {
    if (activeRef.current) return;
    historyTokenRef.current += 1;
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    setMessages([]);
  }, []);

  useEffect(() => {
    if (ownerStatus !== "ready") return;
    let cancelled = false;
    const token = historyTokenRef.current;
    void (async () => {
      const conversations = await loadHistoryList();
      if (
        cancelled ||
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
      );
      if (
        cancelled ||
        token !== historyTokenRef.current ||
        localTurnStartedRef.current ||
        !read.ok
      ) {
        return;
      }
      rememberConversation(conversations[0].id);
      applyOwnMessages(conversations[0].id, read.messages);
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

  const submit = useCallback(
    async (options: { screenContext?: AiScreenContext } = {}) => {
      const question = draftRef.current.trim();
      if (
        !liveRef.current ||
        !ownerAllowedRef.current ||
        activeRef.current ||
        question.length < 3 ||
        question.length > AI_QUESTION_MAX_CHARACTERS
      )
        return;
      historyTokenRef.current += 1;
      localTurnStartedRef.current = true;
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
            await reader.cancel().catch(() => undefined);
            break;
          }
          if (done) throw new Error("AI_STREAM_INTERRUPTED");
        }
      } catch (error) {
        if (isCurrent()) {
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
        if (liveRef.current && request.message.conversationId) {
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
      if (!message?.question || !["error", "cancelled"].includes(message.state))
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
        if (response.status === 409) return "exists" as const;
        if (!response.ok) return "failed" as const;
        return "saved" as const;
      } catch {
        return "failed" as const;
      }
    },
    [ownerUserId],
  );

  return (
    <SessionContext.Provider
      value={{
        activeConversationId,
        canSubmit: ownerStatus === "ready",
        draft,
        history,
        historyStatus,
        knowledgeVersion,
        messages,
        pending,
        ownerStatus,
        providerConfigured,
        setDraft,
        submit,
        cancel,
        restoreQuestion,
        startNewConversation,
        openConversation,
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
