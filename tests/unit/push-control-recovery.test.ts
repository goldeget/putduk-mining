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
const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const permitId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const receiptId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const subscriptionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function reply(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ data }),
  };
}
function responseFor(init: RequestInit) {
  const body = JSON.parse(init.body as string);
  if (init.method === "DELETE")
    return reply({
      operation: "REVOKE",
      scope: "CURRENT_ENDPOINT",
      authSessionId: sessionId,
      receiptId,
      subscriptionId: null,
      subscribed: false,
      endpointEpoch: 5,
      intentId: body.intentId,
      permitId: null,
    });
  if (body.operation === "SNAPSHOT")
    return reply({
      operation: "SNAPSHOT",
      authSessionId: sessionId,
      endpointEpoch: 3,
      subscribed: false,
    });
  if (body.operation === "ISSUE")
    return reply({
      operation: "ISSUE",
      authSessionId: sessionId,
      endpointEpoch: body.expectedEpoch,
      intentId: body.intentId,
      permitId,
    });
  if (body.operation === "REGISTER")
    return reply({
      operation: "REGISTER",
      scope: "CURRENT_SESSION",
      authSessionId: sessionId,
      receiptId,
      subscriptionId,
      subscribed: true,
      endpointEpoch: body.expectedEpoch + 1,
      intentId: body.intentId,
      permitId: body.permitId,
    });
  throw new Error("UNEXPECTED_PUSH_COMMAND");
}
function operations() {
  return fetcher.mock.calls.map(([, init]) =>
    init.method === "DELETE"
      ? "REVOKE"
      : (JSON.parse(init.body as string).operation as string),
  );
}
function mutationOperations() {
  return operations().filter((operation) => operation !== "SNAPSHOT");
}
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
  fetcher = vi.fn(async (_url: string, init: RequestInit) => responseFor(init));
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
    fetcher.mockResolvedValueOnce(reply(null, 503));
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
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(operations()).toEqual(["ISSUE", "ISSUE", "REGISTER"]);
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
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(operations()).toEqual(["ISSUE", "REGISTER"]);
    expect(host.textContent).toContain("알림 끄기");
  });
  it("does not claim a browser-only subscription is confirmed after remount", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await mount();
    expect(host.textContent).toContain("알림 연결 확인");
    expect(host.textContent).not.toContain("알림 끄기");
    expect(operations()).toEqual(["SNAPSHOT"]);
    expect(mutationOperations()).toEqual([]);
    await click("알림 연결 확인");
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(operations()).toEqual(["SNAPSHOT", "ISSUE", "REGISTER"]);
    expect(mutationOperations()).toEqual(["ISSUE", "REGISTER"]);
    expect(host.textContent).toContain("알림 끄기");
  });
  it("cleans up a newly created browser subscription when server save fails", async () => {
    fetcher.mockResolvedValue(reply(null, 503));
    await mount();
    await click("알림 켜기");
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("알림 끄기");
    expect(host.textContent).toContain("저장하지 못했습니다");
  });
  it("keeps an existing subscription when the current account cannot confirm it", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    fetcher.mockResolvedValue(reply(null, 409));
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
    fetcher.mockResolvedValue(reply(null, 503));
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
    fetcher.mockImplementation(async (_url: string, init: RequestInit) =>
      responseFor(init),
    );
    await click("알림 해제 다시 확인");
    expect(fetcher.mock.calls.at(-1)?.[1].method).toBe("DELETE");
    expect(host.textContent).toContain("알림 켜기");
  });
  it("does not reinterpret failed browser cleanup as an unconfirmed server revoke", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await mount();
    await click("알림 연결 확인");
    fetcher.mockImplementation(async (_url: string, init: RequestInit) =>
      responseFor(init),
    );
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
    fetcher.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return body.operation === "REGISTER"
        ? reply({ subscribed: false })
        : responseFor(init);
    });
    await mount();
    await click("알림 켜기");
    // REGISTER may have committed despite a malformed/lost result. Preserve its native handle.
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("알림 끄기");
    expect(host.textContent).toContain("알림 해제 다시 확인");
    expect(localStorage.getItem("putduk-push-disable-pending")).toBe("true");
    expect(mutationOperations()).toEqual(["ISSUE", "REGISTER"]);
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await act(async () => root.render(null));
    await mount();
    expect(operations()).toEqual(["ISSUE", "REGISTER", "SNAPSHOT"]);
    expect(mutationOperations()).toEqual(["ISSUE", "REGISTER"]);
    expect(host.textContent).toContain("알림 해제 다시 확인");
    await click("알림 해제 다시 확인");
    expect(operations()).toEqual(["ISSUE", "REGISTER", "SNAPSHOT", "REVOKE"]);
    const revoke = JSON.parse(fetcher.mock.calls.at(-1)![1].body as string);
    expect(revoke.endpoint).toBe(subscription.endpoint);
    expect(revoke.intentId).toMatch(/^[a-f0-9-]{36}$/);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("알림 켜기");
  });
  it("preserves an existing native endpoint when its session is refused after snapshot", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    fetcher.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      return body.operation === "ISSUE" ? reply(null, 401) : responseFor(init);
    });
    await mount();
    await click("알림 연결 확인");
    expect(operations()).toEqual(["SNAPSHOT", "ISSUE"]);
    expect(mutationOperations()).toEqual(["ISSUE"]);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("알림 끄기");
    expect(host.textContent).toContain("저장하지 못했습니다");
  });

  it("keeps an unknown REGISTER binding for reconciliation after a session refusal", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    let sessionRefused = false;
    fetcher.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (body.operation === "REGISTER") sessionRefused = true;
      return sessionRefused ? reply(null, 401) : responseFor(init);
    });
    await mount();
    await click("알림 연결 확인");
    expect(operations()).toEqual(["SNAPSHOT", "ISSUE", "REGISTER"]);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem("putduk-push-disable-pending")).toBe("true");
    expect(host.textContent).toContain("알림 해제 다시 확인");
    await act(async () => root.render(null));
    await mount();
    expect(operations()).toEqual(["SNAPSHOT", "ISSUE", "REGISTER", "SNAPSHOT"]);
    expect(mutationOperations()).toEqual(["ISSUE", "REGISTER"]);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("does not claim off or remove the endpoint when a revoke receipt is superseded", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await mount();
    await click("알림 연결 확인");
    fetcher.mockImplementation(async (_url: string, init: RequestInit) =>
      init.method === "DELETE"
        ? reply({ code: "PUSH_REVOKE_SUPERSEDED" }, 409)
        : responseFor(init),
    );
    await click("알림 끄기");
    expect(operations()).toEqual(["SNAPSHOT", "ISSUE", "REGISTER", "REVOKE"]);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem("putduk-push-disable-pending")).toBe("true");
    expect(host.textContent).not.toContain("해제했습니다");
    expect(host.textContent).toContain("알림 끄기");
    const first = JSON.parse(fetcher.mock.calls.at(-1)![1].body as string);
    fetcher.mockImplementation(async (_url: string, init: RequestInit) =>
      responseFor(init),
    );
    await click("알림 끄기");
    const second = JSON.parse(fetcher.mock.calls.at(-1)![1].body as string);
    expect(operations()).toEqual([
      "SNAPSHOT",
      "ISSUE",
      "REGISTER",
      "REVOKE",
      "REVOKE",
    ]);
    expect(second.endpoint).toBe(first.endpoint);
    expect(second.intentId).not.toBe(first.intentId);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("알림 켜기");
  });
});
