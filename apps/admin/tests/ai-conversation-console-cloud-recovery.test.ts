// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiConversationConsole } from "../app/(control)/ai-conversations/conversation-console";

const memberA = "10000000-0000-4000-8000-000000000001";
const memberB = "10000000-0000-4000-8000-000000000002";
const conversationA = "20000000-0000-4000-8000-000000000001";
const conversationB = "20000000-0000-4000-8000-000000000002";
const stamp = "2026-10-09T00:00:00Z";
function conversation(id: string, userId: string, title: string) {
  return { id, userId, title, createdAt: stamp, updatedAt: stamp };
}
const rowA = conversation(conversationA, memberA, "첫 번째 상담");
const rowB = conversation(conversationB, memberB, "두 번째 상담");
function response(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}
function transcript(id: string, userId: string) {
  return {
    conversationId: id,
    userId,
    messages: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        authorRole: "MEMBER",
        bodyText: "회원이 보낸 원본 질문",
        position: 1,
        createdAt: stamp,
        clientMessageId: null,
      },
    ],
    requests: [],
    nextPosition: null,
  };
}

let container: HTMLDivElement;
let root: Root;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(createElement(AiConversationConsole)));
}
function button(text: string) {
  const found = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (!found) throw new Error("Missing button: " + text);
  return found;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function sent(index: number) {
  return JSON.parse(fetcher.mock.calls[index]![1].body);
}

describe("Cloud admin conversation overview recovery", () => {
  it("loads the audited overview and binds messages to the selected row owner", async () => {
    fetcher
      .mockImplementationOnce(() =>
        response({ conversations: [rowA, rowB], nextCursor: null }),
      )
      .mockImplementationOnce(() =>
        response(transcript(conversationB, memberB)),
      );
    await mount();
    expect(fetcher.mock.calls[0]![0]).toBe("/api/ai/conversations");
    expect(sent(0)).toEqual({ operation: "LIST", limit: 25 });
    expect(fetcher.mock.calls[0]![1].cache).toBe("no-store");
    expect(container.textContent).toContain("조회 대상: 전체 회원");
    await click("두 번째 상담");
    expect(sent(1)).toEqual({
      operation: "MESSAGES",
      userId: memberB,
      conversationId: conversationB,
      afterPosition: 0,
      limit: 100,
    });
    expect(container.textContent).toContain("회원이 보낸 원본 질문");
  });

  it("returns from a selected member to the explicit all-member overview", async () => {
    fetcher
      .mockImplementationOnce(() =>
        response({ conversations: [rowA], nextCursor: null }),
      )
      .mockImplementationOnce(() =>
        response({
          members: [
            {
              userId: memberA,
              name: "김*원",
              loginId: "ki***",
              phone: "•••• 1234",
            },
          ],
          hasMore: false,
        }),
      )
      .mockImplementationOnce(() =>
        response({ conversations: [rowA], nextCursor: null }),
      )
      .mockImplementationOnce(() =>
        response({ conversations: [rowB], nextCursor: null }),
      );
    await mount();
    const input = container.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "김회원");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(sent(1)).toEqual({ operation: "SEARCH", query: "김회원" });
    await click("김*원");
    expect(sent(2).userId).toBe(memberA);
    expect(container.textContent).toContain("조회 대상: 선택한 회원");
    await click("전체 회원 보기");
    expect(sent(3)).toEqual({ operation: "LIST", limit: 25 });
    expect(container.textContent).toContain("두 번째 상담");
    expect(container.textContent).not.toContain("김*원");
    expect(container.textContent).toContain("조회 대상: 전체 회원");
  });

  it("paginates the overview without duplicating conversation rows", async () => {
    const cursor = { updatedAt: stamp, id: conversationA };
    fetcher
      .mockImplementationOnce(() =>
        response({ conversations: [rowA], nextCursor: cursor }),
      )
      .mockImplementationOnce(() =>
        response({ conversations: [rowA, rowB], nextCursor: null }),
      );
    await mount();
    await click("이전 대화 더 보기");
    expect(sent(1)).toEqual({ operation: "LIST", limit: 25, cursor });
    const list = container.querySelector('[aria-label="대화 목록"]')!;
    expect(list.querySelectorAll("button")).toHaveLength(2);
    expect(list.textContent?.match(/첫 번째 상담/g)).toHaveLength(1);
  });

  it("keeps pagination bound to the applied filters until a new search is submitted", async () => {
    const cursor = { updatedAt: stamp, id: conversationA };
    fetcher.mockImplementation(() =>
      response({ conversations: [rowA], nextCursor: cursor }),
    );
    await mount();
    const statusInput = container.querySelector("select")!;
    await act(async () => {
      statusInput.value = "SUCCEEDED";
      statusInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("이전 대화 더 보기");
    expect(sent(1)).toEqual({ operation: "LIST", limit: 25, cursor });
    await act(async () => {
      container
        .querySelectorAll("form")[1]!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(sent(2)).toEqual({
      operation: "LIST",
      limit: 25,
      status: "SUCCEEDED",
    });
    await act(async () => {
      statusInput.value = "FAILED";
      statusInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("이전 대화 더 보기");
    expect(sent(3)).toEqual({
      operation: "LIST",
      limit: 25,
      status: "SUCCEEDED",
      cursor,
    });
  });

  it("clears private records after a denied refresh, including non-JSON denial", async () => {
    fetcher
      .mockImplementationOnce(() =>
        response({
          conversations: [rowA],
          nextCursor: { updatedAt: stamp, id: conversationA },
        }),
      )
      .mockImplementationOnce(() =>
        response(transcript(conversationA, memberA)),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(new Response("Forbidden", { status: 403 })),
      );
    await mount();
    await click("첫 번째 상담");
    expect(container.textContent).toContain("회원이 보낸 원본 질문");
    await click("이전 대화 더 보기");
    expect(container.textContent).not.toContain("회원이 보낸 원본 질문");
    expect(container.textContent).not.toContain("첫 번째 상담");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
