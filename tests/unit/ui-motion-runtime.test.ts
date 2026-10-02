// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MiningCore } from "@/components/foundation/mining-core";
import { GuidedQuest } from "@/components/product/guided-quest";
import {
  createAmbientRuntime,
  hasConstrainedMotionCapability,
} from "@/lib/motion/ambient-runtime";
import { placeCoachMark, visibleSpotlight } from "@/lib/motion/coach-position";
import {
  prefersReducedMotion,
  scrollQuestTarget,
} from "@/lib/motion/motion-preference";

const mediaQueries = new Map<string, EventTarget & { matches: boolean }>();
let observerCallback: IntersectionObserverCallback;
let resizeCallback: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
let root: Root | undefined;
let container: HTMLDivElement;

function changeMedia(query: string, matches: boolean) {
  const media = mediaQueries.get(query)!;
  media.matches = matches;
  media.dispatchEvent(new Event("change"));
}

function setInView(value: boolean) {
  observerCallback(
    [
      {
        isIntersecting: value,
        intersectionRatio: value ? 1 : 0,
      } as IntersectionObserverEntry,
    ],
    {} as IntersectionObserver,
  );
}

async function mount(component: ReturnType<typeof createElement>) {
  root = createRoot(container);
  await act(async () => {
    root!.render(component);
  });
}

