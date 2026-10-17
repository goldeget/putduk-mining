// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PutdukAiChat } from "@/components/product/putduk-ai-chat";
import type { PutdukAiSession } from "@/components/product/putduk-ai-session";

const fixture = vi.hoisted(() => ({ session: null as PutdukAiSession | null }));
vi.mock("@/components/product/putduk-ai-session", () => ({
  usePutdukAiSession: () => fixture.session,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ai",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => {
    const anchorProps = { ...props };
    delete anchorProps.prefetch;
    return createElement("a", anchorProps, children);
  },
}));
vi.mock("@/lib/analytics/client", () => ({
  trackAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}));

let root: Root;
let host: HTMLDivElement;

function answer(text: string) {
  return { id: "answer", role: "assistant", state: "streaming", text } as const;
}

async function render(messages = fixture.session!.messages) {
  fixture.session = { ...fixture.session!, messages };
  await act(async () => {
    root.render(createElement(PutdukAiChat, { surface: "page" }));
  });
}

function transcript() {
  return host.querySelector<HTMLDivElement>('[role="log"]')!;
}

function scrollMetrics(top: number) {
  const node = transcript();
  Object.defineProperties(node, {
    scrollHeight: { configurable: true, value: 2_000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, value: top, writable: true },
  });
  return node;
}

