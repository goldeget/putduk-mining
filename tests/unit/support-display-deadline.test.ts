// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SupportRuntime,
  SupportStartButton,
} from "@/components/support/support-runtime";
import { useSupportDisplayState } from "@/components/support/use-support-display-state";

const mocks = vi.hoisted(() => ({
  booted: false,
  listeners: new Set<() => void>(),
  request: vi.fn(),
  push: vi.fn(),
  pathname: "/home",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/support/channel-session", () => ({
  readPluginKey: () => "qa-presentation-only-key",
}));
vi.mock("@/lib/support/support-controller", () => ({
  createSupportController: () => ({
    request: mocks.request,
    isBooted: () => mocks.booted,
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  }),
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.booted = false;
  mocks.pathname = "/home";
  mocks.listeners.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mountStart() {
  await act(async () => root.render(createElement(SupportStartButton)));
}
async function tick(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}
async function publishBooted(booted: boolean) {
  await act(async () => {
    mocks.booted = booted;
    mocks.listeners.forEach((listener) => listener());
  });
}
function state() {
  return host.querySelector("button")?.getAttribute("data-support-state");
}

describe("support preparation display deadline", () => {
  it("a stalled preparation exposes readable guide recovery at 15s without requesting or cancelling SDK work", async () => {
    await mountStart();
    expect(state()).toBe("loading");
    expect(host.textContent).toContain("준비 중");
    await tick(14_999);
    expect(state()).toBe("loading");
    await tick(1);
    expect(state()).toBe("unavailable");
    expect(host.textContent).toContain("안내 보기");
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "준비가 지연",
    );
    expect(mocks.request).not.toHaveBeenCalled();
    const guide = document.createElement("section");
    guide.id = "support-guide";
    const scroll = vi.fn();
    guide.scrollIntoView = scroll;
    host.append(guide);
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(scroll).toHaveBeenCalledWith({
      behavior: "instant",
      block: "start",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("late confirmed boot promotes expired preparation to ready without a new request", async () => {
    await mountStart();
    await tick(15_000);
    expect(state()).toBe("unavailable");
    await publishBooted(true);
    expect(state()).toBe("ready");
    expect(host.textContent).toContain("상담 시작");
    expect(host.textContent).not.toContain("준비가 지연");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("ready turning false gets a fresh deadline after an earlier timeout", async () => {
    await mountStart();
    await tick(15_000);
    await publishBooted(true);
    await publishBooted(false);
    expect(state()).toBe("loading");
    await tick(14_999);
    expect(state()).toBe("loading");
    await tick(1);
    expect(state()).toBe("unavailable");
  });

  it("unmount clears the display timer and subscription", async () => {
    await mountStart();
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.listeners.size).toBe(0);
    await tick(15_000);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("confirmed readiness before the deadline clears its timer and remains ready", async () => {
    await mountStart();
    await tick(5000);
    await publishBooted(true);
    expect(vi.getTimerCount()).toBe(0);
    await tick(20_000);
    expect(state()).toBe("ready");
  });

  it("dock timeout preserves member classes and goes to support without an SDK resync", async () => {
    await act(async () => root.render(createElement(SupportRuntime)));
    expect(mocks.request).toHaveBeenCalledOnce();
    await tick(15_000);
    expect(
      host.querySelector(".support-dock.support-dock--member"),
    ).not.toBeNull();
    expect(state()).toBe("unavailable");
    expect(host.textContent).toContain("상담 안내");
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(mocks.push).toHaveBeenCalledWith("/support");
    expect(mocks.request).toHaveBeenCalledOnce();
  });

  it("missing plugin is unavailable immediately and creates no deadline", async () => {
    function Probe() {
      return createElement(
        "output",
        null,
        useSupportDisplayState(false, false),
      );
    }
    await act(async () => root.render(createElement(Probe)));
    expect(host.textContent).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });
});
