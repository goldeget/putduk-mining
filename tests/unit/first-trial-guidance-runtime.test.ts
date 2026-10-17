// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuidedQuest } from "@/components/product/guided-quest";

vi.mock("@/lib/motion/motion-preference", () => ({
  useMotionPreference: () => true,
  scrollQuestTarget: vi.fn(),
  stopDecorativeScroll: vi.fn(),
}));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  for (const name of ["world", "progress", "action", "boundary"]) {
    const target = document.createElement("div");
    target.dataset.questTarget = name;
    host.append(target);
  }
  const mount = document.createElement("div");
  host.append(mount);
  root = createRoot(mount);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function show(ownerId: string, serverStage: string, eligible: boolean) {
  await act(async () =>
    root.render(createElement(GuidedQuest, { ownerId, serverStage, eligible })),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
const dialog = () => host.querySelector("[data-guided-quest]");
const replay = () =>
  [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("처음 안내 다시 보기"),
  );

describe("first guidance never returns after server completion", () => {
  it.each([
    "COMPLETED",
    "EXPIRED",
    "TRIAL_COMPLETED:ACTIVE:NONE",
    "SIGNED_UP:READY:CONVERTED",
    "UNKNOWN",
  ])("has no server-rendered guide or replay for %s", (serverStage) => {
    expect(
      renderToStaticMarkup(
        createElement(GuidedQuest, {
          ownerId: "owner",
          serverStage,
          eligible: true,
        }),
      ),
    ).toBe("");
  });
  it.each(["completed-owner", "fresh-device", "reinstalled-device"])(
    "ignores empty browser storage for ineligible %s",
    async (ownerId) => {
      await show(ownerId, "SIGNED_UP:READY:NONE", false);
      expect(dialog()).toBeNull();
      expect(replay()).toBeUndefined();
    },
  );
  it("shows READY and ACTIVE guidance only with server eligibility", async () => {
    await show("first-owner", "SIGNED_UP:READY:NONE", true);
    expect(dialog()).not.toBeNull();
    expect(replay()).toBeDefined();
    await show("first-owner", "TRIAL_STARTED:ACTIVE:NONE", true);
    expect(dialog()).not.toBeNull();
  });
  it("hides the old active overlay and replay immediately on completion or uncertain reads", async () => {
    await show("owner-a", "ACTIVE", true);
    expect(dialog()).not.toBeNull();
    await act(async () =>
      root.render(
        createElement(GuidedQuest, {
          ownerId: "owner-a",
          serverStage: "COMPLETED",
          eligible: false,
        }),
      ),
    );
    expect(dialog()).toBeNull();
    expect(replay()).toBeUndefined();
    window.localStorage.clear();
    await show("owner-a", "READY", false);
    expect(dialog()).toBeNull();
    expect(replay()).toBeUndefined();
  });
  it("does not transfer an active first-account tour to a completed account", async () => {
    await show("owner-a", "READY", true);
    expect(dialog()).not.toBeNull();
    await act(async () =>
      root.render(
        createElement(GuidedQuest, {
          ownerId: "owner-b",
          serverStage: "EXPIRED",
          eligible: false,
        }),
      ),
    );
    expect(dialog()).toBeNull();
    expect(replay()).toBeUndefined();
    await show("owner-c", "READY", true);
    expect(dialog()).not.toBeNull();
  });
  it("keeps dismissal account-scoped without replaying the whole tour on READY -> ACTIVE", async () => {
    await show("owner-a", "READY", true);
    const dismiss = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "나중에 보기",
    )!;
    await act(async () => dismiss.click());
    await show("owner-a", "ACTIVE", true);
    expect(dialog()).toBeNull();
    expect(replay()).toBeDefined();
    await act(async () => replay()!.click());
    expect(dialog()).not.toBeNull();
    await show("owner-b", "ACTIVE", true);
    expect(dialog()).not.toBeNull();
  });
  it("does not consult browser dismissal when server eligibility is false", async () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    await show("owner-a", "READY", false);
    expect(read).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(replay()).toBeUndefined();
  });
});
