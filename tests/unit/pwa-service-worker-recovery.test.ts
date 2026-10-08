import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
const source = readFileSync(
  new URL("../../public/sw.js", import.meta.url),
  "utf8",
);
function worker() {
  const callbacks: Record<string, (event: Record<string, unknown>) => void> =
    {};
  const showNotification = vi.fn(async () => undefined),
    openWindow = vi.fn(async () => undefined),
    navigate = vi.fn(async () => ({ focus: vi.fn(async () => undefined) }));
  const clients = {
    matchAll: vi.fn(async () => [
      { url: "https://mining.putduk.com/home", navigate, focus: vi.fn() },
    ]),
    openWindow,
    claim: vi.fn(),
  };
  const cache = {
    addAll: vi.fn(async (paths: readonly string[]) => {
      void paths;
    }),
    match: vi.fn(async () => undefined),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [
      "other-app-cache",
      "putduk-shell-v3",
      "putduk-shell-v5",
      "putduk-shell-v6",
    ]),
    delete: vi.fn(async () => true),
    match: vi.fn(async () => new Response("offline")),
  };
  const fetch = vi.fn(async () => new Response("network"));
  const context = {
    URL,
    Response,
    Set,
    Promise,
    fetch,
    caches,
    clients,
    self: {
      addEventListener: (
        name: string,
        fn: (e: Record<string, unknown>) => void,
      ) => {
        callbacks[name] = fn;
      },
      skipWaiting: vi.fn(),
      clients,
      location: { origin: "https://mining.putduk.com" },
      registration: { showNotification },
    },
  };
  runInNewContext(source, context);
  async function emit(name: string, data: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    const respondWith = vi.fn((value: Promise<unknown>) => pending.push(value));
    callbacks[name]!({
      ...data,
      waitUntil: (value: Promise<unknown>) => pending.push(value),
      respondWith,
    });
    await Promise.all(pending);
    return respondWith;
  }
  return { emit, showNotification, clients, navigate, caches, cache, fetch };
}
describe("actual service worker privacy and offline recovery", () => {
  it("retains other apps' caches and deletes only old PUTDUK shell versions", async () => {
    const w = worker();
    await w.emit("activate", {});
    expect(w.caches.delete.mock.calls).toEqual([
      ["putduk-shell-v3"],
      ["putduk-shell-v5"],
    ]);
  });
  it("caches exact public offline artwork, never application/API or auth chunks", async () => {
    const w = worker();
    await w.emit("install", {});
    const paths = w.cache.addAll.mock.calls[0]![0] as unknown as string[];
    expect(paths).toContain("/offline");
    expect(paths).not.toContain("/home");
    expect(
      paths.every((x) => x === "/offline" || x.startsWith("/brand/")),
    ).toBe(true);
  });
  it.each([
    "https://mining.putduk.com/api/v1/wallet",
    "https://mining.putduk.com/home?private=receipt",
    "https://evil.test/brand/favicon/favicon.svg",
    "https://mining.putduk.com/_next/static/private.js",
  ])("ignores private/unowned cache request %s", async (url) => {
    const w = worker();
    const response = await w.emit("fetch", {
      request: { method: "GET", url, mode: "cors" },
    });
    expect(response).not.toHaveBeenCalled();
    expect(w.caches.open).not.toHaveBeenCalled();
  });
  it("uses a cached static offline shell on failed navigation and does not queue money commands", async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new Error("offline"));
    expect(
      await w.emit("fetch", {
        request: {
          method: "GET",
          url: "https://mining.putduk.com/wallet",
          mode: "navigate",
        },
      }),
    ).toHaveBeenCalledOnce();
    expect(w.caches.match).toHaveBeenCalledWith("/offline");
    expect(
      await w.emit("fetch", {
        request: {
          method: "POST",
          url: "https://mining.putduk.com/api/v1/wallet/withdrawals",
          mode: "cors",
        },
      }),
    ).not.toHaveBeenCalled();
  });
  it.each([
    "/wallet?view=history",
    "/login?next=%2Fwallet",
    "/events?receipt=private",
  ])(
    "uses public offline shell for query navigation %s without caching private URL",
    async (path) => {
      const w = worker();
      w.fetch.mockRejectedValue(new Error("offline"));
      const response = await w.emit("fetch", {
        request: {
          method: "GET",
          url: `https://mining.putduk.com${path}`,
          mode: "navigate",
        },
      });
      expect(response).toHaveBeenCalledOnce();
      expect(w.fetch).toHaveBeenCalledOnce();
      expect(w.caches.match.mock.calls).toEqual([["/offline"]]);
      expect(w.caches.open).not.toHaveBeenCalled();
      expect(w.cache.addAll).not.toHaveBeenCalled();
    },
  );
  it("keeps online query navigation network-first and ignores unowned navigation and every POST", async () => {
    const w = worker();
    await w.emit("fetch", {
      request: {
        method: "GET",
        url: "https://mining.putduk.com/wallet?view=history",
        mode: "navigate",
      },
    });
    expect(w.fetch).toHaveBeenCalledOnce();
    expect(w.caches.match).not.toHaveBeenCalled();
    expect(w.caches.open).not.toHaveBeenCalled();
    expect(
      await w.emit("fetch", {
        request: {
          method: "GET",
          url: "https://evil.test/wallet?view=history",
          mode: "navigate",
        },
      }),
    ).not.toHaveBeenCalled();
    expect(
      await w.emit("fetch", {
        request: {
          method: "POST",
          url: "https://mining.putduk.com/wallet?view=history",
          mode: "navigate",
        },
      }),
    ).not.toHaveBeenCalled();
    expect(w.fetch).toHaveBeenCalledOnce();
  });
  it("shows a generic lockscreen body, stable UUID tag, and sanitizes payload content/links", async () => {
    const w = worker();
    await w.emit("push", {
      data: {
        json: () => ({
          notificationId: "10000000-0000-4000-8000-000000000001",
          url: "https://evil.test",
          title: "회원 개인 정보",
          body: "100만 원 입금",
        }),
      },
    });
    expect(w.showNotification).toHaveBeenCalledWith(
      "퍼뜩 채굴",
      expect.objectContaining({
        tag: "putduk:10000000-0000-4000-8000-000000000001",
        data: { url: "/notifications" },
      }),
    );
    expect(JSON.stringify(w.showNotification.mock.calls)).not.toContain(
      "100만 원",
    );
  });
  it.each([
    "//evil.test",
    "/events/%2e%2e/wallet",
    "/wallet?token=secret",
    "/api/v1/auth/logout",
  ])("never navigates malicious notification link %s", async (url) => {
    const w = worker();
    await w.emit("notificationclick", {
      notification: { close: vi.fn(), data: { url } },
    });
    expect(w.navigate).toHaveBeenCalledWith(
      "https://mining.putduk.com/notifications",
    );
  });
  it("reuses an existing same-origin client for an approved event route", async () => {
    const w = worker();
    await w.emit("notificationclick", {
      notification: {
        close: vi.fn(),
        data: { url: "/events/notices/member-day" },
      },
    });
    expect(w.navigate).toHaveBeenCalledWith(
      "https://mining.putduk.com/events/notices/member-day",
    );
    expect(w.clients.openWindow).not.toHaveBeenCalled();
  });
});
