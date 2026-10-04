// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PutdukAiDock } from "@/components/product/putduk-ai-dock";

const navigation = vi.hoisted(() => ({ pathname: "/home" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    onNavigate,
    ...props
  }: {
    children: ReactNode;
    href: string;
    onNavigate?: () => void;
  }) => createElement("a", { ...props, onClick: onNavigate }, children),
}));
vi.mock("@/components/product/putduk-ai-chat", () => ({
  PutdukAiChat: () =>
    createElement("textarea", { "aria-label": "테스트 질문 입력" }),
}));

let host: HTMLDivElement;
let root: Root;
let main: HTMLElement;
let viewport: EventTarget & { height: number; offsetTop: number };
let originalShowModal: PropertyDescriptor | undefined;
let originalClose: PropertyDescriptor | undefined;
let originalViewport: PropertyDescriptor | undefined;

function launcher() {
  return host.querySelector<HTMLButtonElement>('[aria-label="AI 도움"]')!;
}

function dialog() {
  return host.querySelector<HTMLDialogElement>("[data-ai-dialog]")!;
}

async function render(pathname = navigation.pathname) {
  navigation.pathname = pathname;
  await act(async () => root.render(createElement(PutdukAiDock)));
}

async function open() {
  await act(async () => launcher().click());
}

