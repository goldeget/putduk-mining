// @vitest-environment jsdom
import { act, createElement, Suspense, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RouteReloadButton } from "@/components/product/route-reload-button";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

let host: HTMLDivElement;
let root: Root;
let online: boolean;
let finishRead: () => void;

function mountRead() {
  function ReadView({ version }: { version: number }) {
    if (version > 0 && !read.done) throw read.promise;
    return createElement(
      "p",
      null,
      version > 0 ? "새 조회 결과" : "기존 오류 화면",
    );
  }
  const read = {
    done: false,
    promise: new Promise<void>((resolve) => {
      finishRead = () => {
        read.done = true;
        resolve();
      };
    }),
  };
  function ReadHost() {
    const [version, setVersion] = useState(0);
    mocks.refresh.mockImplementation(() => setVersion((value) => value + 1));
    return createElement(
      Suspense,
      { fallback: createElement("p", null, "불러오는 중") },
      createElement(RouteReloadButton),
      createElement(ReadView, { version }),
    );
  }
  return act(async () => root.render(createElement(ReadHost)));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("route read pending display, without changing refresh semantics", () => {
  it("a stalled transition exposes recovery at15s without automatic refresh or ready inference", async () => {
    await mountRead();
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      true,
    );
    await act(async () => vi.advanceTimersByTimeAsync(14_999));
    expect(host.querySelector('[role="status"]')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "조회가 지연",
    );
    const reload = host.querySelector<HTMLButtonElement>(
      ".route-reload-recovery button",
    )!;
    expect(reload.disabled).toBe(false);
    expect(reload.textContent).toBe("페이지 새로고침");
    expect(host.textContent).toContain("기존 오류 화면");
    expect(host.textContent).not.toContain("새 조회 결과");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(
      host
        .querySelector<HTMLButtonElement>("button")!
        .getAttribute("aria-describedby"),
    ).toBe(host.querySelector('[role="status"]')!.id);
  });

  it("offline pending offers recovery immediately; reconnect alone never declares completion", async () => {
    await mountRead();
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    await act(async () => {
      online = false;
      window.dispatchEvent(new Event("offline"));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "오프라인",
    );
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      true,
    );
    await act(async () => {
      online = true;
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "조회가 지연",
    );
    expect(host.textContent).not.toContain("새 조회 결과");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("only resolving the read clears pending and its fallback", async () => {
    await mountRead();
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    await act(async () => finishRead());
    expect(host.textContent).toContain("새 조회 결과");
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(
      false,
    );
    expect(
      host.querySelector<HTMLButtonElement>("button")!.textContent,
    ).toContain("다시 확인");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("unmount clears the display deadline and a late read cannot create recovery UI", async () => {
    await mountRead();
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      finishRead();
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(host.textContent).toBe("");
  });
});
