// Existing 16 focused assertions remain in their original files.
// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLogoutControls } from "@/components/product/account-logout-controls";
import { rememberPushDisableIntent } from "@/lib/notifications/push-client-coordinator";
const actions = vi.hoisted(() => ({
  logoutAction: vi.fn(),
  logoutAllAction: vi.fn(),
}));
vi.mock("@/app/(product)/menu/account/actions", () => actions);
import { PushControl } from "@/components/product/push-control";

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
let fetcher: ReturnType<
  typeof vi.fn<
    (_url: string, init: RequestInit & { body: string }) => Promise<unknown>
  >
>;
const settle = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
async function mount() {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(PushControl),
        createElement(AccountLogoutControls, { className: "logout-actions" }),
      ),
    ),
  );
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
  actions.logoutAction.mockReset();
  actions.logoutAllAction.mockReset();
  vi.stubGlobal("FormData", window.FormData);
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
  fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const endpointEpoch =
      body.operation === "REGISTER"
        ? body.expectedEpoch + 1
        : (body.expectedEpoch ?? 3);
    return {
      ok: true,
      json: async () => ({
        data: {
          operation: body.operation,
          endpointEpoch,
          subscribed: body.operation === "REGISTER",
          intentId: body.intentId,
          permitId: body.permitId ?? "22222222-2222-4222-8222-222222222222",
        },
      }),
    };
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

async function submitLogout() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  await settle();
}
describe("Push and logout interleavings across component boundaries", () => {
  it("retains the logout marker across remount without automatically reconfirming an endpoint", async () => {
    rememberPushDisableIntent(true);
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    await mount();
    expect(host.textContent).toContain("알림 해제 다시 확인");
    await act(async () => root.render(null));
    await mount();
    expect(localStorage.getItem("putduk-push-disable-pending")).toBe("true");
    expect(host.textContent).toContain("알림 해제 다시 확인");
    expect(
      fetcher.mock.calls.every(
        ([, init]) => JSON.parse(init.body).operation === "SNAPSHOT",
      ),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("cancels delayed subscribe and fences its late removal without POST after auth submission", async () => {
    let resolveSubscribe!: (value: typeof subscription) => void;
    registration.pushManager.subscribe.mockReturnValue(
      new Promise((resolve) => {
        resolveSubscribe = resolve;
      }),
    );
    await mount();
    await click("알림 켜기");
    await submitLogout();
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    await act(async () => resolveSubscribe(subscription));
    await settle();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("unblocks auth on an unknown old POST deadline and never starts late DELETE with next-account cookies", async () => {
    let resolvePost!: (value: unknown) => void;
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    const normal = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(
      (url: string, init: RequestInit & { body: string }) => {
        if (JSON.parse(init.body as string).operation !== "REGISTER")
          return normal(url, init);
        return new Promise((resolve) => {
          resolvePost = resolve;
        });
      },
    );
    await mount();
    await click("알림 연결 확인");
    await submitLogout();
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(actions.logoutAction).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    await act(async () =>
      resolvePost({
        ok: true,
        json: async () => ({
          data: {
            subscribed: true,
            operation: "REGISTER",
            endpointEpoch: 4,
            ...JSON.parse(fetcher.mock.calls[2]![1].body),
          },
        }),
      }),
    );
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.map(([, init]) => JSON.parse(init.body).operation),
    ).toEqual(["SNAPSHOT", "ISSUE", "REGISTER"]);
    expect(fetcher.mock.calls.every(([, init]) => init.method === "POST")).toBe(
      true,
    );
    expect(host.textContent).not.toContain(
      "이 기기에서 푸시 알림을 받을 수 있습니다.",
    );
    // This does not assert the old server POST rolled back.
  });

  it("does not POST another account's old endpoint when disable-intent cleanup refuses", async () => {
    registration.pushManager.getSubscription.mockResolvedValue(subscription);
    subscription.unsubscribe.mockResolvedValue(false);
    await mount();
    rememberPushDisableIntent(true);
    await click("알림 연결 확인");
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(
      fetcher.mock.calls.every(
        ([, init]) => JSON.parse(init.body).operation === "SNAPSHOT",
      ),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(host.textContent).toContain("이전 알림 해제를 마치지 못했어요");
  });

  it("cleans the old endpoint then sends only a different new explicit subscription", async () => {
    const old = {
      ...subscription,
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    const next = {
      ...subscription,
      endpoint: "https://push.example.test/new-account-device",
      toJSON: () => ({
        endpoint: "https://push.example.test/new-account-device",
        keys: { auth: "test", p256dh: "test" },
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    registration.pushManager.getSubscription
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(old)
      .mockResolvedValue(null);
    registration.pushManager.subscribe.mockResolvedValue(next);
    await mount();
    rememberPushDisableIntent(true);
    await click("알림 연결 확인");
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(3);
    const mutations = fetcher.mock.calls
      .map(([, init]) => JSON.parse(init.body))
      .filter((body) => body.operation !== "SNAPSHOT");
    expect(mutations.map((body) => body.operation)).toEqual([
      "ISSUE",
      "REGISTER",
    ]);
    expect(
      mutations.every((body) => body.subscription.endpoint === next.endpoint),
    ).toBe(true);
  });

  it("allows same-endpoint native reactivation only with a fresh explicit epoch permit", async () => {
    registration.pushManager.getSubscription
      .mockResolvedValueOnce(subscription)
      .mockResolvedValueOnce(subscription)
      .mockResolvedValue(null);
    registration.pushManager.subscribe.mockResolvedValue(subscription);
    await mount();
    rememberPushDisableIntent(true);
    await click("알림 연결 확인");
    const writes = fetcher.mock.calls
      .map(([, init]) => JSON.parse(init.body))
      .filter((body) => body.operation !== "SNAPSHOT");
    expect(writes.map((body) => body.operation)).toEqual(["ISSUE", "REGISTER"]);
    expect(
      writes.every(
        (body) =>
          body.expectedEpoch === 3 &&
          body.subscription.endpoint === subscription.endpoint,
      ),
    ).toBe(true);
    expect(writes[1].permitId).toBe("22222222-2222-4222-8222-222222222222");
    expect(host.textContent).toContain(
      "이 기기에서 푸시 알림을 받을 수 있습니다.",
    );
  });
});
