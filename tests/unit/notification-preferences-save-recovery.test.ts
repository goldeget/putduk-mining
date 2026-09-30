// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferencesForm } from "@/components/product/notification-preferences-form";
import { notificationPreferencesSaveWaitMs } from "@/lib/product/notification-preferences-save";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const initial = {
  events_enabled: false,
  marketing_enabled: false,
  mining_enabled: true,
  service_enabled: true,
  wallet_enabled: false,
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
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
async function mount(
  props: Parameters<typeof NotificationPreferencesForm>[0] = { initial },
) {
  await act(async () =>
    root.render(createElement(NotificationPreferencesForm, props)),
  );
}
async function submit() {
  await act(async () =>
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function saveButton() {
  return host.querySelector<HTMLButtonElement>("button[type=submit]")!;
}
function confirmed(preferences = initial) {
  return new Response(
    JSON.stringify({
      data: { preferences: { ...preferences, web_push_enabled: false } },
    }),
    { status: 200 },
  );
}

describe("preference PATCH display deadline and confirmed snapshots", () => {
  it.each(["fetch", "body"])(
    "bounds a stalled %s and ignores a possibly accepted late result",
    async (stage) => {
      vi.useFakeTimers();
      let resolveLate: (value: unknown) => void = () => undefined;
      const stalled = new Promise((resolve) => {
        resolveLate = resolve;
      });
      const fetch =
        stage === "fetch"
          ? vi.fn().mockReturnValue(stalled)
          : vi.fn().mockResolvedValue({
              ok: true,
              status: 200,
              json: () => stalled,
            });
      vi.stubGlobal("fetch", fetch);
      await mount();
      await submit();
      expect(saveButton().getAttribute("aria-busy")).toBe("true");
      await act(async () =>
        vi.advanceTimersByTimeAsync(notificationPreferencesSaveWaitMs),
      );
      expect(saveButton().getAttribute("aria-busy")).toBe("false");
      expect(saveButton().disabled).toBe(true);
      expect(host.textContent).toContain("설정 다시 확인");
      expect(host.textContent).not.toContain("저장했습니다");
      await act(async () =>
        resolveLate(
          stage === "fetch" ? confirmed() : { data: { preferences: initial } },
        ),
      );
      expect(host.textContent).not.toContain("저장했습니다");
      expect(
        host.querySelector<HTMLInputElement>("#pref-events_enabled")!.disabled,
      ).toBe(true);
      await submit();
      expect(fetch).toHaveBeenCalledOnce();
      expect(notificationPreferencesSaveWaitMs).toBe(15_000);
    },
  );

  it("uses one deadline across both fetch and body, rather than extending the wait", async () => {
    vi.useFakeTimers();
    let resolveHeaders: (value: unknown) => void = () => undefined;
    const fetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveHeaders = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await mount();
    await submit();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    await act(async () =>
      resolveHeaders({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().getAttribute("aria-busy")).toBe("false");
  });

  it("accepts the existing verified response including optional push preference", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(confirmed({ ...initial, events_enabled: true }));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await submit();
    expect(host.textContent).toContain("알림 설정을 저장했습니다");
    expect(
      host.querySelector<HTMLInputElement>("#pref-events_enabled")!.checked,
    ).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>("#pref-marketing_enabled")!.checked,
    ).toBe(false);
    expect(saveButton().disabled).toBe(false);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify(initial),
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/v1/notifications/preferences");
  });

  it.each([
    [
      "mixed data/error",
      200,
      { data: { preferences: initial }, error: { code: "FAILURE" } },
    ],
    [
      "missing boolean",
      200,
      { data: { preferences: { events_enabled: true } } },
    ],
    ["5xx with success-looking data", 503, { data: { preferences: initial } }],
    [
      "unknown error envelope",
      409,
      { error: { code: "UNEXPECTED", message: "failed" } },
    ],
    ["empty envelope", 200, {}],
  ] as const)(
    "locks save and never announces success for %s",
    async (_name, status, payload) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(payload), { status }));
      vi.stubGlobal("fetch", fetch);
      await mount();
      await submit();
      await submit();
      expect(fetch).toHaveBeenCalledOnce();
      expect(saveButton().disabled).toBe(true);
      expect(host.textContent).toContain("설정 다시 확인");
      expect(host.textContent).not.toContain("저장했습니다");
    },
  );

  it("locks an invalid JSON body without suggesting another PATCH", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("invalid", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await submit();
    await submit();
    expect(fetch).toHaveBeenCalledOnce();
    expect(saveButton().disabled).toBe(true);
    expect(host.textContent).not.toContain("다시 시도");
  });

  it("401 locks the session immediately without waiting for an unresponsive body", async () => {
    const json = vi.fn(() => new Promise(() => {}));
    const fetch = vi.fn().mockResolvedValue({ status: 401, ok: false, json });
    vi.stubGlobal("fetch", fetch);
    await mount();
    await submit();
    await submit();
    expect(json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(saveButton().disabled).toBe(true);
    expect(host.textContent).toContain("로그인 시간이 지났어요");
  });

  it("an unchanged prop refresh cannot erase uncertain save, but a changed server snapshot can", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("response lost"));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await submit();
    await mount({ initial: { ...initial } });
    expect(saveButton().disabled).toBe(true);
    await submit();
    expect(fetch).toHaveBeenCalledOnce();
    await mount({ initial: { ...initial, events_enabled: true } });
    expect(saveButton().disabled).toBe(false);
    expect(
      host.querySelector<HTMLInputElement>("#pref-events_enabled")!.checked,
    ).toBe(true);
    expect(host.textContent).not.toContain("저장 결과를 확인하지 못했어요");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("new server data supersedes an in-flight response before it can replace checkboxes", async () => {
    let resolveLate: (value: unknown) => void = () => undefined;
    const fetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await mount();
    await submit();
    const signal = fetch.mock.calls[0]?.[1].signal as AbortSignal;
    await mount({ initial: { ...initial, events_enabled: true } });
    expect(signal.aborted).toBe(true);
    await act(async () => resolveLate(confirmed()));
    expect(
      host.querySelector<HTMLInputElement>("#pref-events_enabled")!.checked,
    ).toBe(true);
    expect(host.textContent).not.toContain("저장했습니다");
    expect(saveButton().disabled).toBe(false);
  });

  it("unmount aborts local waiting and clears its timer; a late response does not update UI", async () => {
    vi.useFakeTimers();
    let resolveLate: (value: unknown) => void = () => undefined;
    const fetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetch);
    await mount();
    await submit();
    const signal = fetch.mock.calls[0]?.[1].signal as AbortSignal;
    await act(async () => root.render(null));
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => resolveLate(confirmed()));
    expect(host.textContent).toBe("");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("synchronous duplicate submit events only send one PATCH", async () => {
    const fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    await mount();
    await act(async () => {
      for (let i = 0; i < 3; i++)
        host
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
