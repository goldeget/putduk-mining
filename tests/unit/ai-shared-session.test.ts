// @vitest-environment jsdom

import { act, createElement, Fragment, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PutdukAiChat,
  type PutdukAiPageFacts,
} from "@/components/product/putduk-ai-chat";
import { AI_PRESENTATION_OWNER_HEADER } from "@/domain/ai/presentation-owner";
import {
  PutdukAiSessionProvider,
  usePutdukAiSession,
  type PutdukAiSession,
} from "@/components/product/putduk-ai-session";

const navigation = vi.hoisted(() => ({ pathname: "/wallet", search: "" }));
const historyReads = vi.hoisted(() => ({
  enabled: false,
  list: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/ai/member-conversation-read", () => ({
  listOwnAiConversations: historyReads.list,
  readOwnAiMessages: historyReads.read,
}));
type AuthObserver = (
  event: string,
  browserSession: { user: { id: string } } | null,
) => void;
const browserAuth = vi.hoisted(() => ({
  autoInitial: true,
  ownerId: "member-a" as string | null,
  observers: new Set<AuthObserver>(),
  refresh: vi.fn(),
  unsubscribes: [] as ReturnType<typeof vi.fn>[],
  createError: false,
  onSubscribe: null as (() => void) | null,
  configurations: [] as unknown[],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ refresh: browserAuth.refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: (configuration: unknown) => {
    browserAuth.configurations.push(configuration);
    if (browserAuth.createError) throw new Error("AUTH_OBSERVER_UNAVAILABLE");
    return {
      ...(historyReads.enabled ? { from: vi.fn() } : {}),
      auth: {
        onAuthStateChange(observer: AuthObserver) {
          browserAuth.observers.add(observer);
          const unsubscribe = vi.fn(() =>
            browserAuth.observers.delete(observer),
          );
          browserAuth.unsubscribes.push(unsubscribe);
          browserAuth.onSubscribe?.();
          if (browserAuth.autoInitial)
            queueMicrotask(() => {
              if (browserAuth.observers.has(observer))
                observer(
                  "INITIAL_SESSION",
                  browserAuth.ownerId
                    ? { user: { id: browserAuth.ownerId } }
                    : null,
                );
            });
          return { data: { subscription: { unsubscribe } } };
        },
      },
    };
  },
}));
vi.mock("@/lib/analytics/client", () => ({
  trackAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}));

const requestId = "a3cb8f7b-16b6-41c8-8f65-5782e6b14df7";
let host: HTMLDivElement;
let root: Root;
let session: PutdukAiSession;
let fetchMock: ReturnType<typeof vi.fn>;

function Probe() {
  const current = usePutdukAiSession();
  useEffect(() => {
    session = current;
  }, [current]);
  return createElement(
    "output",
    { "data-testid": "session-probe" },
    current.draft,
  );
}

function render(
  ownerUserId = "member-a",
  views = 1,
  providerConfigured = true,
  ownerVerificationId = `${ownerUserId}:server-render-1`,
  surface: "dock" | "page" = "dock",
  pageFacts?: PutdukAiPageFacts,
) {
  return act(async () =>
    root.render(
      createElement(
        PutdukAiSessionProvider,
        {
          ownerUserId,
          ownerVerificationId,
          knowledgeVersion: "v1",
          providerConfigured,
          browserAuthConfig: {
            url: "http://127.0.0.1:58421",
            publishableKey: "sb_publishable_member_browser_fixture",
          },
        },
        createElement(
          Fragment,
          null,
          createElement(Probe),
          ...Array.from({ length: views }, (_, index) =>
            createElement(PutdukAiChat, {
              key: index,
              presentation: surface === "page" ? "page" : "panel",
              surface,
              ...(pageFacts ? { pageFacts } : {}),
            }),
          ),
        ),
      ),
    ),
  );
}

function emitAuth(event: string, ownerId: string | null) {
  browserAuth.ownerId = ownerId;
  for (const observer of browserAuth.observers)
    observer(event, ownerId ? { user: { id: ownerId } } : null);
}

function responseStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel: cancelled,
  });
  return {
    cancelled,
    response: new Response(stream, {
      headers: { "Content-Type": "text/event-stream" },
    }),
    send(event: object) {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
      );
    },
    close() {
      controller.close();
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function immediateAnswer(source: "static" | "tool" | "provider" = "static") {
  const stream = responseStream();
  stream.send({ type: "ready", requestId, source });
  stream.send({ type: "delta", text: "확인한 안내예요." });
  stream.send({
    type: "done",
    requestId,
    knowledgeVersion: "server-v2",
    ...(source === "tool"
      ? {
          grounding: {
            source: "domain_tool",
            tool: "wallet.summary",
            asOf: "2026-10-03T02:00:00.000Z",
          },
        }
      : {}),
  });
  stream.close();
  return stream;
}

async function begin(
  question: string,
  screenContext?: Parameters<PutdukAiSession["submit"]>[0],
) {
  let turn!: Promise<void>;
  await act(async () => {
    session.setDraft(question);
    turn = session.submit(screenContext);
    await Promise.resolve();
  });
  return { turn };
}

beforeEach(() => {
  historyReads.enabled = false;
  historyReads.list
    .mockReset()
    .mockResolvedValue({ ok: true, conversations: [] });
  historyReads.read
    .mockReset()
    .mockResolvedValue({ ok: true, messages: [], hasEarlierMessages: false });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  navigation.pathname = "/wallet";
  navigation.search = "";
  browserAuth.autoInitial = true;
  browserAuth.ownerId = "member-a";
  browserAuth.observers.clear();
  browserAuth.unsubscribes = [];
  browserAuth.createError = false;
  browserAuth.onSubscribe = null;
  browserAuth.configurations = [];
  browserAuth.refresh = vi.fn();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("one PUTDUK AI request and session owner", () => {
  it("shows originating page guide links without guessing member figures or sending a request", async () => {
    navigation.pathname = "/ai";
    navigation.search = "aiOrigin=%2Fwallet";
    await render("member-a", 1, false, "member-a:server-render-1", "page");
    const guide = host.querySelector('[aria-label="현재 화면 도움"]');
    expect(guide?.textContent).toContain("자산 화면 도움");
    expect(
      Array.from(guide?.querySelectorAll("a") ?? []).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["/wallet", "/wallet/deposit", "/wallet/withdraw"]);
    expect(host.textContent).not.toMatch(/L5 PRO|5,000,000|54,281|54%/);
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => session.setDraft("작성 중인 질문이에요"));
    navigation.search = "aiOrigin=%2Fmenu%2Fnotifications";
    await render("member-a", 1, false, "member-a:server-render-1", "page");
    const updated = host.querySelector('[aria-label="현재 화면 도움"]');
    expect(updated?.textContent).toContain("알림 설정 도움");
    expect(
      Array.from(updated?.querySelectorAll("a") ?? []).map((link) =>
        link.getAttribute("href"),
      ),
    ).toEqual(["/menu/notifications", "/notifications"]);
    expect(session.draft).toBe("작성 중인 질문이에요");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adapts the genuine page scene to Light without claiming a separate Light source", async () => {
    document.documentElement.dataset.theme = "light";
    try {
      await render("member-a", 1, false, "member-a:server-render-1", "page");
      const scene = host.querySelector(
        'img[src="/brand/scenes/ai-partner-hero/ai-partner-hero-1280-v1.webp"]',
      );
      expect(scene?.getAttribute("alt")).toBe("");
      expect(scene?.getAttribute("aria-hidden")).toBe("true");
      expect(scene?.getAttribute("width")).toBe("1983");
      expect(scene?.getAttribute("height")).toBe("793");
      expect(host.querySelector("textarea")?.disabled).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  it("keeps the approved face in the dock instead of substituting the page robot", async () => {
    await render();
    expect(
      host
        .querySelector(
          'img[src="/brand/mascot/putduk-ai-help-face-256-v1.webp"]',
        )
        ?.getAttribute("alt"),
    ).toBe("");
    expect(host.querySelector("[data-ai-partner-hero]")).toBeNull();
    expect(host.querySelector('[aria-label="빠른 질문"]')).toBeNull();
  });

  it("binds server facts to the verified ready owner and hides them through an auth change", async () => {
    const facts = {
      ownerUserId: "member-a",
      displayName: "검증된 A",
      rankName: "확인된 등급",
      availableKrwLabel: "12,345원",
    };
    browserAuth.autoInitial = false;
    await render(
      "member-a",
      1,
      false,
      "member-a:server-render-1",
      "page",
      facts,
    );
    expect(session.ownerStatus).toBe("checking");
    expect(host.textContent).not.toMatch(/검증된 A|확인된 등급|12,345원/);
    await act(async () => emitAuth("INITIAL_SESSION", "member-a"));
    expect(session.ownerStatus).toBe("ready");
    expect(session.ownerUserId).toBe("member-a");
    expect(host.textContent).toContain("검증된 A님");
    expect(host.textContent).toContain("12,345원");
    await act(async () => emitAuth("SIGNED_IN", "member-b"));
    expect(session.ownerStatus).toBe("refreshing");
    expect(host.textContent).not.toMatch(/검증된 A|확인된 등급|12,345원/);
    browserAuth.autoInitial = true;
    await render(
      "member-b",
      1,
      false,
      "member-b:server-render-1",
      "page",
      facts,
    );
    expect(session.ownerStatus).toBe("ready");
    expect(session.ownerUserId).toBe("member-b");
    expect(host.textContent).not.toMatch(/검증된 A|확인된 등급|12,345원/);
    expect(
      host.querySelector('[data-ai-account-facts] [role="status"]'),
    ).not.toBeNull();
  });

  it("fills all five real quick questions only as drafts with composer focus", async () => {
    navigation.pathname = "/ai";
    await render("member-a", 1, false, "member-a:server-render-1", "page");
    const group = host.querySelector('[aria-label="빠른 질문"]')!;
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons).toHaveLength(5);
    const questions = [
      "내 채굴 상태 알려줘",
      "내 PUTDUK START 체험 상태 알려줘",
      "첫 출금은 어떻게 준비하나요?",
      "이벤트 참여 방법 알려줘",
      "고객지원은 어디에 있나요?",
    ];
    for (let index = 0; index < buttons.length; index++) {
      await act(async () => buttons[index]!.click());
      expect(session.draft).toBe(questions[index]);
      expect(document.activeElement).toBe(host.querySelector("textarea"));
      expect(session.messages).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    }
    await act(async () => emitAuth("SIGNED_OUT", null));
    expect(
      Array.from(group.querySelectorAll("button")).every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });

  it("recovers a failed decorative scene without losing or submitting the real draft", async () => {
    await render("member-a", 1, false, "member-a:server-render-1", "page");
    await act(async () => session.setDraft("작성한 질문을 유지해 주세요"));
    const scene = () => host.querySelector("[data-ai-partner-hero] img")!;
    await act(async () => scene().dispatchEvent(new Event("error")));
    expect(
      host
        .querySelector("[data-ai-partner-hero]")
        ?.getAttribute("data-ai-art-state"),
    ).toBe("webp");
    await act(async () => scene().dispatchEvent(new Event("error")));
    expect(
      host
        .querySelector("[data-ai-partner-hero]")
        ?.getAttribute("data-ai-art-state"),
    ).toBe("unavailable");
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "배경 다시 불러오기",
    )!;
    await act(async () => retry.click());
    expect(scene().getAttribute("src")).toContain("?ai-art-retry=1");
    expect(host.querySelector("textarea")?.value).toBe(
      "작성한 질문을 유지해 주세요",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts a contextual suggestion in the draft and focuses it without sending", async () => {
    navigation.pathname = "/wallet";
    await render();
    const suggestion = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("자산 화면 도움"),
    );
    expect(suggestion).toBeDefined();
    await act(async () => suggestion?.click());
    expect(session.draft).toBe("사용 가능 금액과 보류 금액은 무슨 뜻인가요?");
    expect(document.activeElement).toBe(host.querySelector("textarea"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.messages).toEqual([]);
    navigation.pathname = "/menu/notifications";
    await render();
    expect(host.textContent).toContain("알림 설정 도움");
    expect(session.draft).toBe("사용 가능 금액과 보류 금액은 무슨 뜻인가요?");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves an offline draft and requires explicit submit after reconnection", async () => {
    let online = true;
    vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
    fetchMock.mockResolvedValue(immediateAnswer().response);
    await render();
    await act(async () => {
      session.setDraft("알림 설정은 어디에 있나요?");
      online = false;
      window.dispatchEvent(new Event("offline"));
    });
    expect(session.online).toBe(false);
    expect(host.textContent).toContain("인터넷 연결이 끊겼어요");
    expect(host.querySelector("textarea")?.disabled).toBe(false);
    const send = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "질문 보내기",
    );
    expect(send?.disabled).toBe(true);
    await act(async () => session.submit());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.draft).toBe("알림 설정은 어디에 있나요?");
    await act(async () => {
      online = true;
      window.dispatchEvent(new Event("online"));
    });
    expect(session.online).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.draft).toBe("알림 설정은 어디에 있나요?");
    await act(async () => session.submit());
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves wide-view origin help and displays only registered completion links", async () => {
    navigation.pathname = "/ai";
    navigation.search = "aiOrigin=%2Fmenu%2Fnotifications&token=secret";
    const stream = responseStream();
    stream.send({ type: "ready", requestId, source: "static" });
    stream.send({ type: "delta", text: "알림 설정에서 선택해 주세요." });
    stream.send({
      type: "done",
      requestId,
      knowledgeVersion: "v1",
      helpTopic: "notification_settings",
    });
    stream.close();
    fetchMock.mockResolvedValue(stream.response);
    await render();
    await act(async () => {
      session.setDraft("이 화면은 어떻게 쓰나요?");
      await session.submit({
        screenContext: { currentRoute: "/menu/notifications" },
      });
    });
    expect(host.textContent).toContain("알림 설정 도움");
    expect(session.messages.at(-1)?.helpTopic).toBe("notification_settings");
    expect(
      Array.from(host.querySelectorAll('nav[aria-label="관련 화면"] a')).map(
        (link) => link.getAttribute("href"),
      ),
    ).toEqual(["/menu/notifications", "/notifications"]);
    expect(host.querySelector('a[href*="secret"]')).toBeNull();
  });

  it("keeps a rate-limited question recoverable without automatic retry", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "AI_RATE_LIMITED",
            message: "요청이 많아요. 잠시 후 다시 질문해 주세요.",
          },
        },
        { status: 429 },
      ),
    );
    await render();
    await act(async () => {
      session.setDraft("알림 설정은 어디에 있나요?");
      await session.submit();
    });
    expect(session.messages.at(-1)).toMatchObject({
      state: "error",
      failure: { code: "AI_RATE_LIMITED" },
    });
    expect(host.textContent).toContain("요청 제한");
    const id = session.messages.at(-1)!.id;
    await act(async () => {
      expect(session.restoreQuestion(id)).toBe(true);
    });
    expect(session.draft).toBe("알림 설정은 어디에 있나요?");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("discards a delayed automatic transcript restore after account invalidation", async () => {
    historyReads.enabled = true;
    historyReads.list.mockResolvedValue({
      ok: true,
      conversations: [{ id: "conversation-a", title: "A history" }],
    });
    const read = deferred<unknown>();
    historyReads.read.mockReturnValueOnce(read.promise);
    await render();
    expect(historyReads.read).toHaveBeenCalledOnce();
    await act(async () => emitAuth("SIGNED_IN", "member-b"));
    await act(async () =>
      read.resolve({
        ok: true,
        messages: [
          {
            id: "old",
            authorRole: "MEMBER",
            bodyText: "A PRIVATE",
            position: 1,
          },
        ],
        hasEarlierMessages: false,
      }),
    );
    expect(session.messages).toEqual([]);
    expect(session.activeConversationId).toBeNull();
    expect(host.textContent).not.toContain("A PRIVATE");
  });

  it("discards a delayed opened transcript across replacement of the auth observer", async () => {
    historyReads.enabled = true;
    const read = deferred<unknown>();
    historyReads.read.mockReturnValueOnce(read.promise);
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = session.openConversation("conversation-old");
    });
    browserAuth.refresh = vi.fn();
    await render();
    expect(browserAuth.unsubscribes[0]).toHaveBeenCalledOnce();
    expect(session.ownerStatus).toBe("ready");
    await act(async () => {
      read.resolve({
        ok: true,
        messages: [
          {
            id: "old",
            authorRole: "MEMBER",
            bodyText: "OLD OBSERVER READ",
            position: 1,
          },
        ],
        hasEarlierMessages: false,
      });
      await opening;
    });
    expect(session.messages).toEqual([]);
    expect(session.activeConversationId).toBeNull();
  });

  it("reloads history after a failed list read through the recovery control", async () => {
    historyReads.enabled = true;
    historyReads.list.mockRejectedValueOnce(new Error("offline"));
    await render();
    expect(session.historyStatus).toBe("unavailable");
    historyReads.list.mockResolvedValue({
      ok: true,
      conversations: [
        {
          id: "conversation-a",
          title: "Recovered",
          updatedAt: "2026-10-06T00:00:00Z",
        },
      ],
    });
    historyReads.read.mockResolvedValue({
      ok: true,
      messages: [
        {
          id: "recovered",
          authorRole: "MEMBER",
          bodyText: "RECOVERED HISTORY",
          position: 1,
        },
      ],
      hasEarlierMessages: false,
    });
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "다시 불러오기",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(session.historyStatus).toBe("ready");
    expect(host.textContent).toContain("RECOVERED HISTORY");
  });

  it("retries the failed selected transcript rather than silently retaining another conversation", async () => {
    historyReads.enabled = true;
    await render();
    historyReads.read.mockResolvedValueOnce({
      ok: true,
      messages: [
        { id: "a", authorRole: "MEMBER", bodyText: "A HISTORY", position: 1 },
      ],
      hasEarlierMessages: false,
    });
    await act(async () => session.openConversation("conversation-a"));
    historyReads.read.mockResolvedValueOnce({ ok: false });
    await act(async () => session.openConversation("conversation-b"));
    expect(session.historyStatus).toBe("unavailable");
    expect(session.activeConversationId).toBe("conversation-a");
    historyReads.read.mockResolvedValueOnce({
      ok: true,
      messages: [
        { id: "b", authorRole: "MEMBER", bodyText: "B HISTORY", position: 1 },
      ],
      hasEarlierMessages: false,
    });
    await act(async () => session.reloadHistory());
    expect(historyReads.read).toHaveBeenLastCalledWith(
      expect.anything(),
      "member-a",
      "conversation-b",
    );
    expect(session.activeConversationId).toBe("conversation-b");
    expect(session.historyStatus).toBe("ready");
    expect(host.textContent).toContain("B HISTORY");
  });

  it("does not report an owner mismatch as feedback already saved", async () => {
    historyReads.enabled = true;
    await render();
    await act(async () => session.openConversation("conversation-a"));
    fetchMock.mockResolvedValue(
      Response.json({ error: { code: "AI_SESSION_CHANGED" } }, { status: 409 }),
    );
    await act(async () => {
      expect(await session.sendFeedback("answer-a", "UP")).toBe("failed");
    });
    expect(session.ownerStatus).toBe("refreshing");
    expect(session.activeConversationId).toBeNull();
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
  });

  it("discards feedback receipts whose body arrives after owner invalidation", async () => {
    historyReads.enabled = true;
    await render();
    await act(async () => session.openConversation("conversation-a"));
    const body = deferred<unknown>();
    fetchMock.mockResolvedValue({
      status: 409,
      ok: false,
      json: () => body.promise,
    });
    let sending!: ReturnType<PutdukAiSession["sendFeedback"]>;
    await act(async () => {
      sending = session.sendFeedback("answer-a", "UP");
    });
    await act(async () => emitAuth("SIGNED_IN", "member-b"));
    await act(async () => {
      body.resolve({ error: { code: "AI_FEEDBACK_EXISTS" } });
      expect(await sending).toBe("failed");
    });
    expect(session.messages).toEqual([]);
  });

  it("discards a delayed opened transcript after an account change without relying on router refresh", async () => {
    historyReads.enabled = true;
    let resolveRead!: (value: unknown) => void;
    historyReads.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = session.openConversation("conversation-a");
    });
    await act(async () => emitAuth("SIGNED_IN", "member-b"));
    await act(async () => {
      resolveRead({
        ok: true,
        messages: [
          {
            id: "a-private",
            authorRole: "ASSISTANT",
            bodyText: "A PRIVATE BALANCE",
            position: 1,
          },
        ],
        hasEarlierMessages: false,
      });
      await opening;
    });
    expect(session.ownerStatus).toBe("refreshing");
    expect(session.messages).toEqual([]);
    expect(session.activeConversationId).toBeNull();
    expect(host.textContent).not.toContain("A PRIVATE BALANCE");
  });

  it("discards delayed history titles after sign-out", async () => {
    historyReads.enabled = true;
    let resolveList!: (value: unknown) => void;
    historyReads.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    await render();
    await act(async () => emitAuth("SIGNED_OUT", null));
    await act(async () =>
      resolveList({
        ok: true,
        conversations: [
          {
            id: "a-private",
            title: "A PRIVATE TITLE",
            updatedAt: "2026-10-06T00:00:00Z",
          },
        ],
      }),
    );
    expect(session.history).toEqual([]);
    expect(session.historyStatus).toBe("hidden");
    expect(historyReads.read).not.toHaveBeenCalled();
  });

  it("discards a pre-sign-out read even after the same owner is freshly verified", async () => {
    historyReads.enabled = true;
    let resolveRead!: (value: unknown) => void;
    historyReads.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = session.openConversation("conversation-old");
    });
    await act(async () => emitAuth("SIGNED_OUT", null));
    await act(async () => emitAuth("SIGNED_IN", "member-a"));
    await render("member-a", 1, true, "member-a:server-render-2");
    expect(session.ownerStatus).toBe("ready");
    await act(async () => {
      resolveRead({
        ok: true,
        messages: [
          {
            id: "old",
            authorRole: "ASSISTANT",
            bodyText: "OLD REQUEST",
            position: 1,
          },
        ],
        hasEarlierMessages: false,
      });
      await opening;
    });
    expect(session.messages).toEqual([]);
    expect(session.activeConversationId).toBeNull();
  });

  it("does not replace a new conversation with a delayed opened transcript", async () => {
    historyReads.enabled = true;
    let resolveRead!: (value: unknown) => void;
    historyReads.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    await render();
    let opening!: Promise<void>;
    await act(async () => {
      opening = session.openConversation("conversation-old");
      session.startNewConversation();
    });
    await act(async () => {
      resolveRead({
        ok: true,
        messages: [
          {
            id: "old",
            authorRole: "MEMBER",
            bodyText: "OLD QUESTION",
            position: 1,
          },
        ],
        hasEarlierMessages: false,
      });
      await opening;
    });
    expect(session.messages).toEqual([]);
    expect(session.activeConversationId).toBeNull();
  });

  it("keeps restored tool failures retryable and labels successful tool answers as historical", async () => {
    historyReads.enabled = true;
    historyReads.read.mockResolvedValue({
      ok: true,
      hasEarlierMessages: true,
      messages: [
        {
          id: "question",
          authorRole: "MEMBER",
          bodyText: "내 지갑 잔액 얼마야?",
          position: 1,
        },
        {
          id: "failed",
          authorRole: "ASSISTANT",
          bodyText: "상태를 확인하지 못했어요.",
          position: 2,
          source: "tool",
          toolOutcome: "FAILED",
          recordedAt: "2026-10-06T00:00:00Z",
        },
      ],
    });
    await render();
    await act(async () => session.openConversation("conversation-a"));
    expect(session.messages[1]).toMatchObject({
      state: "error",
      historical: true,
      source: "tool",
    });
    expect(session.messages[1]?.grounding).toBeUndefined();
    expect(host.textContent).toContain("당시 조회 시각은 저장되지 않았어요.");
    expect(host.textContent).toContain("최근 대화 일부를 표시해요.");
    await act(async () => {
      expect(session.restoreQuestion("failed")).toBe(true);
    });
    expect(session.draft).toBe("내 지갑 잔액 얼마야?");
  });

  it("uses the server runtime auth tuple without browser build environment values", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", undefined);
    try {
      await render();
      expect(browserAuth.configurations).toEqual([
        {
          url: "http://127.0.0.1:58421",
          publishableKey: "sb_publishable_member_browser_fixture",
        },
      ]);
      expect(session.canSubmit).toBe(true);
      await render();
      expect(browserAuth.configurations).toHaveLength(1);
      expect(browserAuth.observers.size).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps submit closed until the browser's initial owner matches the server owner", async () => {
    browserAuth.autoInitial = false;
    await render();
    expect(session.ownerStatus).toBe("checking");
    expect(session.canSubmit).toBe(false);
    expect(host.querySelector("textarea")?.disabled).toBe(true);
    await act(async () => {
      session.setDraft("확인 전에는 전송할 수 없는 질문");
      await session.submit();
    });
    expect(session.draft).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => emitAuth("INITIAL_SESSION", "member-a"));
    expect(session.canSubmit).toBe(true);
    expect(host.querySelector("textarea")?.disabled).toBe(false);
    expect(browserAuth.refresh).not.toHaveBeenCalled();
  });

  it("preserves the same owner's draft and live request on token refresh", async () => {
    const stream = responseStream();
    fetchMock.mockResolvedValue(stream.response);
    await render();
    const { turn } = await begin("내 기록을 확인해 주세요");
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    await act(async () => {
      session.setDraft("다음에 물어볼 질문");
      emitAuth("TOKEN_REFRESHED", "member-a");
    });
    expect(session.canSubmit).toBe(true);
    expect(session.pending).toBe(true);
    expect(session.messages).toHaveLength(2);
    expect(session.draft).toBe("다음에 물어볼 질문");
    expect(signal.aborted).toBe(false);
    expect(browserAuth.refresh).not.toHaveBeenCalled();
    await act(async () => {
      session.cancel();
      await turn;
    });
  });

  it("sends the server-verified presentation owner as a comparison header on every request", async () => {
    const ownerUserId = "b755a143-0dcb-47f6-8aee-0192a1a594b2";
    browserAuth.ownerId = ownerUserId;
    fetchMock.mockImplementation(async () => immediateAnswer().response);
    await render(ownerUserId);
    await act(async () => {
      session.setDraft("첫 번째 도움말 질문");
      await session.submit();
      session.setDraft("두 번째 도움말 질문");
      await session.submit();
    });
    const nextOwnerUserId = "c6a65b65-f28a-4159-a9b0-1a5da3409639";
    browserAuth.ownerId = nextOwnerUserId;
    await render(nextOwnerUserId);
    await act(async () => {
      session.setDraft("새 회원의 첫 번째 질문");
      await session.submit();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [index, [url, options]] of fetchMock.mock.calls.entries()) {
      expect(url).toBe("/api/v1/ai/chat");
      const request = options as RequestInit;
      expect(
        new Headers(request.headers).get(AI_PRESENTATION_OWNER_HEADER),
      ).toBe(index < 2 ? ownerUserId : nextOwnerUserId);
      expect(request.credentials).toBe("same-origin");
      expect(JSON.parse(request.body as string)).not.toHaveProperty(
        "ownerUserId",
      );
    }
  });

  it("purges a stale presentation on HTTP 409 and waits for a fresh initial session after a new server nonce", async () => {
    const ownerUserId = "b755a143-0dcb-47f6-8aee-0192a1a594b2";
    browserAuth.ownerId = ownerUserId;
    let resolveChanged!: (response: Response) => void;
    fetchMock
      .mockResolvedValueOnce(immediateAnswer("tool").response)
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveChanged = resolve)),
      );
    await render(ownerUserId);
    await act(async () => {
      session.setDraft("이전 회원의 기록 질문");
      await session.submit();
    });
    const oldQuestionId = session.messages.at(-1)!.id;
    const oldObserver = Array.from(browserAuth.observers)[0]!;
    const { turn } = await begin("현재 상태를 다시 확인해 주세요");
    const signal = (fetchMock.mock.calls[1]![1] as RequestInit).signal!;
    browserAuth.autoInitial = false;
    await act(async () => {
      session.setDraft("이전 회원의 개인 초안");
      resolveChanged(
        Response.json(
          {
            error: {
              code: "AI_SESSION_CHANGED",
              message: "로그인 상태가 바뀌었어요. 다시 확인해 주세요.",
            },
          },
          { status: 409 },
        ),
      );
      await turn;
    });
    expect(signal.aborted).toBe(true);
    expect(session.messages).toEqual([]);
    expect(session.draft).toBe("");
    expect(session.pending).toBe(false);
    expect(session.canSubmit).toBe(false);
    expect(session.ownerStatus).toBe("refreshing");
    expect(host.textContent).not.toContain("이전 회원");
    expect(host.textContent).not.toContain("내 기록 조회");
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
    expect(browserAuth.unsubscribes[0]).toHaveBeenCalledOnce();
    expect(browserAuth.observers.size).toBe(1);
    await act(async () => {
      expect(session.restoreQuestion(oldQuestionId)).toBe(false);
      session.setDraft("재확인 전에는 보내면 안 되는 질문");
      await session.submit();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(session.draft).toBe("");

    await render(ownerUserId, 1, true, `${ownerUserId}:server-render-2`);
    await act(async () => {
      oldObserver("INITIAL_SESSION", { user: { id: ownerUserId } });
      emitAuth("SIGNED_IN", ownerUserId);
      emitAuth("TOKEN_REFRESHED", ownerUserId);
      session.setDraft("오래된 관찰 정보로 보내려는 질문");
      await session.submit();
    });
    expect(session.canSubmit).toBe(false);
    expect(session.messages).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      emitAuth("INITIAL_SESSION", "c6a65b65-f28a-4159-a9b0-1a5da3409639");
      emitAuth("TOKEN_REFRESHED", ownerUserId);
    });
    expect(session.canSubmit).toBe(false);
    expect(session.messages).toEqual([]);
    await act(async () => emitAuth("INITIAL_SESSION", ownerUserId));
    expect(session.canSubmit).toBe(true);
    expect(session.messages).toEqual([]);
    expect(session.draft).toBe("");
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the cleared HTTP 409 session locked when fresh browser initial confirmation arrives before server re-verification", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: { code: "AI_SESSION_CHANGED" } }, { status: 409 }),
    );
    await render();
    await act(async () => {
      session.setDraft("계정 전환 응답을 받는 질문");
      await session.submit();
    });
    // The replacement observer has already emitted INITIAL_SESSION, but the
    // server nonce still belongs to the rejected presentation.
    expect(browserAuth.unsubscribes).toHaveLength(2);
    expect(session.canSubmit).toBe(false);
    expect(session.messages).toEqual([]);
    await act(async () => {
      emitAuth("TOKEN_REFRESHED", "member-a");
      session.setDraft("서버 재확인 전 질문");
      await session.submit();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    await render("member-a", 1, true, "member-a:server-render-2");
    expect(session.canSubmit).toBe(true);
    expect(session.messages).toEqual([]);
    expect(session.draft).toBe("");
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
  });

  it("closes a resubscription gap despite a new nonce and ignores callbacks from the disposed observer", async () => {
    fetchMock.mockResolvedValue(immediateAnswer().response);
    await render();
    await act(async () => {
      session.setDraft("이미 완료한 안내 질문");
      await session.submit();
      session.setDraft("보존할 미전송 초안");
    });
    const history = session.messages;
    const oldObserver = Array.from(browserAuth.observers)[0]!;
    browserAuth.autoInitial = false;
    browserAuth.refresh = vi.fn();
    const gapSubmit = vi.fn(() => {
      void session.submit();
      session.setDraft("구독 설정 순간의 초안");
    });
    browserAuth.onSubscribe = gapSubmit;
    await render("member-a", 1, true, "member-a:server-render-2");
    expect(gapSubmit).toHaveBeenCalledOnce();
    expect(browserAuth.unsubscribes[0]).toHaveBeenCalledOnce();
    expect(session.canSubmit).toBe(false);
    expect(session.ownerStatus).toBe("checking");
    await act(async () => {
      oldObserver("INITIAL_SESSION", { user: { id: "member-a" } });
      oldObserver("SIGNED_OUT", null);
      emitAuth("TOKEN_REFRESHED", "member-a");
      await session.submit();
      session.setDraft("재구독 중에는 수정할 수 없는 초안");
    });
    expect(session.canSubmit).toBe(false);
    expect(session.messages).toEqual(history);
    expect(session.draft).toBe("보존할 미전송 초안");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(browserAuth.refresh).not.toHaveBeenCalled();
    await act(async () => emitAuth("INITIAL_SESSION", "member-a"));
    expect(session.canSubmit).toBe(true);
    expect(session.messages).toEqual(history);
    expect(session.draft).toBe("보존할 미전송 초안");
  });

  it("finishes an interrupted live answer when its auth observer is replaced and preserves the matching owner's draft", async () => {
    const stream = responseStream();
    fetchMock.mockResolvedValue(stream.response);
    await render();
    const { turn } = await begin("인증 재확인 중인 답변 질문");
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    await act(async () => {
      stream.send({ type: "ready", requestId, source: "provider" });
      stream.send({ type: "delta", text: "끝까지 받지 못한 내용" });
      session.setDraft("다음에 보낼 미전송 초안");
      await Promise.resolve();
    });
    browserAuth.autoInitial = false;
    browserAuth.refresh = vi.fn();
    await render("member-a", 1, true, "member-a:server-render-2");
    await act(async () => turn);
    expect(signal.aborted).toBe(true);
    expect(stream.cancelled).toHaveBeenCalledOnce();
    expect(session.pending).toBe(false);
    expect(session.canSubmit).toBe(false);
    expect(session.messages.at(-1)).toMatchObject({
      state: "cancelled",
      text: "끝까지 받지 못한 내용",
      failure: { code: "AI_STREAM_INTERRUPTED", label: "답변 수신 중단" },
    });
    expect(session.messages.at(-1)?.grounding).toBeUndefined();
    expect(session.draft).toBe("다음에 보낼 미전송 초안");
    await act(async () => emitAuth("INITIAL_SESSION", "member-a"));
    expect(session.canSubmit).toBe(true);
    expect(session.pending).toBe(false);
    expect(session.draft).toBe("다음에 보낼 미전송 초안");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps ready history and draft across unrelated same-owner server verification", async () => {
    fetchMock.mockResolvedValue(immediateAnswer().response);
    await render();
    await act(async () => {
      session.setDraft("퍼뜩 안내를 설명해 주세요");
      await session.submit();
      session.setDraft("다음 질문의 미전송 초안");
    });
    const history = session.messages;
    await render("member-a", 1, true, "member-a:server-render-2");
    expect(session.canSubmit).toBe(true);
    expect(session.messages).toEqual(history);
    expect(session.draft).toBe("다음 질문의 미전송 초안");
    expect(browserAuth.unsubscribes).toHaveLength(1);
    expect(browserAuth.unsubscribes[0]).not.toHaveBeenCalled();
  });

  it("purges and blocks on account mismatch, then requires a fresh server verification to reopen the cleared owner", async () => {
    const stream = responseStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    await render();
    const { turn } = await begin("회원 A의 내 기록 질문");
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    await act(async () => {
      session.setDraft("회원 A의 초안");
      emitAuth("SIGNED_IN", "member-b");
      session.setDraft("오래된 화면에서 들어온 새 초안");
      await session.submit();
      await turn;
    });
    expect(signal.aborted).toBe(true);
    expect(session.canSubmit).toBe(false);
    expect(session.ownerStatus).toBe("refreshing");
    expect(session.messages).toEqual([]);
    expect(session.draft).toBe("");
    expect(session.pending).toBe(false);
    expect(host.textContent).not.toContain("회원 A");
    expect(host.querySelector("textarea")?.disabled).toBe(true);
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();

    await render("member-a", 1, true, "member-a:server-render-2");
    expect(session.canSubmit).toBe(false);
    await act(async () => emitAuth("TOKEN_REFRESHED", "member-b"));
    expect(session.canSubmit).toBe(false);
    await act(async () => emitAuth("SIGNED_IN", "member-a"));
    expect(session.canSubmit).toBe(true);
    expect(session.messages).toEqual([]);
    expect(session.draft).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not unlock a signed-out owner on browser login alone, but resumes after fresh same-owner server verification", async () => {
    fetchMock.mockResolvedValue(immediateAnswer().response);
    await render();
    await act(async () => {
      session.setDraft("회원 A에게만 보이는 질문");
      await session.submit();
      session.setDraft("회원 A의 초안");
      emitAuth("SIGNED_OUT", null);
    });
    expect(session.messages).toEqual([]);
    expect(session.draft).toBe("");
    expect(session.canSubmit).toBe(false);
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
    await act(async () => emitAuth("SIGNED_IN", "member-a"));
    expect(session.canSubmit).toBe(false);
    await act(async () => {
      session.setDraft("서버 확인 전 새 질문");
      await session.submit();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    await render("member-a", 1, true, "member-a:server-render-2");
    expect(session.canSubmit).toBe(true);
    expect(session.ownerStatus).toBe("ready");
    expect(session.messages).toEqual([]);
    expect(session.draft).toBe("");
  });

  it("rejects initial mismatch and ignores disposed subscriptions after the server changes owner or unmounts", async () => {
    browserAuth.ownerId = "member-b";
    await render();
    expect(session.canSubmit).toBe(false);
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
    const oldObserver = Array.from(browserAuth.observers)[0]!;
    await render("member-b");
    expect(session.canSubmit).toBe(true);
    expect(browserAuth.unsubscribes[0]).toHaveBeenCalledOnce();
    await act(async () => {
      session.setDraft("새 회원의 질문 초안");
      oldObserver("SIGNED_OUT", null);
    });
    expect(session.canSubmit).toBe(true);
    expect(session.draft).toBe("새 회원의 질문 초안");
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
    const currentObserver = Array.from(browserAuth.observers)[0]!;
    await act(async () => root.render(null));
    expect(browserAuth.unsubscribes[1]).toHaveBeenCalledOnce();
    currentObserver("SIGNED_OUT", null);
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
    expect(browserAuth.observers.size).toBe(0);
  });

  it("fails closed when the browser auth subscription cannot be created", async () => {
    browserAuth.createError = true;
    await render();
    expect(session.canSubmit).toBe(false);
    expect(session.ownerStatus).toBe("refreshing");
    expect(browserAuth.refresh).toHaveBeenCalledOnce();
    await act(async () => {
      session.setDraft("인증 관찰이 불가한 질문");
      await session.submit();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a draft and in-flight answer across route/presentation unmount without re-sending", async () => {
    const stream = responseStream();
    fetchMock.mockResolvedValue(stream.response);
    await render();
    const { turn } = await begin("내 지갑 잔액을 확인해 줘");
    expect(host.querySelector("textarea")?.disabled).toBe(false);
    await act(async () => session.setDraft("다음에 묻고 싶은 내용"));
    expect(host.querySelector("textarea")?.value).toBe("다음에 묻고 싶은 내용");
    navigation.pathname = "/mining";
    await render("member-a", 0);
    expect(session.pending).toBe(true);
    expect(session.draft).toBe("다음에 묻고 싶은 내용");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(
      false,
    );
    await act(async () => {
      stream.send({ type: "ready", requestId, source: "tool" });
      stream.send({ type: "delta", text: "현재 확정 기록을 확인했어요." });
      stream.send({
        type: "done",
        requestId,
        knowledgeVersion: "server-v2",
        grounding: {
          source: "domain_tool",
          tool: "wallet.summary",
          asOf: "2026-10-03T02:00:00.000Z",
        },
      });
      stream.close();
      await turn;
    });
    await render();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(session.draft).toBe("다음에 묻고 싶은 내용");
    expect(session.messages.at(-1)).toMatchObject({
      source: "tool",
      state: "complete",
      knowledgeVersion: "server-v2",
      grounding: { tool: "wallet.summary" },
    });
    expect(host.textContent).toContain("내 기록 조회");
    expect(host.querySelector("time")?.dateTime).toBe(
      "2026-10-03T02:00:00.000Z",
    );
  });

  it("aborts and clears on owner change, and ignores a late response from the previous member", async () => {
    let resolveOld!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        }),
    );
    await render();
    const { turn } = await begin("회원 A의 지갑 질문");
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    await act(async () => session.setDraft("회원 A의 미전송 초안"));
    browserAuth.ownerId = "member-b";
    await render("member-b");
    expect(signal.aborted).toBe(true);
    expect(session.draft).toBe("");
    expect(session.messages).toEqual([]);
    expect(session.canSubmit).toBe(true);
    const late = immediateAnswer();
    await act(async () => {
      resolveOld(late.response);
      await turn;
    });
    expect(session.messages).toEqual([]);
    expect(host.textContent).not.toContain("회원 A");
    expect(late.cancelled).toHaveBeenCalledOnce();
  });

  it("aborts when the shared provider unmounts", async () => {
    const stream = responseStream();
    fetchMock.mockResolvedValue(stream.response);
    await render();
    const { turn } = await begin("채굴 상태를 알려줘");
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    await act(async () => {
      root.render(null);
      await Promise.resolve();
    });
    await turn;
    expect(signal.aborted).toBe(true);
    expect(stream.cancelled).toHaveBeenCalledOnce();
  });

  it("blocks duplicate submit, preserves partial text on stop, and restores the question without sending it", async () => {
    const stream = responseStream();
    fetchMock
      .mockResolvedValueOnce(stream.response)
      .mockResolvedValueOnce(immediateAnswer().response);
    await render();
    const { turn } = await begin("일반 도움말을 알려줘");
    await act(async () => {
      session.setDraft("겹친 질문");
      await session.submit();
      stream.send({ type: "ready", requestId, source: "provider" });
      stream.send({ type: "delta", text: "아직 끝나지 않은 내용" });
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => {
      session.cancel();
      await turn;
    });
    expect(session.messages.at(-1)).toMatchObject({
      state: "cancelled",
      text: "아직 끝나지 않은 내용",
      failure: { label: "답변 중단됨" },
    });
    const id = session.messages.at(-1)!.id;
    await act(async () => expect(session.restoreQuestion(id)).toBe(true));
    expect(session.draft).toBe("일반 도움말을 알려줘");
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => session.submit());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    ) as { clientMessageId: string };
    const retry = JSON.parse(
      (fetchMock.mock.calls[1]![1] as RequestInit).body as string,
    ) as { clientMessageId: string };
    expect(retry.clientMessageId).not.toBe(first.clientMessageId);
  });

  it("does not let a cancelled old fetch clear the next request's pending state", async () => {
    let resolveOld!: (response: Response) => void;
    const next = responseStream();
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce(next.response);
    await render();
    const old = await begin("첫 번째 질문이에요");
    await act(async () => session.cancel());
    const second = await begin("두 번째 질문이에요");
    await act(async () => {
      resolveOld(immediateAnswer().response);
      await old.turn;
    });
    expect(session.pending).toBe(true);
    expect(session.messages.at(-1)?.state).toBe("streaming");
    await act(async () => {
      next.send({ type: "ready", requestId, source: "static" });
      next.send({ type: "delta", text: "두 번째 답변" });
      next.send({ type: "done", requestId, knowledgeVersion: "v1" });
      next.close();
      await second.turn;
    });
    expect(session.pending).toBe(false);
    expect(session.messages.at(-1)?.text).toBe("두 번째 답변");
  });

  it("keeps incomplete text but does not invent a done receipt when the connection ends", async () => {
    const stream = responseStream();
    stream.send({ type: "ready", requestId, source: "provider" });
    stream.send({ type: "delta", text: "일부만 도착한 내용" });
    stream.close();
    fetchMock.mockResolvedValue(stream.response);
    await render();
    await act(async () => {
      session.setDraft("일반 내용을 설명해 줘");
      await session.submit();
    });
    expect(session.messages.at(-1)).toMatchObject({
      state: "error",
      text: "일부만 도착한 내용",
      failure: { code: "AI_STREAM_INTERRUPTED", label: "답변 수신 중단" },
    });
    expect(session.messages.at(-1)?.grounding).toBeUndefined();
    expect(session.pending).toBe(false);
  });

  it("marks actual fetch rejection as a connection failure and leaves retry under the member's control", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await render();
    await act(async () => {
      session.setDraft("지갑 사용 방법을 알려줘");
      await session.submit();
    });
    expect(session.messages.at(-1)).toMatchObject({
      state: "error",
      text: "",
      failure: { code: "AI_CONNECTION_FAILED", label: "연결 실패" },
    });
    expect(session.messages.at(-1)?.source).toBeUndefined();
    expect(session.messages.at(-1)?.grounding).toBeUndefined();
    expect(session.pending).toBe(false);
    await act(async () =>
      expect(session.restoreQuestion(session.messages.at(-1)!.id)).toBe(true),
    );
    expect(session.draft).toBe("지갑 사용 방법을 알려줘");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves a verified done receipt if stop is pressed during reader cleanup", async () => {
    const stream = responseStream();
    let finishCleanup!: () => void;
    stream.cancelled.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    fetchMock.mockResolvedValue(stream.response);
    await render();
    const { turn } = await begin("퍼뜩 이용 방법을 알려줘");
    await act(async () => {
      stream.send({ type: "ready", requestId, source: "static" });
      stream.send({ type: "delta", text: "완료된 안내예요." });
      stream.send({ type: "done", requestId, knowledgeVersion: "v1" });
      await Promise.resolve();
    });
    expect(session.messages.at(-1)?.state).toBe("complete");
    expect(session.pending).toBe(true);
    await act(async () => session.cancel());
    expect(session.pending).toBe(false);
    expect(session.messages.at(-1)).toMatchObject({
      state: "complete",
      requestId,
      text: "완료된 안내예요.",
    });
    expect(session.messages.at(-1)?.failure).toBeUndefined();
    await act(async () => {
      finishCleanup();
      await turn;
    });
    expect(session.messages.at(-1)?.state).toBe("complete");
  });

  it("shows actual static fallback with no fake provider or account grounding", async () => {
    fetchMock.mockResolvedValue(immediateAnswer("static").response);
    await render("member-a", 1, false);
    await act(async () => {
      session.setDraft("퍼뜩 이용 안내를 알려줘");
      await session.submit();
    });
    expect(host.textContent).toContain("일반 질문은 답변이 제한돼요");
    expect(host.textContent).toContain("퍼뜩 안내");
    expect(host.textContent).not.toContain("AI 도움말");
    expect(host.querySelector("time")).toBeNull();
    expect(session.messages.at(-1)?.source).toBe("static");
    expect(host.querySelector(".ai-message__thinking")).toBeNull();
  });

  it("labels owned tool failure correctly and restores the failed question from the recovery button", async () => {
    const stream = responseStream();
    stream.send({ type: "ready", requestId, source: "tool" });
    stream.send({
      type: "error",
      code: "AI_TOOL_UNAVAILABLE",
      message: "확인되지 않은 금액은 안내하지 않아요.",
    });
    stream.close();
    fetchMock.mockResolvedValue(stream.response);
    await render();
    await act(async () => {
      session.setDraft("오늘 채굴 보상 얼마야?");
      await session.submit();
    });
    expect(host.textContent).toContain("상태 확인 실패");
    expect(host.textContent).not.toContain("연결 실패");
    const recovery = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "다시 질문하기",
    )!;
    await act(async () => recovery.click());
    expect(host.querySelector("textarea")?.value).toBe(
      "오늘 채굴 보상 얼마야?",
    );
    expect(document.activeElement).toBe(host.querySelector("textarea"));
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses fresh path/query on submit, never the previous selected event or owner identity", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(immediateAnswer().response),
    );
    navigation.pathname = "/events/member-event";
    navigation.search =
      "selectedEvent=1fe5c6bf-1b1e-49b4-a8bd-c0ab925ac7ee&token=secret";
    await render();
    await act(async () => session.setDraft("여기서는 무엇을 할 수 있어?"));
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    navigation.pathname = "/wallet/withdraw";
    navigation.search =
      "selectedTransaction=98334dc6-3cad-40de-865e-c5824b1c405b&bankAccount=secret";
    await render();
    await act(async () => session.setDraft("이 화면은 어떻게 쓰나요?"));
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    const bodies = fetchMock.mock.calls.map(
      (call) => JSON.parse((call[1] as RequestInit).body as string) as object,
    );
    expect(bodies[0]).toMatchObject({
      screenContext: {
        currentRoute: "/events",
        selectedEvent: "1fe5c6bf-1b1e-49b4-a8bd-c0ab925ac7ee",
      },
    });
    expect(bodies[1]).toMatchObject({
      screenContext: {
        currentRoute: "/wallet/withdraw",
        selectedTransaction: "98334dc6-3cad-40de-865e-c5824b1c405b",
      },
    });
    expect(JSON.stringify(bodies[1])).not.toMatch(
      /selectedEvent|member-event|member-a|bankAccount|secret/,
    );
    expect(Object.keys(bodies[1]!)).toEqual([
      "clientMessageId",
      "question",
      "screenContext",
    ]);
  });

  it("uses unique labelled composers for shared presentations and announces status rather than each token", async () => {
    await render("member-a", 2);
    const composers = Array.from(host.querySelectorAll("textarea"));
    expect(composers).toHaveLength(2);
    expect(new Set(composers.map((composer) => composer.id)).size).toBe(2);
    for (const composer of composers)
      expect(
        Array.from(host.querySelectorAll("label")).some(
          (label) => label.htmlFor === composer.id,
        ),
      ).toBe(true);
    expect(host.querySelector('[role="log"]')?.getAttribute("aria-live")).toBe(
      "off",
    );
    expect(
      host.querySelector('[role="status"]')?.getAttribute("aria-live"),
    ).toBe("polite");
    await act(async () => session.setDraft("공유되는 한 개 초안"));
    expect(composers.map((composer) => composer.value)).toEqual([
      "공유되는 한 개 초안",
      "공유되는 한 개 초안",
    ]);
  });

  it.each([
    { code: "UNAUTHENTICATED", status: 401, label: "로그인 필요" },
    { code: "AI_RATE_LIMITED", status: 429, label: "요청 제한" },
    { code: "AI_PROVIDER_UNAVAILABLE", status: 503, label: "AI 응답 불가" },
  ])(
    "keeps $code distinct from a fabricated tool result",
    async ({ code, status, label }) => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code, message: "다시 확인해 주세요." } }),
          { status, headers: { "Content-Type": "application/json" } },
        ),
      );
      await render();
      await act(async () => {
        session.setDraft("확인할 내용을 질문해요");
        await session.submit();
      });
      expect(session.messages.at(-1)).toMatchObject({
        state: "error",
        failure: { code, label },
      });
      expect(session.messages.at(-1)?.source).toBeUndefined();
      expect(session.messages.at(-1)?.grounding).toBeUndefined();
    },
  );
});
