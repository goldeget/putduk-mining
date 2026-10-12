// Recovered Cloud cases adapted to the current 10s independent coordinator.
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountLogoutControls } from "@/components/product/account-logout-controls";
import {
  pushDisableIntentKey,
  pushCleanupWaitMs,
  rememberPushDisableIntent,
} from "@/lib/notifications/push-client-coordinator";

const actions = vi.hoisted(() => ({
  logoutAction: vi.fn(),
  logoutAllAction: vi.fn(),
}));
vi.mock("@/app/(product)/menu/account/actions", () => actions);
let host: HTMLDivElement;
let root: Root;
let local: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> };
const getRegistration = vi.fn();
const fetch = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("FormData", window.FormData);
  localStorage.clear();
  rememberPushDisableIntent(false);
  local = {
    endpoint: "https://push.example/prior-device",
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
  getRegistration.mockReset().mockResolvedValue({
    pushManager: { getSubscription: vi.fn().mockResolvedValue(local) },
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration },
  });
  actions.logoutAction.mockReset();
  actions.logoutAllAction.mockReset();
  fetch
    .mockReset()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: { subscribed: false } })),
    );
  vi.stubGlobal("fetch", fetch);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mount() {
  await act(async () =>
    root.render(
      createElement(AccountLogoutControls, { className: "original-actions" }),
    ),
  );
}
async function submit(global = false) {
  await act(async () =>
    host
      .querySelectorAll<HTMLFormElement>("form")
      [global ? 1 : 0]!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
  );
}

describe("device cleanup preceding canonical server logout", () => {
  it("consumes the requestSubmit bypass once while the auth action is still pending", async () => {
    let resolveAction!: () => void;
    actions.logoutAction.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );
    await mount();
    await submit();
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    await submit();
    await submit(true);
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    expect(actions.logoutAllAction).not.toHaveBeenCalled();
    await act(async () => resolveAction());
  });
  it("never submits auth after unmount during browser preparation", async () => {
    let resolveLookup!: (value: unknown) => void;
    getRegistration.mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve;
      }),
    );
    await mount();
    await submit();
    await act(async () => root.render(null));
    await act(async () =>
      resolveLookup({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(local) },
      }),
    );
    expect(actions.logoutAction).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("restores a connected form after requestSubmit throws", async () => {
    const request = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    await mount();
    await submit();
    expect(actions.logoutAction).not.toHaveBeenCalled();
    expect(host.textContent).toContain("로그아웃 요청을 보내지 못했어요");
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      false,
    );
    request.mockRestore();
    await submit();
    expect(actions.logoutAction).toHaveBeenCalledOnce();
  });
  it("continues auth after denied local storage with no cleanup-success claim", async () => {
    const setter = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    await mount();
    await submit();
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("해제했습니다");
    setter.mockRestore();
  });

  it.each([false, true])(
    "preserves the %s logout action and visible composition after local cleanup",
    async (global) => {
      await mount();
      await submit(global);
      expect(local.unsubscribe).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        "/api/v1/notifications/subscriptions",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ endpoint: local.endpoint }),
        }),
      );
      expect(
        global ? actions.logoutAllAction : actions.logoutAction,
      ).toHaveBeenCalledOnce();
      expect(
        global ? actions.logoutAction : actions.logoutAllAction,
      ).not.toHaveBeenCalled();
      expect(localStorage.getItem(pushDisableIntentKey)).toBe("true");
      expect(host.textContent).toContain("이 기기에서 로그아웃");
      expect(host.textContent).toContain("모든 기기에서 로그아웃");
      expect(host.textContent).not.toContain("해제했습니다");
    },
  );
  it("continues auth logout when local unsubscribe refuses and keeps durable cleanup intent", async () => {
    local.unsubscribe.mockResolvedValue(false);
    await mount();
    await submit();
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    expect(localStorage.getItem(pushDisableIntentKey)).toBe("true");
    expect(host.textContent).not.toContain("해제했습니다");
  });
  it("attempts local unsubscribe immediately even when server revocation is offline", async () => {
    fetch.mockRejectedValue(new TypeError("offline"));
    await mount();
    await submit();
    expect(local.unsubscribe).toHaveBeenCalledOnce();
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    expect(localStorage.getItem(pushDisableIntentKey)).toBe("true");
  });
  it("bounds a hung browser lookup and ignores its late result after auth logout", async () => {
    vi.useFakeTimers();
    let resolveLate: (value: unknown) => void = () => {};
    getRegistration.mockReturnValue(
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
    );
    await mount();
    await submit();
    expect(actions.logoutAction).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(pushCleanupWaitMs));
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    await act(async () =>
      resolveLate({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(local) },
      }),
    );
    expect(local.unsubscribe).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem(pushDisableIntentKey)).toBe("true");
  });
  it("does not issue duplicate logout or cleanup from competing local/global submit events", async () => {
    vi.useFakeTimers();
    getRegistration.mockReturnValue(new Promise(() => {}));
    await mount();
    await submit();
    await submit(true);
    await submit();
    expect(getRegistration).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(pushCleanupWaitMs));
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    expect(actions.logoutAllAction).not.toHaveBeenCalled();
  });
  it("works on unsupported browsers without a new logout RPC", async () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    await mount();
    await submit();
    expect(actions.logoutAction).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
