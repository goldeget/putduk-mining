// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NotificationBell } from "../../components/workroom-app/notification-bell";
import {
  NotificationInbox,
  notificationRoute,
} from "../../components/workroom-app/notification-inbox";
import {
  mergeSupportDetail,
  mergeSupportPage,
} from "../../components/workroom-app/pagination";
import type { SupportPage } from "../../lib/workroom-app/contract";

let root: Root;
let host: HTMLDivElement;
let visibility = "visible";
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  visibility = "visible";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const ok = () =>
  Response.json({ data: { items: [], unreadCount: 96, nextCursor: null } });
describe("server-backed visible notification bell", () => {
  it("renders actual whole-inbox unread count and polls only in the visible tab", async () => {
    const fetcher = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(createElement(NotificationBell)));
    expect(host.querySelector("a")?.getAttribute("aria-label")).toBe(
      "알림, 미확인 96개",
    );
    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(45000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    visibility = "visible";
    fetcher.mockResolvedValue(ok());
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    });
  });
  it("does not display an invented zero and removes stale private count on session denial", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(createElement(NotificationBell)));
    expect(host.querySelector("a")?.getAttribute("aria-label")).toBe(
      "알림함 열기",
    );
    await act(async () => resolve(ok()));
    expect(host.textContent).toContain("96");
    fetcher.mockResolvedValue(Response.json({ error: {} }, { status: 403 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(host.textContent).not.toContain("96");
    expect(host.querySelector("a")?.getAttribute("title")).toBe(
      "알림 수를 확인하지 못했어요",
    );
  });
});

describe("live inbox pagination", () => {
  const id = (value: number) =>
    `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
  const notification = (value: number) => ({
    id: id(value),
    type: "SUPPORT",
    title: `Notice ${value}`,
    body: "Body",
    route: "/notifications",
    createdAt: `2026-11-13T00:00:${String(value).padStart(2, "0")}Z`,
    readAt: null,
  });
  it("retains displaced first-page notifications after loading older rows and polling", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            items: [notification(3), notification(2)],
            unreadCount: 3,
            nextCursor: id(2),
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: { items: [notification(1)], unreadCount: 3, nextCursor: null },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: {
            items: [notification(4), notification(3)],
            unreadCount: 4,
            nextCursor: id(3),
          },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(createElement(NotificationInbox)));
    const more = host.querySelector(
      "button[class*='more']",
    ) as HTMLButtonElement;
    await act(async () => more.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(
      [...host.querySelectorAll("article h2")].map((node) => node.textContent),
    ).toEqual(["Notice 4", "Notice 3", "Notice 2", "Notice 1"]);
    expect(host.querySelector("button[class*='more']")).toBeNull();
  });
  it("preserves displaced conversation messages while taking current server status", () => {
    const message = (value: number) => ({
      id: id(value),
      threadId: id(9),
      senderRole: "MEMBER" as const,
      body: `Message ${value}`,
      createdAt: notification(value).createdAt,
    });
    const thread = {
      id: id(9),
      memberId: id(8),
      memberLoginId: null,
      memberName: "Member",
      status: "OPEN" as const,
      assignedAdminId: null,
      updatedAt: notification(3).createdAt,
      unreadCount: 2,
      messages: [message(2), message(3)],
    };
    const previous: SupportPage = { items: [thread], nextCursor: id(2) };
    const next: SupportPage = {
      items: [
        {
          ...thread,
          status: "ANSWERED",
          unreadCount: 0,
          messages: [message(3), message(4)],
        },
      ],
      nextCursor: id(3),
    };
    const result = mergeSupportDetail(previous, next);
    expect(result.items[0]?.messages.map((row) => row.body)).toEqual([
      "Message 2",
      "Message 3",
      "Message 4",
    ]);
    expect(result.items[0]).toMatchObject({
      status: "ANSWERED",
      unreadCount: 0,
    });
    expect(result.nextCursor).toBe(id(3));
    // A row removed from the refreshed admin-filter window must disappear.
    expect(
      mergeSupportPage(previous, { items: [], nextCursor: null }).items,
    ).toEqual([]);
  });
  it("allows only exact administrator KRW detail links", () => {
    const route = `/deposits/krw/${id(1)}`;
    expect(notificationRoute(route, true)).toBe(route);
    for (const unsafe of [
      route + "?next=https://example.com",
      route + "/extra",
      "/deposits/krw/not-a-uuid",
      "https://example.com" + route,
      "//example.com" + route,
    ]) {
      expect(notificationRoute(unsafe, true)).toBeNull();
    }
    expect(notificationRoute(route, false)).toBeNull();
    for (const memberRoute of [
      "/wallet",
      "/mining",
      "/events/notices/notice-1",
    ]) {
      expect(notificationRoute(memberRoute, false)).toBe(memberRoute);
      expect(notificationRoute(memberRoute, true)).toBeNull();
    }
    for (const unsafe of [
      "/wallet?next=https://example.com",
      "/events/%2Fadmin",
      "/logout",
      `/workroom/support?thread=${id(1)}&command=delete`,
    ]) {
      expect(notificationRoute(unsafe, false)).toBeNull();
    }
  });
});
