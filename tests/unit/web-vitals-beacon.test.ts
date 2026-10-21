// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://fixture.putduk.test"}
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Metric = Parameters<
  Parameters<typeof import("next/web-vitals").useReportWebVitals>[0]
>[0];
const framework = vi.hoisted(() => ({
  callbacks: [] as ((metric: Metric) => void)[],
}));
vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (callback: (metric: Metric) => void) => {
    framework.callbacks.push(callback);
  },
}));
import { WebVitalsBeacon } from "@/components/system/web-vitals-beacon";

let host: HTMLDivElement, root: Root;
const transport = vi.fn<typeof fetch>();
const render = () =>
  act(async () => root.render(createElement(WebVitalsBeacon)));
function report(name: string, value: number, navigationType = "navigate") {
  const callback = framework.callbacks.at(-1);
  expect(callback).toBeTypeOf("function");
  callback!({
    name,
    value,
    navigationType,
    id: "never-send-metric-id",
    delta: 999999,
    rating: "poor",
    get entries() {
      throw new Error("DOM_ENTRY_MUST_NOT_BE_READ");
    },
  } as Metric);
}
beforeEach(() => {
  vi.clearAllMocks();
  framework.callbacks.length = 0;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_APP_RELEASE", "");
  vi.stubGlobal("PerformanceObserver", undefined);
  vi.stubGlobal("fetch", transport);
  transport.mockResolvedValue(new Response(null, { status: 204 }));
  window.sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("framework Web Vitals to the real analytics transport", () => {
  it.each([
    [
      "LCP",
      1800.4,
      {
        vital_name: "LCP",
        vital_rating: "good",
        vital_unit: "ms",
        vital_value: 1800,
        navigation_type: "navigate",
      },
    ],
    [
      "INP",
      280.2,
      {
        vital_name: "INP",
        vital_rating: "needs_improvement",
        vital_unit: "ms",
        vital_value: 280,
        navigation_type: "navigate",
      },
    ],
    [
      "CLS",
      0.12,
      {
        vital_name: "CLS",
        vital_rating: "needs_improvement",
        vital_unit: "milli",
        vital_value: 120,
        navigation_type: "navigate",
      },
    ],
  ] as const)(
    "uses the framework %s value and sends only allowlisted properties",
    async (name, value, expected) => {
      await render();
      report(name, value);
      expect(transport).toHaveBeenCalledTimes(1);
      const [url, init] = transport.mock.calls[0]!;
      expect(url).toBe("/api/v1/analytics");
      expect(init).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      });
      const body = JSON.parse(String(init!.body));
      expect(body.eventName).toBe("web_vital");
      expect(body.properties).toEqual(expected);
      expect(String(init!.body)).not.toContain("never-send-metric-id");
    },
  );
  it("retains the same reporting callback across rerenders", async () => {
    await render();
    const first = framework.callbacks.at(-1);
    expect(first).toBeTypeOf("function");
    await render();
    expect(framework.callbacks.at(-1)).toBe(first);
  });
  it("accepts a framework interaction result after ten seconds and preserves allowed navigation metadata", async () => {
    vi.useFakeTimers();
    await render();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(transport).not.toHaveBeenCalled();
    report("INP", 220, "back-forward-cache");
    expect(
      JSON.parse(String(transport.mock.calls[0]![1]!.body)).properties,
    ).toEqual({
      vital_name: "INP",
      vital_rating: "needs_improvement",
      vital_unit: "ms",
      vital_value: 220,
      navigation_type: "back_forward_cache",
    });
  });
  it("does not invent a CLS zero when the framework has no supported sample", async () => {
    await render();
    expect(host.textContent).toBe("");
    expect(transport).not.toHaveBeenCalled();
  });
  it("ignores other metrics and invalid values without analytics calls", async () => {
    await render();
    for (const [name, value] of [
      ["TTFB", 5],
      ["FCP", 5],
      ["FID", 5],
      ["CLS", -1],
      ["INP", NaN],
      ["LCP", Infinity],
    ] as const)
      report(name, value);
    expect(transport).not.toHaveBeenCalled();
  });
  it("keeps storage and transport failures outside the page flow", async () => {
    await render();
    const storage = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    expect(() => report("LCP", 100)).not.toThrow();
    expect(transport).not.toHaveBeenCalled();
    storage.mockRestore();
    transport.mockRejectedValueOnce(new TypeError("transport unavailable"));
    expect(() => report("INP", 110)).not.toThrow();
    await Promise.resolve();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
