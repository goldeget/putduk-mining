// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  changed: null as ((event: string, session: null) => void) | null,
}));
vi.mock("next/link", () => ({
  default: (props: ComponentProps<"a">) => createElement("a", props),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createAdminBrowserClient: () => ({
    auth: {
      onAuthStateChange: (callback: typeof mocks.changed) => {
        mocks.changed = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

import { OperationsContext } from "@/components/assistant/operations-context";
import { OperatorDraftProvider } from "@/components/assistant/operator-draft-provider";
import { contextReportBuilder } from "@/lib/assistant/context";

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();
const userId = "0d460000-0000-4000-8000-000000000001";
function report() {
  const builder = contextReportBuilder("오늘 확인할 업무", new Date());
  builder.add(
    "FACT",
    "원화 입금 대기 3건입니다.",
    "/deposits/krw",
    "원화 입금 근거",
  );
  builder.add(
    "UNKNOWN",
    "외부 송금 완료는 이 조회만으로 판단할 수 없습니다.",
    "/withdrawals/krw-bank",
    "출금 근거",
  );
  return builder.finish();
}
function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { data }
        : { error: { message: "조회 기록을 남기지 못했습니다." } },
    ),
    { status },
  );
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  )!;
}
async function click(node: HTMLElement) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
async function select(topic: string) {
  await act(async () => {
    const input = host.querySelector<HTMLSelectElement>(
      "#assistant-context-topic",
    )!;
    input.value = topic;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function fill(query: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(
      "#assistant-member-query",
    )!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        OperatorDraftProvider,
        {
          userId,
          publicConfig: {
            url: "http://127.0.0.1:54321",
            publishableKey: "test-public-key",
          },
        },
        createElement(OperationsContext),
      ),
    ),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("session-bound operational explanations", () => {
  it("groups repeated evidence links while retaining every point, distinct sources and classification boundaries", async () => {
    const builder = contextReportBuilder("근거별 설명", new Date());
    builder.add(
      "FACT",
      "첫 입금 신청이 있습니다.",
      "/deposits/krw",
      "입금 근거",
    );
    builder.add(
      "FACT",
      "두 번째 입금 신청이 있습니다.",
      "/deposits/krw",
      "입금 근거",
    );
    builder.add(
      "FACT",
      "같은 화면에서 반영 기록을 확인합니다.",
      "/deposits/krw",
      "반영 기록",
    );
    builder.add(
      "FACT",
      "다른 입금 화면에도 신청이 있습니다.",
      "/deposits/usdt",
      "입금 근거",
    );
    builder.add(
      "UNKNOWN",
      "외부 입금 진위는 확인하지 못했습니다.",
      "/deposits/krw",
      "입금 근거",
    );
    fetchMock.mockResolvedValue(response(builder.finish()));
    await click(button("기록 확인"));
    const facts = host.querySelector('section[aria-label="확인된 사실"]')!;
    const unknowns = host.querySelector('section[aria-label="확인 불가"]')!;
    expect(facts.querySelectorAll("li")).toHaveLength(4);
    expect(facts.querySelectorAll("a")).toHaveLength(3);
    const shared = facts.querySelector('a[href="/deposits/krw"]')!;
    expect(shared.parentElement!.querySelectorAll("li")).toHaveLength(2);
    expect(shared.parentElement!.textContent).toContain("첫 입금 신청");
    expect(shared.parentElement!.textContent).toContain("두 번째 입금 신청");
    expect(facts.querySelector('a[href="/deposits/usdt"]')).not.toBeNull();
    expect(facts.textContent).toContain("반영 기록 →");
    expect(unknowns.querySelector('a[href="/deposits/krw"]')).not.toBeNull();
    expect(unknowns.textContent).toContain("진위는 확인하지 못했습니다");
    expect(host.querySelectorAll("h4")).toHaveLength(4);
  });
  it("fetches only after explicit request and renders classifications, observation and safe source links", async () => {
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(response(report()));
    await click(button("기록 확인"));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/admin/assistant/context");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
    });
    for (const label of [
      "확인된 사실",
      "가능성",
      "권장 행동",
      "확인 불가",
      "조회 시각",
    ])
      expect(host.textContent).toContain(label);
    expect(host.querySelector('a[href="/deposits/krw"]')).not.toBeNull();
    expect(host.textContent).toContain("3건");
    expect(host.textContent).not.toMatch(/승인 완료|송금 완료했습니다/);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it("discards old reports and late responses when the selected work changes", async () => {
    fetchMock.mockResolvedValueOnce(response(report()));
    await click(button("기록 확인"));
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    await click(button("다시 확인"));
    await select("jobs");
    await act(async () => finish(response(report())));
    expect(host.querySelector('[aria-label="운영 기록 설명"]')).toBeNull();
    expect(host.textContent).not.toContain("3건");
  });
  it("hides prior owner reports and rejects in-flight responses on a real provider sign-out event", async () => {
    fetchMock.mockResolvedValueOnce(response(report()));
    await click(button("기록 확인"));
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    await click(button("다시 확인"));
    await act(async () => mocks.changed?.("SIGNED_OUT", null));
    await act(async () => finish(response(report())));
    expect(host.querySelector('[aria-label="운영 기록 설명"]')).toBeNull();
  });
  it.each(["offline", "pagehide"])(
    "clears sensitive explanation memory and prevents an old response restoring it on %s",
    async (event) => {
      fetchMock.mockResolvedValueOnce(response(report()));
      await click(button("기록 확인"));
      let finish!: (value: Response) => void;
      fetchMock.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
      );
      await click(button("다시 확인"));
      await act(async () => window.dispatchEvent(new Event(event)));
      await act(async () => finish(response(report())));
      expect(host.querySelector('[aria-label="운영 기록 설명"]')).toBeNull();
      expect(host.textContent).toContain("연결이 끊겨 조회 기록을 지웠습니다");
    },
  );
  it("shows a real failure without false facts and supports a fresh explicit retry", async () => {
    fetchMock.mockResolvedValueOnce(response(null, 503));
    await click(button("기록 확인"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "조회 기록을 남기지 못했습니다",
    );
    expect(host.querySelector('[aria-label="운영 기록 설명"]')).toBeNull();
    fetchMock.mockResolvedValueOnce(response(report()));
    await click(button("기록 확인"));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("3건");
  });
  it("rejects an unsafe source URL rather than displaying a link from a malformed response", async () => {
    const invalid = report();
    invalid.sections[0]!.points[0]!.source.href = "javascript:alert(1)";
    fetchMock.mockResolvedValueOnce(response(invalid));
    await click(button("기록 확인"));
    expect(host.querySelector('[aria-label="운영 기록 설명"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("uses the existing masked search, selects a member without UUID typing, and sends only the selected identifier for context", async () => {
    await select("member");
    expect(button("기록 확인").disabled).toBe(true);
    await fill("010-1234-5678");
    fetchMock.mockResolvedValueOnce(
      response({
        members: [
          { userId, name: "홍*동", loginId: "pu***er", phone: "•••• 5678" },
        ],
        hasMore: false,
      }),
    );
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/v1/admin/members/search");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      query: "010-1234-5678",
    });
    const choice = host.querySelector<HTMLButtonElement>(
      '[aria-label="설명할 회원 선택"] button',
    )!;
    expect(choice.textContent).not.toContain(userId);
    expect(choice.textContent).not.toContain("010-1234-5678");
    await click(choice);
    fetchMock.mockResolvedValueOnce(response(report()));
    await click(button("기록 확인"));
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
      topic: "member",
      userId,
    });
    await fill("다른 회원");
    expect(host.querySelector('[aria-label="운영 기록 설명"]')).toBeNull();
    expect(button("기록 확인").disabled).toBe(true);
  });
  it("expires recorded explanations rather than leaving historical facts labelled current", async () => {
    fetchMock.mockResolvedValueOnce(response(report()));
    await click(button("기록 확인"));
    await act(async () => vi.advanceTimersByTimeAsync(300_001));
    expect(host.querySelector('[aria-label="운영 기록 설명"]')).toBeNull();
    expect(host.textContent).toContain("조회 시간이 지나");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
