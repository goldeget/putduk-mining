// @vitest-environment jsdom

import type { Page } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureRedactedWithdrawalEvidence,
  withdrawalPanelOffsets,
} from "@/tests/e2e/authenticated/helpers/withdrawal-evidence";

const artifacts = vi.hoisted(() => ({ writeFile: vi.fn(), mkdir: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  writeFile: artifacts.writeFile,
  mkdir: artifacts.mkdir,
  default: { writeFile: artifacts.writeFile, mkdir: artifacts.mkdir },
}));

type Shape = Parameters<typeof withdrawalPanelOffsets>[0];
type FakeHandle = { value: unknown; dispose: ReturnType<typeof vi.fn> };
let handle: FakeHandle;
let page: Page;
let screenshot: ReturnType<typeof vi.fn>;
let main: HTMLElement;
let shape: Shape;
let windowLeft: number;
let windowTop: number;
let originalScrollX: PropertyDescriptor | undefined;
let originalScrollY: PropertyDescriptor | undefined;
const base = Buffer.from("base-png");

function scroller(element: HTMLElement, current: Shape) {
  for (const key of Object.keys(current) as Array<keyof Shape>)
    Object.defineProperty(element, key, {
      configurable: true,
      get: () => current[key],
    });
  element.scrollTo = vi.fn(
    (options: ScrollToOptions | number = {}, y?: number) => {
      const requestedTop =
        typeof options === "number" ? (y ?? 0) : (options.top ?? 0);
      const requestedLeft =
        typeof options === "number" ? options : (options.left ?? 0);
      element.scrollTop = Math.max(
        0,
        Math.min(requestedTop, current.scrollHeight - current.clientHeight),
      );
      element.scrollLeft = Math.max(
        0,
        Math.min(requestedLeft, current.scrollWidth - current.clientWidth),
      );
    },
  );
  return element;
}

function report() {
  const write = artifacts.writeFile.mock.calls.at(-1)!;
  expect(write[0]).toBe("evidence/base.panels.json");
  return JSON.parse(write[1] as string) as {
    complete: boolean;
    baseCaptured: boolean;
    issues: string[];
    coverage: string;
    panels: Array<{ file: string; container: string; top: number }>;
    containers: Array<{ selected: boolean; kind: string }>;
  };
}

beforeEach(() => {
  artifacts.writeFile.mockReset().mockResolvedValue(undefined);
  artifacts.mkdir.mockReset().mockResolvedValue(undefined);
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/wallet/withdraw");
  windowLeft = 0;
  windowTop = 35;
  originalScrollX = Object.getOwnPropertyDescriptor(window, "scrollX");
  originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");
  Object.defineProperty(window, "scrollX", {
    configurable: true,
    get: () => windowLeft,
  });
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => windowTop,
  });
  vi.spyOn(window, "scrollTo").mockImplementation((options: unknown) => {
    if (!options || typeof options !== "object")
      throw new Error("Expected explicit scroll options");
    const position = options as ScrollToOptions;
    windowLeft = position.left ?? 0;
    windowTop = position.top ?? 0;
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    },
  );
  shape = {
    clientHeight: 400,
    clientWidth: 500,
    scrollHeight: 1200,
    scrollWidth: 500,
  };
  main = scroller(document.createElement("main"), shape);
  main.id = "main-content";
  main.scrollTop = 220;
  main.style.overflow = "auto";
  const input = document.createElement("input");
  input.name = "destinationReauthPassword";
  input.value = "must-remain-private";
  main.append(input);
  document.body.append(main);
  const mask = { selector: "redacted-controls" };
  screenshot = vi.fn().mockResolvedValue(base);
  const fakePage = {
    evaluateHandle: vi.fn(async (callback: () => unknown) => {
      handle = {
        value: callback(),
        dispose: vi.fn().mockResolvedValue(undefined),
      };
      return handle;
    }),
    evaluate: vi.fn(
      async (callback: (arg: unknown) => unknown, arg: unknown) => {
        let resolved = arg;
        if (arg === handle) resolved = handle.value;
        else if (
          arg &&
          typeof arg === "object" &&
          "state" in arg &&
          arg.state === handle
        )
          resolved = { ...arg, state: handle.value };
        return callback(resolved);
      },
    ),
    locator: vi.fn(() => mask),
    screenshot,
  };
  page = fakePage as unknown as Page;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalScrollX)
    Object.defineProperty(window, "scrollX", originalScrollX);
  if (originalScrollY)
    Object.defineProperty(window, "scrollY", originalScrollY);
});

