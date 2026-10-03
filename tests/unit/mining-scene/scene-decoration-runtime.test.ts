// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SceneDecoration,
  sceneAnchorPosition,
  sceneCanvasSize,
  SCENE_MOTION_LIMITS,
} from "@/components/mining-live/scene-decoration";

let host: HTMLDivElement;
let root: Root;
let callbacks: Map<number, FrameRequestCallback>;
let frameId: number;
let intersection: IntersectionObserverCallback;
let resize: ResizeObserverCallback;
let media: MediaQueryList;
let reduced: boolean;
let hidden: boolean;
let bounds: DOMRect;
let context: CanvasRenderingContext2D;
let observerDisconnect: ReturnType<typeof vi.fn>;
let resizeDisconnect: ReturnType<typeof vi.fn>;

function rect(width = 1000, height = 600, top = 0): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

async function render(
  props: Partial<Parameters<typeof SceneDecoration>[0]> = {},
) {
  await act(async () => {
    root.render(
      createElement(SceneDecoration, {
        enabled: true,
        anchor: { x: 0.5, y: 0.46 },
        particleCount: 12,
        ...props,
      }),
    );
  });
}

function canvas() {
  return host.querySelector("canvas")!;
}

function intersect(visible: boolean) {
  intersection(
    [
      {
        boundingClientRect: bounds,
        intersectionRatio: visible ? 1 : 0,
        intersectionRect: visible ? bounds : rect(0, 0),
        target: canvas(),
        isIntersecting: visible,
        rootBounds: null,
        time: 0,
      },
    ],
    {} as IntersectionObserver,
  );
}

