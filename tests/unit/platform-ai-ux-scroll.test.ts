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
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
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
