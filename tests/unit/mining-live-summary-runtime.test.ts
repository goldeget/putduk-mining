// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MiningLiveSummary } from "@/components/product/mining-live-summary";
import type { MiningLiveSnapshot } from "@/lib/product/mining-live-snapshot";

type AuthObserver = (
  event: string,
  session: { user: { id: string } } | null,
) => void;
const mocks = vi.hoisted(() => ({
  observe: null as AuthObserver | null,
  unsubscribe: vi.fn(),
  reduced: true,
  fetch: vi.fn(),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: (callback: AuthObserver) => {
        mocks.observe = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  }),
}));
vi.mock("@/lib/motion/motion-preference", () => ({
  useMotionPreference: () => mocks.reduced,
}));
const receipt: MiningLiveSnapshot = {
  scope: "GLOBAL_CYCLE",
  cycleStartedAt: "2026-10-01T00:00:00.000000Z",
  cycleEnd: "2026-11-01T00:00:00.000000Z",
  stateRevision: "10",
  conditionRevision: "2",
  acceptedCursorAt: "2026-10-13T00:00:00.000001Z",
  evaluatedAt: "2026-10-13T00:00:00.000002Z",
  status: "ACTIVE",
  stopReason: null,
  pendingMicroKrw: "1234567",
  committedKrw: "12",
  capacityMicroKrw: "10000000",
  usedMicroKrw: "1000000",
  remainingMicroKrw: "9000000",
};
const authConfig = {
  url: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_synthetic_testing",
};
const response = (snapshot: MiningLiveSnapshot | null, ownerId = "owner") =>
  new Response(JSON.stringify({ data: { ownerId, snapshot } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
let root: Root,
  host: HTMLDivElement,
  visible: DocumentVisibilityState,
  online: boolean;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  mocks.observe = null;
  mocks.reduced = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
  visible = "visible";
  online = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visible,
  );
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  mocks.fetch.mockImplementation(async () => response(receipt));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const mount = async (ownerId = "owner", initialSnapshot = receipt) =>
  act(async () =>
    root.render(
      createElement(MiningLiveSummary, {
        ownerId,
        initialSnapshot,
        authConfig,
      }),
    ),
  );
const auth = async (
  event = "INITIAL_SESSION",
  ownerId: string | null = "owner",
) =>
  act(async () =>
    mocks.observe!(event, ownerId ? { user: { id: ownerId } } : null),
  );
const advance = async (time: number) =>
  act(async () => vi.advanceTimersByTimeAsync(time));
const amounts = () => host.querySelector("dl");

describe("foreground owned mining facts", () => {
  it("renders no money in SSR or before the matching browser INITIAL_SESSION", async () => {
    expect(
      renderToStaticMarkup(
        createElement(MiningLiveSummary, {
          ownerId: "owner",
          initialSnapshot: receipt,
          authConfig,
        }),
      ),
    ).not.toContain("1.234567원");
    await mount();
    expect(amounts()).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
    await auth("TOKEN_REFRESHED");
    expect(amounts()).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
    await auth();
    expect(amounts()?.textContent).toContain("1.234567원");
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0]![1]).toMatchObject({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Putduk-Mining-Owner": "owner" },
    });
  });
  it("clears account facts and aborts an in-flight response on account change", async () => {
    let finish!: (response: Response) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    await auth();
    const signal = mocks.fetch.mock.calls[0]![1].signal as AbortSignal;
    await auth("SIGNED_IN", "other");
    expect(signal.aborted).toBe(true);
    expect(amounts()).toBeNull();
    await act(async () =>
      finish(
        response({
          ...receipt,
          evaluatedAt: "2026-10-13T00:00:01.000000Z",
          pendingMicroKrw: "999000000",
        }),
      ),
    );
    expect(amounts()).toBeNull();
    await advance(30_000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    await auth("SIGNED_IN", "owner");
    expect(amounts()).toBeNull();
  });
  it("opens a new owner context with no previous visible amount or auth authority", async () => {
    await mount();
    await auth();
    expect(amounts()).not.toBeNull();
    await mount("other", { ...receipt, pendingMicroKrw: "222000000" });
    expect(amounts()).toBeNull();
    expect(host.textContent).not.toContain("1.234567원");
    mocks.fetch.mockImplementation(async () => response(receipt, "other"));
    await auth("INITIAL_SESSION", "other");
    expect(amounts()).not.toBeNull();
  });
  it.each([401, 409])(
    "blocks an invalidated server session (%s)",
    async (status) => {
      mocks.fetch.mockResolvedValue(new Response("{}", { status }));
      await mount();
      await auth();
      expect(amounts()).toBeNull();
      expect(host.textContent).toContain("화면을 다시 열어");
      await advance(30_000);
      expect(mocks.fetch).toHaveBeenCalledOnce();
    },
  );
  it("blocks a cross-owner envelope, even on HTTP200", async () => {
    mocks.fetch.mockResolvedValue(response(receipt, "other"));
    await mount();
    await auth();
    expect(amounts()).toBeNull();
  });
  it("preserves the last verified amount on read failure and reverse receipts", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(
        response({
          ...receipt,
          stateRevision: "9",
          evaluatedAt: "2026-10-13T00:00:01.000000Z",
          pendingMicroKrw: "999000000",
        }),
      );
    await mount();
    await auth();
    expect(
      host.querySelector("[data-read-state]")?.getAttribute("data-read-state"),
    ).toBe("stale");
    expect(amounts()?.textContent).toContain("1.234567원");
    await advance(10_000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(amounts()?.textContent).not.toContain("999원");
    expect(amounts()?.textContent).toContain("1.234567원");
    expect(
      host.querySelector("[data-read-state]")?.getAttribute("data-read-state"),
    ).toBe("stale");
  });
  it("aborts hidden requests and performs no hidden/offline polling", async () => {
    let finish!: (response: Response) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    await auth();
    visible = "hidden";
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect((mocks.fetch.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(
      true,
    );
    await act(async () => finish(response(receipt)));
    await advance(30_000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    visible = "visible";
    online = false;
    await act(async () => window.dispatchEvent(new Event("offline")));
    await advance(30_000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    mocks.fetch.mockImplementation(async () => response(receipt));
    online = true;
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it("never overlaps an outstanding read with interval or manual requests", async () => {
    mocks.fetch.mockImplementation(() => new Promise<Response>(() => {}));
    await mount();
    await auth();
    await advance(7_000);
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("adopts a stopped server target exactly and stops automatic polling", async () => {
    const stopped = {
      ...receipt,
      evaluatedAt: "2026-10-13T00:00:01.000000Z",
      status: "STOPPED",
      stopReason: "CAPACITY_USED",
      pendingMicroKrw: "2000000",
    } as const;
    mocks.reduced = false;
    mocks.fetch.mockResolvedValue(response(stopped));
    await mount();
    await auth();
    expect(amounts()?.textContent).toContain("2원");
    expect(host.textContent).toContain("이번 한도를 모두 사용");
    await advance(30_000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("reduced motion applies the new authoritative target without an animation", async () => {
    mocks.fetch.mockResolvedValue(
      response({
        ...receipt,
        evaluatedAt: "2026-10-13T00:00:01.000000Z",
        pendingMicroKrw: "2345678",
      }),
    );
    await mount();
    await auth();
    expect(amounts()?.textContent).toContain("2.345678원");
    expect(vi.getTimerCount()).toBe(1); // Only the next read, no animation frames.
  });
  it("recovers automatic reads only after a valid manual read", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockImplementation(async () =>
        response({ ...receipt, evaluatedAt: "2026-10-13T00:00:01.000000Z" }),
      );
    await mount();
    await auth();
    await advance(20_000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    await act(async () =>
      host.querySelector<HTMLButtonElement>("button")!.click(),
    );
    expect(
      host.querySelector("[data-read-state]")?.getAttribute("data-read-state"),
    ).toBe("fresh");
    await advance(10_000);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it("stops malformed same-owner reads without falsely claiming an account change", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            ownerId: "owner",
            snapshot: { ...receipt, pendingMicroKrw: "NaN" },
          },
        }),
        { status: 200 },
      ),
    );
    await mount();
    await auth();
    expect(amounts()?.textContent).toContain("1.234567원");
    expect(host.textContent).not.toContain("로그인 상태가 바뀌었어요");
    await advance(30_000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("requires reopening for a new cycle and never combines cycles", async () => {
    mocks.fetch.mockResolvedValue(
      response({
        ...receipt,
        cycleStartedAt: "2026-10-12T00:00:00.000000Z",
        pendingMicroKrw: "999000000",
      }),
    );
    await mount();
    await auth();
    expect(host.textContent).toContain("채굴 기간이 바뀌었어요");
    expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    expect(amounts()?.textContent).not.toContain("999원");
    await advance(30_000);
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("does no automatic read for exhausted server capacity even if status is ACTIVE", async () => {
    await mount("owner", {
      ...receipt,
      usedMicroKrw: "10000000",
      remainingMicroKrw: "0",
    });
    await auth();
    expect(host.textContent).toContain("자동 확인을 멈췄어요");
    await advance(30_000);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("animates only between confirmed targets and settles within the short transition", async () => {
    mocks.reduced = false;
    mocks.fetch.mockResolvedValue(
      response({
        ...receipt,
        evaluatedAt: "2026-10-13T00:00:01.000000Z",
        pendingMicroKrw: "2345678",
      }),
    );
    await mount();
    await auth();
    await advance(176);
    const visual = host.querySelector("dl dd [aria-hidden=true]")!.textContent!;
    expect(visual).not.toBe("1.234567원");
    expect(visual).not.toBe("2.345678원");
    await advance(200);
    expect(host.querySelector("dl dd [aria-hidden=true]")!.textContent).toBe(
      "2.345678원",
    );
  });
});