function visibleModal() {
  const modal = document.createElement("dialog");
  modal.setAttribute("open", "");
  document.body.append(modal);
  return modal;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.pathname = "/home";
  originalShowModal = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  originalClose = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close",
  );
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value() {
      this.setAttribute("open", "");
      this.querySelector("button")?.focus();
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value() {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      queueMicrotask(() => this.dispatchEvent(new Event("close")));
    },
  });
  // JSDOM has no layout. These rectangles model a visible financial dialog;
  // browser tests remain responsible for native top-layer and CSS behavior.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    },
  );
  viewport = Object.assign(new EventTarget(), { height: 640, offsetTop: 16 });
  originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  main = document.createElement("main");
  main.id = "main-content";
  main.style.setProperty("overflow", "auto", "important");
  main.style.setProperty("overscroll-behavior", "contain");
  document.body.append(main);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  main.remove();
  document.querySelectorAll("dialog").forEach((node) => node.remove());
  for (const [property, descriptor] of [
    ["showModal", originalShowModal],
    ["close", originalClose],
  ] as const) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, property, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, property);
  }
  if (originalViewport)
    Object.defineProperty(window, "visualViewport", originalViewport);
  else Reflect.deleteProperty(window, "visualViewport");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AI dock route and modal lifecycle", () => {
  it.each(["/ai", "/menu/ai", "/support", "/login"])(
    "does not duplicate the dedicated AI or support presentation on %s",
    async (pathname) => {
      await render(pathname);
      expect(host.querySelector("[data-ai-dock]")).toBeNull();
      expect(host.querySelector("dialog")).toBeNull();
    },
  );

  it("offers the existing mining details anchor without inventing a command", async () => {
    await render("/mining");
    expect(
      host.querySelector('a[href="#putduk-mining-details"]')?.textContent,
    ).toContain("상세 보기");
    await render("/wallet");
    expect(host.querySelector('a[href="#putduk-mining-details"]')).toBeNull();
  });

  it("opens and scrolls the visible mining details instead of hidden streamed content", async () => {
    const stale = document.createElement("details");
    stale.id = "putduk-mining-details";
    stale.hidden = true;
    const current = document.createElement("details");
    current.id = stale.id;
    const summary = document.createElement("summary");
    summary.tabIndex = 0;
    current.append(summary);
    const scroll = vi.fn();
    current.scrollIntoView = scroll;
    Object.defineProperty(stale, "getClientRects", {
      value: () => [] as unknown as DOMRectList,
    });
    Object.defineProperty(current, "getClientRects", {
      value: () => [current.getBoundingClientRect()] as unknown as DOMRectList,
    });
    main.append(stale, current);
    await render("/mining");
    await act(async () =>
      host
        .querySelector<HTMLAnchorElement>('a[href="#putduk-mining-details"]')!
        .click(),
    );
    expect(stale.open).toBe(false);
    expect(current.open).toBe(true);
    expect(scroll).toHaveBeenCalledWith({
      block: "start",
      behavior: "instant",
    });
    expect(document.activeElement).toBe(current.querySelector("summary"));
  });

  it("opens one panel, locks the real main scroller, then restores styles and focus", async () => {
    document.documentElement.style.setProperty("overflow", "clip");
    await render();
    const opener = launcher();
    await open();
    await open();
    expect(dialog().open).toBe(true);
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelectorAll("textarea")).toHaveLength(1);
    expect(main.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog().style.getPropertyValue("--ai-viewport-height")).toBe(
      "640px",
    );
    expect(dialog().style.getPropertyValue("--ai-viewport-top")).toBe("16px");
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="닫기"]')!.click(),
    );
    expect(dialog().open).toBe(false);
    expect(host.querySelector("textarea")).toBeNull();
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(opener);
    expect(main.style.overflow).toBe("auto");
    expect(main.style.getPropertyPriority("overflow")).toBe("important");
    expect(main.style.getPropertyValue("overscroll-behavior")).toBe("contain");
    expect(document.body.style.overflow).toBe("");
    expect(document.documentElement.style.overflow).toBe("clip");
    document.documentElement.style.removeProperty("overflow");
  });

  it("handles Escape without allowing the browser close event to steal focus", async () => {
    await render();
    await open();
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => dialog().dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(launcher());
    expect(main.style.overflow).toBe("auto");
  });

  it("blocks AI opening while a visible money confirmation owns the modal", async () => {
    await render();
    const money = visibleModal();
    await open();
    expect(dialog().open).toBe(false);
    expect(money.open).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "다른 확인 창을 닫은 뒤",
    );
    expect(main.style.overflow).toBe("auto");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("ignores a hidden modal but notices when it becomes visible", async () => {
    await render();
    const money = visibleModal();
    money.hidden = true;
    await open();
    expect(dialog().open).toBe(true);
    const nextFocus = document.createElement("button");
    money.append(nextFocus);
    await act(async () => {
      money.hidden = false;
      nextFocus.focus();
      await Promise.resolve();
    });
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(nextFocus);
    expect(main.style.overflow).toBe("auto");
  });

  it("closes and releases the old route without focusing its removed opener", async () => {
    await render();
    await open();
    const oldDialog = dialog();
    const oldOpener = launcher();
    const focus = vi.spyOn(oldOpener, "focus");
    await render("/wallet");
    expect(oldDialog.isConnected).toBe(false);
    expect(oldDialog.open).toBe(false);
    expect(focus).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
    expect(launcher().getAttribute("aria-expanded")).toBe("false");
    expect(main.style.overflow).toBe("auto");
    await open();
    expect(dialog().open).toBe(true);
  });

  it("releases viewport listeners and main scrolling when navigating to full AI", async () => {
    const removeListener = vi.spyOn(viewport, "removeEventListener");
    await render();
    await open();
    const oldDialog = dialog();
    await render("/ai");
    expect(host.querySelector("dialog")).toBeNull();
    expect(oldDialog.open).toBe(false);
    expect(oldDialog.style.getPropertyValue("--ai-viewport-height")).toBe("");
    expect(removeListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith("scroll", expect.any(Function));
    expect(main.style.overflow).toBe("auto");
    viewport.height = 280;
    await act(async () => viewport.dispatchEvent(new Event("resize")));
    expect(oldDialog.style.getPropertyValue("--ai-viewport-height")).toBe("");
  });

  it("tracks a keyboard viewport while open and stops tracking after close", async () => {
    await render();
    await open();
    const panel = dialog();
    viewport.height = 300;
    viewport.offsetTop = 40;
    await act(async () => viewport.dispatchEvent(new Event("resize")));
    expect(panel.style.getPropertyValue("--ai-viewport-height")).toBe("300px");
    expect(panel.style.getPropertyValue("--ai-viewport-top")).toBe("40px");
    await act(async () => panel.close());
    expect(launcher().getAttribute("aria-expanded")).toBe("false");
    expect(main.style.overflow).toBe("auto");
    viewport.height = 450;
    await act(async () => viewport.dispatchEvent(new Event("resize")));
    expect(panel.style.getPropertyValue("--ai-viewport-height")).toBe("");
  });
});
