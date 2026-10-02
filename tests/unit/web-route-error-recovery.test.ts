// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ErrorBoundaryHandler } from "next/dist/client/components/error-boundary";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import ErrorPage from "../../app/error";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("the installed Next boundary refetches a failed snapshot when recovery is clicked", async () => {
  // Reproduces a stale failing read. A reset alone immediately reads the same
  // failed snapshot; the installed framework retry refreshes before resetting.
  let fresh = false;
  const refresh = vi.fn(() => {
    fresh = true;
  });
  const router = {
    bfcacheId: "read-only-test-fixture",
    refresh,
    back: vi.fn(),
    forward: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  };
  function ReadOnlySnapshot() {
    if (!fresh) throw new Error("synthetic unavailable read");
    return createElement("h1", null, "다시 확인한 화면");
  }
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () =>
    root.render(
      createElement(
        AppRouterContext.Provider,
        { value: router },
        createElement(
          ErrorBoundaryHandler,
          {
            pathname: "/local-read-only-fixture",
            errorComponent: ErrorPage,
          },
          createElement(ReadOnlySnapshot),
        ),
      ),
    ),
  );
  expect(host.textContent).toContain("화면을 불러오지 못했습니다");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("다시 확인한 화면");
  expect(host.textContent).not.toContain("화면을 불러오지 못했습니다");
});

it("retains a supplied reset fallback when a retry callback is unavailable", async () => {
  const reset = vi.fn();
  await act(async () =>
    root.render(createElement(ErrorPage, { error: new Error("test"), reset })),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(reset).toHaveBeenCalledOnce();
});

it("does not offer an inert recovery button without either callback", async () => {
  await act(async () =>
    root.render(createElement(ErrorPage, { error: new Error("test") })),
  );
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
});