async function click(button: Element) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function buttonWithText(text: string) {
  const button = [...container.querySelectorAll("button")].find((node) =>
    node.textContent?.includes(text),
  );
  expect(button).toBeDefined();
  return button!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mediaQueries.clear();
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!mediaQueries.has(query))
      mediaQueries.set(
        query,
        Object.assign(new EventTarget(), { matches: false }),
      );
    return mediaQueries.get(query);
  });
  vi.stubGlobal("CSS", { supports: () => true });
  disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  Object.defineProperty(navigator, "hardwareConcurrency", {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(navigator, "deviceMemory", {
    configurable: true,
    value: 8,
  });
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: undefined,
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = undefined;
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ambient presentation runtime", () => {
  it("begins still and only plays a confirmed running scene in view", async () => {
    await mount(createElement(MiningCore, { running: true }));
    const scene = container.querySelector("[data-mining-running]")!;
    expect(scene.getAttribute("data-motion")).toBe("paused");
    await act(async () => {
      setInView(true);
    });
    expect(scene.getAttribute("data-motion")).toBe("playing");
    expect(scene.getAttribute("data-mining-running")).toBe("true");
  });

  it("does not imply activity before the server confirms running", async () => {
    await mount(createElement(MiningCore));
    await act(async () => {
      setInView(true);
    });
    expect(
      container.querySelector("[data-motion]")!.getAttribute("data-motion"),
    ).toBe("paused");
    expect(
      container
        .querySelector("[data-motion-quality]")!
        .getAttribute("data-motion-quality"),
    ).toBe("static");
    expect(container.querySelectorAll("[class*='particle']")).toHaveLength(0);
  });

  it("manual pause and resume change presentation without removing art or server state", async () => {
    await mount(createElement(MiningCore, { running: true }));
    await act(async () => {
      setInView(true);
    });
    await click(buttonWithText("연출 일시정지"));
    const scene = container.querySelector("[data-mining-running]")!;
    expect(scene.getAttribute("data-motion")).toBe("paused");
    expect(scene.getAttribute("data-mining-running")).toBe("true");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(buttonWithText("연출 재생").getAttribute("aria-pressed")).toBe(
      "true",
    );
    await click(buttonWithText("연출 재생"));
    expect(scene.getAttribute("data-motion")).toBe("playing");
  });

  it("stops offscreen, in a hidden document, and on pagehide, then resumes", async () => {
    await mount(createElement(MiningCore, { running: true }));
    const scene = container.querySelector("[data-motion]")!;
    await act(async () => {
      setInView(true);
    });
    await act(async () => {
      setInView(false);
    });
    expect(scene.getAttribute("data-motion")).toBe("paused");
    await act(async () => {
      setInView(true);
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(scene.getAttribute("data-motion")).toBe("paused");
    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(scene.getAttribute("data-motion")).toBe("playing");
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(scene.getAttribute("data-motion")).toBe("paused");
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(scene.getAttribute("data-motion")).toBe("playing");
  });

  it("changes reduced motion live and preserves a manual pause across preference changes", async () => {
    await mount(createElement(MiningCore, { running: true }));
    await act(async () => {
      setInView(true);
    });
    await act(async () => {
      changeMedia("(prefers-reduced-motion: reduce)", true);
    });
    expect(
      container
        .querySelector("[data-motion-quality]")!
        .getAttribute("data-motion-quality"),
    ).toBe("static");
    expect(buttonWithText("움직임 없이 보기").disabled).toBe(true);
    await act(async () => {
      changeMedia("(prefers-reduced-motion: reduce)", false);
    });
    await click(buttonWithText("연출 일시정지"));
    await act(async () => {
      changeMedia("(prefers-reduced-motion: reduce)", true);
    });
    await act(async () => {
      changeMedia("(prefers-reduced-motion: reduce)", false);
    });
    expect(
      container.querySelector("[data-motion]")!.getAttribute("data-motion"),
    ).toBe("paused");
    expect(buttonWithText("연출 재생").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("provides a complete static composition for explicit low-power mode", async () => {
    await mount(createElement(MiningCore, { running: true, lowPower: true }));
    await act(async () => {
      setInView(true);
    });
    expect(
      container.querySelector("[data-motion]")!.getAttribute("data-motion"),
    ).toBe("paused");
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("button")!.disabled).toBe(true);
  });

  it("fails to a static composition when intersection capability is unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await mount(createElement(MiningCore, { running: true }));
    expect(
      container
        .querySelector("[data-motion-quality]")!
        .getAttribute("data-motion-quality"),
    ).toBe("static");
  });

  it("fails to a static composition when CSS exists without its supports API", async () => {
    vi.stubGlobal("CSS", {});
    await mount(createElement(MiningCore, { running: true }));
    await act(async () => {
      setInView(true);
    });
    expect(
      container
        .querySelector("[data-motion-quality]")!
        .getAttribute("data-motion-quality"),
    ).toBe("static");
  });

  it("cleans up observers and does not notify after unmount", () => {
    const listener = vi.fn();
    const runtime = createAmbientRuntime(() => container);
    const remove = runtime.subscribe(listener);
    setInView(true);
    expect(runtime.getSnapshot().visible).toBe(true);
    remove();
    const count = listener.mock.calls.length;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    changeMedia("(prefers-reduced-data: reduce)", true);
    expect(listener).toHaveBeenCalledTimes(count);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each([
    [{ hardwareConcurrency: 2 }, false, true],
    [{ hardwareConcurrency: 8, deviceMemory: 2 }, false, true],
    [
      {
        hardwareConcurrency: 8,
        connection: Object.assign(new EventTarget(), { saveData: true }),
      },
      false,
      true,
    ],
    [{ hardwareConcurrency: 8 }, true, true],
    [{ hardwareConcurrency: 8 }, false, false],
  ])(
    "selects the constrained tier for device/data hints %#",
    (device, reducedData, animation) => {
      expect(
        hasConstrainedMotionCapability(device, reducedData, animation),
      ).toBe(true);
    },
  );

  it("does not treat missing optional hardware hints as a low-capability claim", () => {
    expect(
      hasConstrainedMotionCapability({ hardwareConcurrency: 8 }, false, true),
    ).toBe(false);
  });
});

describe("non-modal guidance and reduced scroll", () => {
  async function showQuest() {
    for (const target of ["world", "progress", "action", "boundary"]) {
      const node = document.createElement("button");
      node.dataset.questTarget = target;
      node.textContent = target;
      document.body.append(node);
    }
    await mount(
      createElement(GuidedQuest, { serverStage: "READY", ownerId: "qa-owner" }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  it("keeps background focus, uses a non-modal dialog, and Escape dismisses without stealing focus", async () => {
    const background = document.createElement("button");
    document.body.append(background);
    background.focus();
    await showQuest();
    expect(document.activeElement).toBe(background);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(
      container.querySelector("[role='dialog']")!.getAttribute("aria-modal"),
    ).toBe("false");
    expect(container.querySelector("[inert]")).toBeNull();
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(background);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("replay focuses the heading and dismiss returns focus to the replay button", async () => {
    await showQuest();
    await click(buttonWithText("나중에 보기"));
    const replay = buttonWithText("처음 안내 다시 보기");
    replay.focus();
    await click(replay);
    expect(document.activeElement?.tagName).toBe("H2");
    buttonWithText("나중에 보기").focus();
    await click(buttonWithText("나중에 보기"));
    expect(document.activeElement).toBe(replay);
  });

  it("uses instant scroll with reduced motion and cancels a smooth scroll on live preference change", async () => {
    await showQuest();
    await click(buttonWithText("다음"));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    await act(async () => {
      changeMedia("(prefers-reduced-motion: reduce)", true);
    });
    expect(window.scrollTo).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      behavior: "instant",
    });
    await click(buttonWithText("다음"));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "instant",
      block: "center",
    });
  });

  it("stops guidance when its real target disappears and returns coach focus", async () => {
    await showQuest();
    buttonWithText("다음").focus();
    await act(async () => {
      document.querySelector("[data-quest-target='world']")!.remove();
      // Also notify the listener used for route/viewport layout updates.
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(container.textContent).toContain("안내할 항목을 확인할 수 없어요");
    expect(document.activeElement).toBe(buttonWithText("처음 안내 다시 보기"));
  });

  it("automatic reduced guidance does not cancel scroll owned by another control", async () => {
    window.matchMedia("(prefers-reduced-motion: reduce)");
    changeMedia("(prefers-reduced-motion: reduce)", true);
    await showQuest();
    expect(window.scrollTo).not.toHaveBeenCalled();
    await click(buttonWithText("나중에 보기"));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("releases smooth-scroll ownership on scrollend before dismissal", async () => {
    await showQuest();
    await click(buttonWithText("다음"));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    document.dispatchEvent(new Event("scrollend"));
    await click(buttonWithText("나중에 보기"));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("queued layout observer callbacks cannot schedule a frame after unmount", async () => {
    await showQuest();
    const callback = resizeCallback;
    await act(async () => {
      root!.unmount();
      root = undefined;
    });
    const schedule = vi.spyOn(window, "requestAnimationFrame");
    callback([], {} as ResizeObserver);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does not replay a missing target scroll request on later automatic stage activation", async () => {
    await showQuest();
    document.querySelector("[data-quest-target='world']")!.remove();
    await click(buttonWithText("처음 안내 다시 보기"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();
    const target = document.createElement("button");
    target.dataset.questTarget = "world";
    document.body.append(target);
    await act(async () => {
      root!.render(
        createElement(GuidedQuest, {
          serverStage: "ACTIVE",
          ownerId: "qa-owner",
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("preserves dismissal only for the authenticated owner and does not mark domain progress", async () => {
    await showQuest();
    await click(buttonWithText("나중에 보기"));
    expect(
      window.localStorage.getItem("putduk-guided-quest:start-v1:qa-owner"),
    ).toBe("start-v1:READY");
    expect(
      window.localStorage.getItem("putduk-guided-quest:start-v1:other-owner"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("putduk-guided-quest:start-v1"),
    ).toBeNull();
  });

  it("remains dismissible when local storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await showQuest();
    await click(buttonWithText("나중에 보기"));
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("reduces safely when the media-query API is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(prefersReducedMotion()).toBe(true);
    const target = document.createElement("div");
    scrollQuestTarget(target, true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "center",
    });
  });
});

describe("coach and spotlight geometry", () => {
  it.each([
    { left: 20, top: -800, width: 100, height: 44 },
    { left: 20, top: 1200, width: 100, height: 44 },
    { left: -800, top: 0, width: 100, height: 844 },
    { left: 1200, top: 0, width: 100, height: 844 },
  ])(
    "keeps automatic guidance reachable when the real target is outside the viewport %#",
    (target) => {
      const position = placeCoachMark(
        target,
        { width: 340, height: 200 },
        { width: 390, height: 844 },
      );
      expect(position.left).toBeGreaterThanOrEqual(12);
      expect(position.top).toBeGreaterThanOrEqual(12);
      expect(position.left + 340).toBeLessThanOrEqual(378);
      expect(position.top + 200).toBeLessThanOrEqual(832);
    },
  );

  it("places the coach below a compact target without obscuring it", () => {
    expect(
      placeCoachMark(
        { left: 20, top: 20, width: 100, height: 44 },
        { width: 340, height: 200 },
        { width: 390, height: 844 },
      ),
    ).toEqual({ left: 20, top: 76 });
  });

  it("uses the space above a bottom action", () => {
    expect(
      placeCoachMark(
        { left: 20, top: 740, width: 300, height: 44 },
        { width: 340, height: 200 },
        { width: 390, height: 844 },
      ),
    ).toEqual({ left: 20, top: 528 });
  });

  it.each([390, 834, 1440])(
    "keeps a large-target coach within the %i px viewport",
    (width) => {
      const position = placeCoachMark(
        { left: 5, top: 10, width: width - 10, height: 780 },
        { width: Math.min(width - 24, 464), height: 280 },
        { width, height: 844 },
      );
      expect(position.left).toBeGreaterThanOrEqual(12);
      expect(position.top).toBeGreaterThanOrEqual(12);
      expect(position.left + Math.min(width - 24, 464)).toBeLessThanOrEqual(
        width - 12,
      );
      expect(position.top + 280).toBeLessThanOrEqual(832);
    },
  );

  it("clips the highlight to the viewport and skips targets entirely out of view", () => {
    expect(
      visibleSpotlight(
        { left: -20, top: -20, width: 500, height: 900 },
        { width: 390, height: 844 },
      ),
    ).toEqual({ left: 4, top: 4, width: 382, height: 836 });
    expect(
      visibleSpotlight(
        { left: 0, top: 900, width: 100, height: 100 },
        { width: 390, height: 844 },
      ),
    ).toBeNull();
  });
});