function tick(timestamp: number) {
  const next = callbacks.entries().next().value;
  expect(next).toBeDefined();
  const [id, callback] = next!;
  callbacks.delete(id);
  callback(timestamp);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  callbacks = new Map();
  frameId = 0;
  reduced = false;
  hidden = false;
  bounds = rect();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  context = {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(() => bounds);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(8);
  vi.stubGlobal("devicePixelRatio", 3);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      callbacks.set(++frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => callbacks.delete(id)),
  );
  media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { get: () => reduced });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  observerDisconnect = vi.fn();
  resizeDisconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback;
      }
      observe = vi.fn();
      disconnect = observerDisconnect;
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = resizeDisconnect;
    },
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bounded scene decoration", () => {
  it("projects the approved anchor into the actual centered cover crop", () => {
    expect(
      sceneAnchorPosition(1000, 500, 1000, 1000, { x: 0.5, y: 0.3 }),
    ).toEqual({
      x: 500,
      y: 50,
    });
    expect(
      sceneAnchorPosition(300, 600, 1500, 1000, { x: 0.5, y: 0.235 }),
    ).toEqual({
      x: 150,
      y: 141,
    });
    expect(sceneAnchorPosition(300, 600, 0, 0, { x: 0.5, y: 0.5 })).toEqual({
      x: 150,
      y: 300,
    });
  });

  it("caps pixel dimensions, pixel area and DPR without changing CSS dimensions", () => {
    const size = sceneCanvasSize(5000, 3000, 8);
    expect(size.width).toBeLessThanOrEqual(SCENE_MOTION_LIMITS.maxDimension);
    expect(size.height).toBeLessThanOrEqual(SCENE_MOTION_LIMITS.maxDimension);
    expect(size.width * size.height).toBeLessThanOrEqual(
      SCENE_MOTION_LIMITS.maxPixels,
    );
    expect(sceneCanvasSize(320, 180, 4)).toEqual({
      width: 480,
      height: 270,
      scale: 1.5,
    });
    expect(sceneCanvasSize(0, 100, 2)).toEqual({
      width: 0,
      height: 0,
      scale: 0,
    });
    expect(sceneCanvasSize(Number.NaN, 100, 2).scale).toBe(0);
  });

  it("waits for visibility, then owns one canvas and one scheduled frame", async () => {
    await render({ particleCount: 999, maxFps: 120, maxDpr: 8 });
    expect(callbacks.size).toBe(0);
    intersect(true);
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
    expect(canvas().getAttribute("aria-hidden")).toBe("true");
    expect(canvas().dataset.motionFps).toBe("30");
    expect(canvas().dataset.particleCount).toBe("12");
    expect(canvas().width * canvas().height).toBeLessThanOrEqual(
      SCENE_MOTION_LIMITS.maxPixels,
    );
    expect(callbacks.size).toBe(1);
    tick(0);
    expect(context.fill).toHaveBeenCalledTimes(12);
    expect(callbacks.size).toBe(1);
    intersect(true);
    expect(callbacks.size).toBe(1);
    tick(16);
    expect(context.fill).toHaveBeenCalledTimes(12);
    tick(34);
    expect(context.fill).toHaveBeenCalledTimes(24);
    expect(host.textContent).toBe("");
  });

  it("stops and resumes on offscreen, visibility and OS reduced-motion changes", async () => {
    await render();
    intersect(true);
    expect(callbacks.size).toBe(1);
    intersect(false);
    expect(callbacks.size).toBe(0);
    expect(canvas().dataset.motionState).toBe("paused");
    intersect(true);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callbacks.size).toBe(0);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callbacks.size).toBe(1);
    reduced = true;
    media.dispatchEvent(new Event("change"));
    expect(callbacks.size).toBe(0);
    reduced = false;
    media.dispatchEvent(new Event("change"));
    expect(callbacks.size).toBe(1);
  });

  it("starts static when reduce is already set and removes motion on server pause", async () => {
    reduced = true;
    await render();
    intersect(true);
    expect(callbacks.size).toBe(0);
    reduced = false;
    media.dispatchEvent(new Event("change"));
    expect(callbacks.size).toBe(1);
    await render({ enabled: false });
    expect(host.querySelector("canvas")).toBeNull();
    expect(callbacks.size).toBe(0);
    expect(observerDisconnect).toHaveBeenCalledOnce();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
  });

  it("resizes the same canvas and does not accumulate frame loops", async () => {
    await render();
    intersect(true);
    bounds = rect(320, 540);
    resize([], {} as ResizeObserver);
    expect(canvas().width).toBe(480);
    expect(canvas().height).toBe(810);
    expect(callbacks.size).toBe(1);
    bounds = rect(0, 0);
    resize([], {} as ResizeObserver);
    expect(callbacks.size).toBe(0);
    bounds = rect(320, 540);
    resize([], {} as ResizeObserver);
    expect(callbacks.size).toBe(1);
  });

  it("reduces only effects on a constrained device", async () => {
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(2);
    await render();
    intersect(true);
    expect(canvas().dataset.motionQuality).toBe("reduced");
    expect(canvas().dataset.motionFps).toBe("15");
    expect(canvas().dataset.particleCount).toBe("4");
    expect(canvas().width).toBe(1000);
    tick(0);
    expect(context.fill).toHaveBeenCalledTimes(4);
    expect(callbacks.size).toBe(1);
  });

  it("adapts after repeated costly paints without touching any image or HTML state", async () => {
    await render();
    intersect(true);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 9));
    tick(0);
    tick(34);
    tick(68);
    expect(canvas().dataset.motionQuality).toBe("reduced");
    expect(canvas().dataset.motionFps).toBe("15");
    expect(canvas().width).toBe(1000);
    expect(callbacks.size).toBe(1);
    expect(host.textContent).toBe("");
  });

  it("adapts after repeated delayed frames", async () => {
    await render();
    intersect(true);
    for (let time = 0; time <= 1000; time += 200) tick(time);
    expect(canvas().dataset.motionQuality).toBe("reduced");
    expect(callbacks.size).toBe(1);
  });

  it("falls back safely if context construction or a draw fails", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => {
        throw new Error("device context unavailable");
      },
    );
    await render();
    expect(canvas().dataset.motionState).toBe("unavailable");
    expect(callbacks.size).toBe(0);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context,
    );
    await render({ maxFps: 25 });
    intersect(true);
    vi.mocked(context.arc).mockImplementation(() => {
      throw new Error("lost context");
    });
    tick(0);
    expect(canvas().dataset.motionState).toBe("unavailable");
    expect(callbacks.size).toBe(0);
  });

  it("uses capture-phase scroll visibility when observers are unavailable", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.stubGlobal("ResizeObserver", undefined);
    await render();
    expect(callbacks.size).toBe(1);
    bounds = rect(320, 540, -600);
    host.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(callbacks.size).toBe(0);
    bounds = rect(320, 540);
    window.dispatchEvent(new Event("resize"));
    expect(callbacks.size).toBe(1);
    expect(canvas().width).toBe(480);
  });

  it("stops on context loss and keeps subsequent visibility events static", async () => {
    await render();
    intersect(true);
    const lost = new Event("contextlost", { cancelable: true });
    canvas().dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(canvas().dataset.motionState).toBe("unavailable");
    expect(callbacks.size).toBe(0);
    document.dispatchEvent(new Event("visibilitychange"));
    intersect(true);
    expect(callbacks.size).toBe(0);
  });

  it("fails closed if media preference cannot be read", async () => {
    vi.stubGlobal("matchMedia", undefined);
    await render();
    expect(canvas().dataset.motionState).toBe("unavailable");
    expect(callbacks.size).toBe(0);
  });

  it("rejects invalid anchors and particle counts", async () => {
    await render({ anchor: { x: 2, y: 0.5 } });
    expect(callbacks.size).toBe(0);
    await render({ particleCount: Number.NaN });
    intersect(true);
    expect(callbacks.size).toBe(0);
    expect(canvas().dataset.particleCount).toBe("0");
  });

  it("cleans observers, listeners and the last scheduled frame on unmount", async () => {
    const mediaRemove = vi.spyOn(media, "removeEventListener");
    await render();
    intersect(true);
    const lateCallback = callbacks.values().next().value!;
    await act(async () => root.unmount());
    expect(callbacks.size).toBe(0);
    expect(observerDisconnect).toHaveBeenCalledOnce();
    expect(resizeDisconnect).toHaveBeenCalledOnce();
    expect(mediaRemove).toHaveBeenCalledWith("change", expect.any(Function));
    lateCallback(100);
    expect(callbacks.size).toBe(0);
    // Recreate a root for the common cleanup hook.
    root = createRoot(host);
  });
});
