// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushControl } from "@/components/product/push-control";
import { rememberPushDisableIntent } from "@/lib/notifications/push-client-coordinator";

let root: Root;
let host: HTMLDivElement;
let subscription: {
  toJSON: () => object;
  endpoint: string;
  unsubscribe: ReturnType<typeof vi.fn>;
};
let registration: {
  pushManager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
};
let worker: {
  getRegistration: ReturnType<typeof vi.fn>;
  ready: Promise<unknown>;
};
let requestPermission: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
async function mount() {
  await act(async () => root.render(createElement(PushControl)));
  await settle();
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
  await settle();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  localStorage.clear();
  rememberPushDisableIntent(false);
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "AQID");
  subscription = {
    endpoint: "https://push.example.test/subscription",
    toJSON: () => ({
      endpoint: "https://push.example.test/subscription",
      keys: { auth: "test", p256dh: "test" },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue(subscription),
    },
  };
  worker = {
    getRegistration: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
  };
  requestPermission = vi.fn().mockResolvedValue("granted");
  vi.stubGlobal("navigator", { serviceWorker: worker });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("Notification", { permission: "granted", requestPermission });
  fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { subscribed: true } }),
  });
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("push registration reflects server confirmation", () => {
  it("waits for failed-attempt cleanup before a retry can reuse its endpoint", async () => {
    let cleaned!: (value: boolean) => void;
    subscription.unsubscribe.mockImplementation(
      () =>
        new Promise((done) => {
          cleaned = done;
        }),
    );
    fetcher.mockResolvedValueOnce({ ok: false });
    await mount();
    await click("알림 켜기");
    const readsBeforeRetry =
      registration.pushManager.getSubscription.mock.calls.length;
    await click("알림 켜기");
    expect(registration.pushManager.getSubscription).toHaveBeenCalledTimes(
      readsBeforeRetry,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("설정 중");
    await act(async () => cleaned(true));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("알림 끄기");
  });
  it("keeps the native mutation fence through cancellation and remount", async () => {
    let subscribed!: (value: typeof subscription) => void;
    let cleaned!: (value: boolean) => void;
    subscription.unsubscribe.mockImplementation(
      () =>
        new Promise((done) => {
          cleaned = done;
        }),
    );
    registration.pushManager.subscribe.mockImplementationOnce(
      () =>
        new Promise((done) => {
          subscribed = done;
        }),
    );
    await mount();
    await click("알림 켜기");
    await act(async () => root.render(null));
    await mount();
    const readsBeforeRetry =
      registration.pushManager.getSubscription.mock.calls.length;
    await click("알림 켜기");
    await act(async () => subscribed(subscription));
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(registration.pushManager.getSubscription).toHaveBeenCalledTimes(
      readsBeforeRetry,
    );
    await act(async () => cleaned(true));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("알림 끄기");
  });
  it("does not claim a browser-only subscription is confirmed after remount", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await mount();
    expect(host.textContent).toContain("알림 연결 확인");
    expect(host.textContent).not.toContain("알림 끄기");
    expect(fetcher).not.toHaveBeenCalled();
    await click("알림 연결 확인");
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("알림 끄기");
  });
  it("cleans up a newly created browser subscription when server save fails", async () => {
    fetcher.mockResolvedValue({ ok: false });
    await mount();
    await click("알림 켜기");
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("알림 끄기");
    expect(host.textContent).toContain("저장하지 못했습니다");
  });
  it("keeps an existing subscription when the current account cannot confirm it", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    fetcher.mockResolvedValue({ ok: false, status: 409 });
    await mount();
    await click("알림 연결 확인");
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(host.textContent).toContain("알림 연결 확인");
    expect(host.textContent).not.toContain("알림 끄기");
  });
  it("bounds service worker readiness and returns to a retryable state", async () => {
    worker.getRegistration.mockResolvedValue(undefined);
    worker.ready = new Promise(() => {});
    await mount();
    await click("알림 켜기");
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(host.textContent).not.toContain("설정 중");
    expect(host.textContent).toContain("다시");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels waiting and never saves a late subscription", async () => {
    let resolve!: (value: typeof subscription) => void;
    registration.pushManager.subscribe.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await mount();
    await click("알림 켜기");
    await click("취소");
    await act(async () => resolve(subscription));
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("설정 중");
  });
  it("does not save after unmount while browser permission is pending", async () => {
    let resolve!: (value: string) => void;
    requestPermission.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await mount();
    await click("알림 켜기");
    await act(async () => root.render(null));
    await act(async () => resolve("granted"));
    await settle();
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not claim disabled when server revoke failed", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await mount();
    await click("알림 연결 확인");
    fetcher.mockResolvedValue({ ok: false });
    await click("알림 끄기");
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(host.textContent).toContain("알림 끄기");
    expect(host.textContent).toContain("해제하지 못했습니다");
  });
  it("retries an uncertain revoke with DELETE rather than re-enabling push", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await mount();
    await click("알림 연결 확인");
    fetcher.mockImplementation(() => new Promise(() => {}));
    await click("알림 끄기");
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(host.textContent).toContain("알림 해제 다시 확인");
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { subscribed: false } }),
    });
    await click("알림 해제 다시 확인");
    expect(fetcher.mock.calls.at(-1)?.[1].method).toBe("DELETE");
    expect(host.textContent).toContain("알림 켜기");
  });
  it("does not reinterpret failed browser cleanup as an unconfirmed server revoke", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await mount();
    await click("알림 연결 확인");
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { subscribed: false } }),
    });
    subscription.unsubscribe.mockRejectedValue(new Error("browser failure"));
    await click("알림 끄기");
    expect(host.textContent).toContain("알림 발송은 해제했어요");
    expect(host.textContent).toContain("알림 켜기");
    expect(host.textContent).not.toContain("알림 해제 다시 확인");
  });
  it("allows recovery when initial browser registration inspection times out", async () => {
    worker.getRegistration.mockImplementation(() => new Promise(() => {}));
    await mount();
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    const button = [...host.querySelectorAll("button")].find(
      (item) => item.textContent === "알림 켜기",
    );
    expect(button?.disabled).toBe(false);
    expect(host.textContent).toContain("다시 확인");
  });
  it("rejects a successful HTTP response without the expected server registration receipt", async () => {
    fetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { subscribed: false } }),
    });
    await mount();
    await click("알림 켜기");
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("알림 끄기");
  });
});
