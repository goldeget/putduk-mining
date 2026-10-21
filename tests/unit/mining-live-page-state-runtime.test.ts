// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MiningPage from "@/app/(product)/mining/page";
import { toMiningLiveSnapshot } from "@/lib/product/mining-live-snapshot";
import { parseMiningServerDisplay } from "@/lib/product/mining-server-display";

type AuthObserver = (
  event: string,
  session: { user: { id: string } } | null,
) => void;
const mocks = vi.hoisted(() => ({
  observe: null as AuthObserver | null,
  fetch: vi.fn(),
  reduced: false,
  display: null as unknown,
  sceneRenders: 0,
}));
vi.mock("@/lib/auth/session", () => ({
  requirePageUser: async () => ({
    userId: "owner",
    supabase: {
      from(table: string) {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          order() {
            return chain;
          },
          limit() {
            return chain;
          },
          maybeSingle() {
            return chain;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({
              data:
                table === "trial_account_snapshots"
                  ? { status: "READY" }
                  : table === "wallet_balance_snapshots"
                    ? null
                    : [],
              error: null,
            }).then(resolve);
          },
        };
        return chain;
      },
    },
  }),
}));
vi.mock("@/lib/product/read-mining-server-display", () => ({
  readOwnMiningServerDisplay: async () => ({
    data: mocks.display,
    error: null,
  }),
}));
vi.mock("@/lib/product/read-member-scene-binding.server", () => ({
  readMemberSceneBinding: async () => ({ state: "empty", products: [] }),
}));
vi.mock("@/lib/env/public", () => ({
  getPublicEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_testing",
  }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange(callback: AuthObserver) {
        mocks.observe = callback;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  }),
}));
vi.mock("@/lib/design/use-resolved-theme", () => ({
  useResolvedTheme: () => {
    mocks.sceneRenders += 1;
    return "dark";
  },
}));
vi.mock("@/lib/motion/motion-preference", () => ({
  useMotionPreference: () => mocks.reduced,
}));
vi.mock("@/lib/motion/ambient-runtime", () => ({
  useAmbientRuntime: () => ({ available: true, visible: true }),
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
  }) => {
    void _prefetch;
    return createElement("a", { href, ...props }, children);
  },
}));