describe("redacted financial evidence panels", () => {
  it("covers the end with overlapping offsets and reports a frame cap honestly", () => {
    expect(withdrawalPanelOffsets(shape)).toEqual({
      complete: true,
      offsets: [0, 300, 600, 800],
    });
    expect(withdrawalPanelOffsets(shape, 2)).toEqual({
      complete: false,
      offsets: [0, 300],
    });
    expect(withdrawalPanelOffsets({ ...shape, clientHeight: 0 }).complete).toBe(
      false,
    );
  });

  it("preserves base Buffer, actual values/layout, redaction on every frame and original scroll", async () => {
    const originalStyle = main.getAttribute("style");
    const result = await captureRedactedWithdrawalEvidence(
      page,
      "evidence/base.png",
    );
    expect(result).toBe(base);
    expect(screenshot).toHaveBeenCalledTimes(5);
    expect(screenshot.mock.calls[0]![0]).toMatchObject({
      path: "evidence/base.png",
      fullPage: true,
    });
    for (const [options] of screenshot.mock.calls) {
      expect(options.style).toContain("opacity: 0 !important");
      expect(options.style).not.toMatch(/height|overflow|display|position/);
      expect(options.mask).toEqual([{ selector: "redacted-controls" }]);
    }
    expect(
      screenshot.mock.calls
        .slice(1)
        .every(([options]) => options.fullPage === false),
    ).toBe(true);
    expect(main.querySelector("input")?.value).toBe("must-remain-private");
    expect(main.getAttribute("style")).toBe(originalStyle);
    expect(main.scrollTop).toBe(220);
    expect(windowTop).toBe(35);
    expect(report().complete).toBe(true);
    expect(report().panels.map((panel) => panel.top)).toEqual([
      0, 300, 600, 800,
    ]);
    expect(JSON.stringify(report())).not.toContain("must-remain-private");
    expect(handle.dispose).toHaveBeenCalledOnce();
  });

  it("captures active financial modal content while leaving the obscured main alone", async () => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.setAttribute("open", "");
    const content = scroller(document.createElement("div"), {
      clientHeight: 200,
      clientWidth: 400,
      scrollHeight: 720,
      scrollWidth: 400,
    });
    content.className = "modal__content";
    content.scrollTop = 120;
    dialog.append(content);
    document.body.append(dialog);
    await captureRedactedWithdrawalEvidence(page, "evidence/base.png");
    expect(report().coverage).toBe("active-modal");
    expect(report().panels.every((panel) => panel.container === "modal")).toBe(
      true,
    );
    expect(report().panels.at(-1)?.top).toBe(520);
    expect(main.scrollTop).toBe(220);
    expect(content.scrollTop).toBe(120);
    expect(report().complete).toBe(true);
  });

  it("bounds long content at twelve panels instead of marking partial coverage complete", async () => {
    shape.scrollHeight = 40000;
    await captureRedactedWithdrawalEvidence(page, "evidence/base.png");
    expect(report().panels).toHaveLength(12);
    expect(report().complete).toBe(false);
    expect(report().issues).toContain("main:FRAME_LIMIT");
    expect(main.scrollTop).toBe(220);
  });

  it("ignores an open financial dialog hidden by visibility instead of capturing its obscured pixels", async () => {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.setAttribute("open", "");
    dialog.style.visibility = "hidden";
    const content = scroller(document.createElement("div"), shape);
    content.className = "modal__content";
    dialog.append(content);
    document.body.append(dialog);
    await captureRedactedWithdrawalEvidence(page, "evidence/base.png");
    expect(report().coverage).toBe("main-or-document");
    expect(report().panels.every((panel) => panel.container === "main")).toBe(
      true,
    );
    expect(report().complete).toBe(true);
  });

  it("rejects a shape change during panel capture and still restores position", async () => {
    screenshot.mockImplementation(async (options) => {
      if (!options.fullPage) shape.scrollHeight += 100;
      return base;
    });
    await captureRedactedWithdrawalEvidence(page, "evidence/base.png");
    expect(report().complete).toBe(false);
    expect(report().issues).toContain("main:CHANGED_DURING_CAPTURE");
    expect(report().panels).toHaveLength(1);
    expect(main.scrollTop).toBe(220);
  });

  it("rejects a non-scrollable container changing during the base PNG", async () => {
    shape.scrollHeight = 400;
    main.scrollTop = 0;
    screenshot.mockImplementation(async () => {
      shape.clientWidth -= 1;
      return base;
    });
    await captureRedactedWithdrawalEvidence(page, "evidence/base.png");
    expect(report().complete).toBe(false);
    expect(report().issues).toContain("BASE_STATE_CHANGED");
  });

  it("does not capture an offset which the scroller failed to reach", async () => {
    main.scrollTo = vi.fn();
    await captureRedactedWithdrawalEvidence(page, "evidence/base.png");
    expect(screenshot).toHaveBeenCalledOnce();
    expect(report().complete).toBe(false);
    expect(report().issues).toContain("main:OFFSET_OR_SHAPE_CHANGED");
  });

  it("records a changed route instead of claiming those pixels share one state", async () => {
    screenshot.mockImplementation(async (options) => {
      if (!options.fullPage) window.history.replaceState(null, "", "/menu");
      return base;
    });
    await captureRedactedWithdrawalEvidence(page, "evidence/base.png");
    expect(report().complete).toBe(false);
    expect(report().issues).toContain("main:CHANGED_DURING_CAPTURE");
    expect(main.scrollTop).toBe(220);
  });

  it("restores and disposes even when screenshot creation fails", async () => {
    screenshot.mockRejectedValueOnce(new Error("SCREENSHOT_FAILED"));
    await expect(
      captureRedactedWithdrawalEvidence(page, "evidence/base.png"),
    ).rejects.toThrow("SCREENSHOT_FAILED");
    expect(main.scrollTop).toBe(220);
    expect(windowTop).toBe(35);
    expect(handle.dispose).toHaveBeenCalledOnce();
    expect(report().baseCaptured).toBe(false);
    expect(report().issues).toContain("CAPTURE_FAILED");
  });

  it("reports lost DOM restoration as incomplete instead of restoring a replacement node", async () => {
    screenshot.mockImplementation(async (options) => {
      if (!options.fullPage) main.remove();
      return base;
    });
    await captureRedactedWithdrawalEvidence(page, "evidence/base.png");
    expect(report().complete).toBe(false);
    expect(report().issues).toContain("SCROLL_RESTORE_INCOMPLETE");
  });
});