function button(text: string) {
  return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fixture.session = {
    ownerUserId: "local-owned-member",
    activeConversationId: "owned-conversation",
    canSubmit: true,
    draft: "출금 준비 방법 알려 주세요.",
    history: [
      { id: "earlier", title: "지난 질문", updatedAt: "2026-10-08T00:00:00Z" },
    ],
    historyStatus: "ready",
    historyHasEarlierMessages: false,
    historyListHasMore: false,
    historyListPageStatus: "idle",
    earlierMessagesStatus: "idle",
    knowledgeVersion: "local-test",
    messages: [answer("처음 읽는 답변")],
    pending: true,
    ownerStatus: "ready",
    online: true,
    providerConfigured: true,
    setDraft: vi.fn(),
    submit: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    restoreQuestion: vi.fn().mockReturnValue(true),
    startNewConversation: vi.fn(),
    openConversation: vi.fn().mockResolvedValue(undefined),
    reloadHistory: vi.fn().mockResolvedValue(undefined),
    loadMoreHistory: vi.fn().mockResolvedValue(undefined),
    loadEarlierMessages: vi.fn().mockResolvedValue(false),
    readTranscriptPosition: vi.fn().mockReturnValue(null),
    rememberTranscriptPosition: vi.fn(),
    sendFeedback: vi.fn().mockResolvedValue("saved"),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Member AI preserves reading position during long answers", () => {
  it("reserves a readable transcript when enlarged fixed content exceeds the viewport, and recalculates on content resize", async () => {
    const heights = {
      header: 240,
      rail: 80,
      notices: 160,
      composer: 220,
      control: 150,
    };
    const observed = new Set<Element>();
    const resizeCallbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(callback);
        }
        observe(element: Element) {
          observed.add(element);
        }
        disconnect = disconnect;
      },
    );
    let queuedResize: FrameRequestCallback | undefined;
    const cancelFrame = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queuedResize = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(cancelFrame);
    vi.stubGlobal("innerHeight", 900);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const height = this.matches("header")
          ? heights.header
          : this.matches("aside")
            ? heights.rail
            : this.matches('[role="note"]')
              ? heights.notices
              : this.matches("form")
                ? heights.composer
                : this.matches('[role="group"] button')
                  ? heights.control
                  : 0;
        return {
          height,
          top: this.matches("section.ai-chat") ? 172 : 0,
          width: 390,
          left: 0,
          right: 390,
          bottom: height,
          x: 0,
          y: 0,
          toJSON() {},
        };
      },
    );
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computedStyle(element);
      if (element.matches('[role="log"]')) {
        Object.defineProperties(style, {
          paddingTop: { value: "24px" },
          paddingBottom: { value: "24px" },
        });
      }
      if (element.matches("form"))
        Object.defineProperty(style, "marginTop", { value: "20px" });
      if (element.querySelector(':scope > div > [role="log"]'))
        Object.defineProperty(style, "paddingBottom", { value: "24px" });
      if (element.matches("section.ai-chat")) {
        Object.defineProperties(style, {
          borderTopWidth: { value: "1px" },
          borderBottomWidth: { value: "1px" },
        });
      }
      return style;
    });

    await render([]);
    const chat = host.querySelector<HTMLElement>("section.ai-chat")!;
    expect(chat.style.getPropertyValue("--ai-page-height")).toBe("716px");
    expect(chat.style.getPropertyValue("--ai-transcript-min-height")).toBe(
      "198px",
    );
    expect(chat.style.getPropertyValue("--ai-thread-min-height")).toBe("622px");
    expect(chat.style.getPropertyValue("--ai-page-min-height")).toBe("944px");
    for (const block of host.querySelectorAll(
      "header, aside, [role=note], form",
    ))
      expect(observed.has(block)).toBe(true);

    heights.header = 340;
    heights.composer = 320;
    heights.control = 200;
    await act(async () => {
      for (const callback of resizeCallbacks)
        callback([], {} as ResizeObserver);
      queuedResize?.(0);
      queuedResize = undefined;
    });
    expect(chat.style.getPropertyValue("--ai-transcript-min-height")).toBe(
      "248px",
    );
    expect(chat.style.getPropertyValue("--ai-page-min-height")).toBe("1194px");
    Object.defineProperty(transcript(), "scrollHeight", {
      configurable: true,
      value: 100_000,
    });
    await act(async () => {
      for (const callback of resizeCallbacks)
        callback([], {} as ResizeObserver);
      queuedResize?.(0);
      queuedResize = undefined;
    });
    expect(chat.style.getPropertyValue("--ai-page-min-height")).toBe("1194px");

    await act(async () => {
      for (const callback of resizeCallbacks)
        callback([], {} as ResizeObserver);
      root.unmount();
    });
    expect(disconnect).toHaveBeenCalled();
    expect(cancelFrame).toHaveBeenCalledWith(1);
    root = createRoot(host);
  });

  it("recalculates available height and compact layout when the visual viewport shrinks for the keyboard", async () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 900,
      offsetTop: 0,
    });
    vi.stubGlobal("visualViewport", viewport);
    let queuedResize: FrameRequestCallback | undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      queuedResize = callback;
      return 1;
    });
    await render([]);
    const chat = host.querySelector<HTMLElement>("section.ai-chat")!;
    expect(chat.dataset.aiCompact).toBe("false");
    expect(chat.style.getPropertyValue("--ai-page-height")).toBe("888px");
    const initialMinimum = chat.style.getPropertyValue("--ai-page-min-height");
    viewport.height = 400;
    viewport.offsetTop = 20;
    await act(async () => {
      viewport.dispatchEvent(new Event("resize"));
      queuedResize?.(0);
    });
    expect(chat.dataset.aiCompact).toBe("true");
    expect(chat.style.getPropertyValue("--ai-page-height")).toBe("408px");
    expect(chat.style.getPropertyValue("--ai-page-min-height")).toBe(
      initialMinimum,
    );
  });

  it("restores the same conversation reading position after closing and reopening the presentation", async () => {
    let saved: ReturnType<PutdukAiSession["readTranscriptPosition"]> = null;
    fixture.session!.readTranscriptPosition = vi.fn(() => saved);
    fixture.session!.rememberTranscriptPosition = vi.fn(
      (_surface, position) => {
        saved = position;
      },
    );
    await render();
    const node = scrollMetrics(250);
    await act(async () => node.dispatchEvent(new Event("scroll")));
    await act(async () => root.unmount());
    expect(saved).toMatchObject({
      conversationId: "owned-conversation",
      scrollTop: 250,
      followLatest: false,
    });
    root = createRoot(host);
    await render();
    expect(transcript().scrollTop).toBe(250);
    expect(button("최신 답변 보기")).toBeDefined();
  });

  it("preserves the viewport when older history is prepended instead of following the bottom", async () => {
    fixture.session!.pending = false;
    fixture.session!.historyHasEarlierMessages = true;
    fixture.session!.loadEarlierMessages = vi.fn().mockResolvedValue(true);
    await render();
    const node = scrollMetrics(250);
    await act(async () => button("이전 내용 더 보기")!.click());
    expect(fixture.session!.loadEarlierMessages).toHaveBeenCalledOnce();
    Object.defineProperty(node, "scrollHeight", {
      configurable: true,
      value: 2_600,
    });
    await render([
      { ...answer("이전 답변"), id: "older" },
      answer("처음 읽는 답변"),
    ]);
    expect(node.scrollTop).toBe(850);
    expect(button("최신 답변 보기")).toBeDefined();
  });

  it("keeps the existing reading position and exposes retry when an older read fails", async () => {
    fixture.session!.pending = false;
    fixture.session!.historyHasEarlierMessages = true;
    await render();
    const node = scrollMetrics(250);
    await act(async () => button("이전 내용 더 보기")!.click());
    fixture.session!.earlierMessagesStatus = "error";
    await render();
    expect(node.scrollTop).toBe(250);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "읽던 내용은 그대로 남아 있어요.",
    );
    expect(button("이전 내용 다시 불러오기")).toBeDefined();
  });

  it("does not submit an unfinished Korean IME composition", async () => {
    await render();
    const input = host.querySelector("textarea")!;
    const form = host.querySelector("form")!;
    await act(async () => {
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(fixture.session!.submit).not.toHaveBeenCalled();
    await act(async () => {
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(fixture.session!.submit).toHaveBeenCalledOnce();
  });

  it("exposes bounded conversation paging and prevents another click while loading", async () => {
    fixture.session!.pending = false;
    fixture.session!.historyListHasMore = true;
    await render();
    await act(async () => button("이전 대화 더 보기")!.click());
    expect(fixture.session!.loadMoreHistory).toHaveBeenCalledOnce();
    fixture.session!.historyListPageStatus = "loading";
    await render();
    expect(button("불러오는 중…")!.disabled).toBe(true);
  });

  it("follows streaming when already at the latest answer", async () => {
    await render();
    const node = scrollMetrics(1_600);
    await act(async () => node.dispatchEvent(new Event("scroll")));
    await render([answer("처음 읽는 답변\n마지막까지 읽을 수 있는 답변")]);
    expect(node.scrollTop).toBe(2_000);
    expect(button("최신 답변 보기")).toBeUndefined();
  });

  it("does not force the reader down while streaming, and offers an explicit return", async () => {
    await render();
    const node = scrollMetrics(250);
    await act(async () => node.dispatchEvent(new Event("scroll")));
    await render([answer("처음 읽는 답변\n추가된 답변")]);
    expect(node.scrollTop).toBe(250);
    const latest = button("최신 답변 보기")!;
    expect(latest.getAttribute("aria-controls")).toBe(node.id);
    await act(async () => latest.click());
    expect(node.scrollTop).toBe(2_000);
    expect(button("최신 답변 보기")).toBeUndefined();
    await render([answer("처음 읽는 답변\n추가된 답변\n마지막 답변")]);
    expect(node.scrollTop).toBe(2_000);
  });

  it("a submitted follow-up starts following again without changing the question", async () => {
    await render();
    const node = scrollMetrics(100);
    await act(async () => node.dispatchEvent(new Event("scroll")));
    await act(async () => {
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(fixture.session!.submit).toHaveBeenCalledExactlyOnceWith({
      screenContext: { currentRoute: "/ai" },
    });
    await render([answer("후속 답변")]);
    expect(node.scrollTop).toBe(2_000);
    expect(button("최신 답변 보기")).toBeUndefined();
  });

  it("a new conversation does not inherit the old transcript scroll state", async () => {
    fixture.session!.pending = false;
    await render();
    const node = scrollMetrics(100);
    await act(async () => node.dispatchEvent(new Event("scroll")));
    await act(async () => button("새 대화")!.click());
    expect(fixture.session!.startNewConversation).toHaveBeenCalledOnce();
    await render([]);
    expect(node.scrollTop).toBe(0);
    await render([answer("새로운 첫 답변")]);
    expect(node.scrollTop).toBe(2_000);
    expect(button("최신 답변 보기")).toBeUndefined();
  });

  it("opening saved history restores follow without submitting another question", async () => {
    fixture.session!.pending = false;
    await render();
    const node = scrollMetrics(100);
    await act(async () => node.dispatchEvent(new Event("scroll")));
    await act(async () => button("지난 질문")!.click());
    expect(fixture.session!.openConversation).toHaveBeenCalledExactlyOnceWith(
      "earlier",
    );
    expect(fixture.session!.submit).not.toHaveBeenCalled();
    await render([answer("계정에 저장된 답변")]);
    expect(node.scrollTop).toBe(2_000);
  });

  it("shows the official helper name and offers only text conversation controls", async () => {
    await render([]);
    expect(host.querySelector("h1")?.textContent).toBe("퍼뜩 AI 도우미");
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).not.toContain("사진 생성");
    expect(
      host.querySelector('[data-testid="ai-continuity-notice"]')?.textContent,
    ).toBe("내 대화는 이 계정에서 다시 열 수 있어요.");
  });
});