const display = parseMiningServerDisplay({
  available: true,
  eligible_principal_micro_krw: "5000000000000",
  tier_code: "L5",
  tier_activated: true,
  cycle_started_at: "2026-10-01T00:00:00.000000Z",
  cycle_end: "2026-11-01T00:00:00.000000Z",
  effective_capacity_micro_krw: "10000000",
  remaining_capacity_micro_krw: "9000000",
  used_capacity_micro_krw: "1000000",
  speed_multiplier_bps: "10000",
  pending_micro_krw: "1234567",
  retention_unconfirmed_micro_krw: "0",
  funded_runtime: {
    schema_version: 2,
    runtime_version: 2,
    state_revision: "10",
    condition_revision: "2",
    accepted_cursor_at: "2026-10-13T00:00:00.000001Z",
    evaluated_at: "2026-10-13T00:00:00.000002Z",
    allocation_bps: "5000",
    committed_reward_total_atomic: "12",
    reward_carry: { numerator: "1", denominator: "7", unit: "KRW" },
    conditional_maintenance: {
      numerator: "1",
      denominator: "3",
      unit: "KRW",
      qualification: "UNCONFIRMED",
    },
    status: "ACTIVE",
    stop_reason: null,
    speed: {
      product_multiplier_bps: "10000",
      user_multiplier_bps: "10000",
      common_multiplier: { numerator: "1", denominator: "1" },
      effective_global_multiplier: { numerator: "1", denominator: "2" },
    },
  },
});
if (!display) throw new Error("strict synthetic mining display fixture");
const receipt = toMiningLiveSnapshot(display)!;
const response = (value = receipt) =>
  new Response(
    JSON.stringify({ data: { ownerId: "owner", snapshot: value } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
let root: Root, host: HTMLDivElement, visibility: DocumentVisibilityState;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.observe = null;
  mocks.fetch.mockReset();
  mocks.reduced = false;
  mocks.sceneRenders = 0;
  mocks.display = display;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mocks.fetch.mockImplementation(async () => response());
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
const mount = async () => {
  const page = await MiningPage();
  await act(async () => root.render(page));
  await act(async () =>
    mocks.observe!("INITIAL_SESSION", { user: { id: "owner" } }),
  );
};
const scene = () =>
  host.querySelector("[data-scene-theme][data-mining-running]");
const caption = () =>
  host.querySelector('section[aria-label="채굴 현황"] > div');

it("applies an accepted STOPPED receipt to the page pill, heading, scene and summary together", async () => {
  await mount();
  expect(scene()?.getAttribute("data-mining-running")).toBe("true");
  expect(caption()?.textContent).toContain("채굴 중");
  mocks.fetch.mockResolvedValue(
    response({
      ...receipt,
      stateRevision: "11",
      evaluatedAt: "2026-10-13T00:00:01.000000Z",
      status: "STOPPED",
      stopReason: "CAPACITY_USED",
      pendingMicroKrw: "2000000",
    }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(
    host.querySelector("[data-mining-live-summary]")?.textContent,
  ).toContain("2.0000원");
  expect(caption()?.textContent).toContain("이번 한도 완료");
  expect(caption()?.textContent).not.toContain("채굴 중");
  expect(scene()?.getAttribute("data-mining-running")).toBe("false");
  expect(scene()?.getAttribute("data-motion")).toBe("static");
  expect(host.querySelector("[data-mining-energy]")).toBeNull();
  expect(
    host.querySelector('dl[aria-label="채굴 기간"]')?.textContent,
  ).toContain("이번 한도 완료");
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});

it("pauses the shared running hint while hidden and clears it after owner change", async () => {
  await mount();
  visibility = "hidden";
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(scene()?.getAttribute("data-mining-running")).toBe("false");
  expect(
    host.querySelector('dl[aria-label="채굴 속도"]')?.textContent,
  ).toContain("마지막 확인 속도");
  expect(host.textContent).not.toContain("현재 채굴은 멈췄어요.");
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(mocks.fetch).toHaveBeenCalledOnce();
  await act(async () => mocks.observe!("SIGNED_OUT", null));
  expect(scene()?.getAttribute("data-mining-running")).toBe("false");
  expect(caption()?.textContent).not.toContain("채굴 중");
  expect(host.querySelector("[data-mining-live-summary]")).toBeNull();
});

it("keeps amount repainting local without rerendering the scene for ticks or unchanged accepted status", async () => {
  const projected = {
    ...receipt,
    evaluatedAt: "2026-10-13T00:01:40.000000Z",
    projection: {
      accruedMicroKrw: "38599",
      windowMicros: "100000000",
      ceilingMicroKrw: "9000000",
      horizonMicros: "120000000",
    },
  };
  mocks.fetch.mockImplementation(async () => response(projected));
  await mount();
  const sceneRenders = mocks.sceneRenders;
  const amount = () =>
    host.querySelector(
      '[data-mining-live-summary] dl dd > span[aria-hidden="true"]',
    )?.textContent;
  const initial = amount();
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(amount()).not.toBe(initial);
  expect(mocks.sceneRenders).toBe(sceneRenders);
  await act(async () => vi.advanceTimersByTimeAsync(6_000));
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(mocks.sceneRenders).toBe(sceneRenders);
});

it("keeps a confirmed active status while reduced motion uses a calm scene and no amount animation frames", async () => {
  mocks.reduced = true;
  await mount();
  expect(caption()?.textContent).toContain("채굴 중");
  expect(
    host
      .querySelector("[data-mining-energy]")
      ?.getAttribute("data-mining-energy"),
  ).toBe("calm");
  expect(
    host.querySelector("[data-mining-live-summary]")?.getAttribute("data-live"),
  ).toBe("false");
  expect(vi.getTimerCount()).toBe(1);
});
