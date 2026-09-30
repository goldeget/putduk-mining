// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPreferencesForm } from "@/components/product/notification-preferences-form";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
let container: HTMLDivElement;
let root: Root;
const initial = {
  events_enabled: false,
  marketing_enabled: false,
  mining_enabled: true,
  service_enabled: true,
  wallet_enabled: false,
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(
  props: Parameters<typeof NotificationPreferencesForm>[0],
) {
  await act(async () =>
    root.render(createElement(NotificationPreferencesForm, props)),
  );
}
async function submit() {
  await act(async () =>
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

describe("preferences recovery UI", () => {
  it.each(["empty", "error"] as const)(
    "does not expose guessed editable preferences after %s",
    async (readState) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await render({ initial: null, readState });
      expect(container.querySelectorAll("input[type=checkbox]")).toHaveLength(
        0,
      );
      expect(container.textContent).toContain("다시");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("retains original settings and releases pending after network throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await render({ initial });
    await submit();
    expect(container.textContent).toContain("연결");
    expect(
      container.querySelector<HTMLButtonElement>("button[type=submit]")!
        .disabled,
    ).toBe(false);
    expect(
      container.querySelector<HTMLInputElement>("#pref-events_enabled")!
        .checked,
    ).toBe(false);
  });
  it("does not announce success for an empty 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    );
    await render({ initial });
    await submit();
    expect(container.textContent).not.toContain("저장했습니다");
    expect(container.textContent).toContain("결과를 확인하지 못했어요");
  });
  it("locks further saves after session expiry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await render({ initial });
    await submit();
    await submit();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector<HTMLButtonElement>("button[type=submit]")!
        .disabled,
    ).toBe(true);
    expect(container.textContent).toContain("로그인 시간이");
  });
});
