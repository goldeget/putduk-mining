// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WalletOverviewView } from "@/components/product/wallet-overview-view";
import type { WalletReadViewProps } from "@/components/product/wallet-read-view";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/product/wallet-scene", () => ({
  WalletScene: () =>
    createElement("div", { "data-wallet-scene": "approved-art" }),
}));

const props: WalletReadViewProps = {
  balanceState: "zero",
  krw: {
    availableAtomic: "0",
    balanceAtomic: "0",
    heldAtomic: "0",
    walletAccountId: "owned",
  },
  funding: { state: "empty" },
  ledgerEntries: Array.from({ length: 12 }, (_, index) => ({
    id: `owned-${index}`,
    amountAtomic: "1",
    direction: "CREDIT" as const,
    entryType: "DEPOSIT",
    createdAt: "2026-10-09T00:00:00Z",
  })),
  ledgerState: "ready",
  receipts: [
    {
      id: "owned-receipt",
      amountAtomic: "1",
      currency: "KRW",
      status: "PENDING",
      transactionType: "DEPOSIT",
      receiptNumber: "PD-OWN",
      requestedAt: "2026-10-09T00:00:00Z",
      completedAt: null,
    },
  ],
  receiptState: "ready",
  trialRewardAtomic: null,
  trialState: "empty",
};
let container: HTMLDivElement;
let root: Root;
const stopDocumentNavigation = (event: Event) => event.preventDefault();
async function mount(
  initialView: WalletReadViewProps["initialView"] = "principal",
) {
  await act(async () =>
    root.render(createElement(WalletOverviewView, { ...props, initialView })),
  );
}
function anchor(view: string) {
  return container.querySelector<HTMLAnchorElement>(
    `nav a[href="/wallet?view=${view}"]`,
  )!;
}
async function click(view: string, options: MouseEventInit = {}) {
  await act(async () =>
    anchor(view).dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...options,
      }),
    ),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/wallet");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  // Prevent jsdom's unsupported document navigation after React's link handler.
  document.addEventListener("click", stopDocumentNavigation);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.removeEventListener("click", stopDocumentNavigation);
  vi.restoreAllMocks();
});

describe("wallet presentation native-history selection", () => {
  it("selects profit with native history while retaining the current financial snapshot", async () => {
    await mount();
    const push = vi.spyOn(window.history, "pushState");
    const balance = container.querySelector(
      '[data-wallet-balance-state="zero"]',
    );
    await click("profit");
    expect(push).toHaveBeenCalledWith(null, "", "/wallet?view=profit");
    expect(
      container.querySelector('[data-wallet-active-view="profit"]'),
    ).not.toBeNull();
    expect(anchor("profit").getAttribute("aria-current")).toBe("page");
    expect(container.querySelector('[data-wallet-balance-state="zero"]')).toBe(
      balance,
    );
    expect(container.textContent).toContain("체험 값은 원화가 아니에요");
  });
  it("changes the same owner ledger from four to twelve rows and exposes receipts only in history", async () => {
    await mount();
    expect(
      container.querySelectorAll("[data-wallet-entry-direction]"),
    ).toHaveLength(4);
    expect(container.querySelector("#wallet-receipts-title")).toBeNull();
    await click("history");
    expect(
      container.querySelectorAll("[data-wallet-entry-direction]"),
    ).toHaveLength(12);
    expect(container.querySelectorAll("#wallet-ledger-title")).toHaveLength(1);
    expect(container.querySelectorAll("#wallet-receipts-title")).toHaveLength(
      1,
    );
    await click("principal");
    expect(
      container.querySelectorAll("[data-wallet-entry-direction]"),
    ).toHaveLength(4);
    expect(container.querySelector("#wallet-receipts-title")).toBeNull();
  });
  it("handles back/forward popstate to a missing query as principal instead of stale SSR profit", async () => {
    window.history.replaceState(null, "", "/wallet?view=profit");
    await mount("profit");
    await act(async () => {
      window.history.replaceState(null, "", "/wallet");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      container.querySelector('[data-wallet-active-view="principal"]'),
    ).not.toBeNull();
    await act(async () => {
      window.history.replaceState(null, "", "/wallet?view=history");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(
      container.querySelector('[data-wallet-active-view="history"]'),
    ).not.toBeNull();
  });
  it("follows actual native Back and Forward entries without reloading the financial snapshot", async () => {
    await mount();
    const balance = container.querySelector(
      '[data-wallet-balance-state="zero"]',
    );
    await click("profit");
    await click("history");
    async function traverse(direction: "back" | "forward") {
      await act(async () => {
        const moved = new Promise<void>((resolve) =>
          window.addEventListener("popstate", () => resolve(), { once: true }),
        );
        window.history[direction]();
        await moved;
      });
    }
    await traverse("back");
    expect(anchor("profit").getAttribute("aria-current")).toBe("page");
    await traverse("back");
    expect(window.location.search).toBe("");
    expect(anchor("principal").getAttribute("aria-current")).toBe("page");
    await traverse("forward");
    expect(anchor("profit").getAttribute("aria-current")).toBe("page");
    expect(container.querySelector('[data-wallet-balance-state="zero"]')).toBe(
      balance,
    );
  });
  it("does not override an activation already prevented by another handler", async () => {
    await mount();
    anchor("profit").addEventListener("click", (event) =>
      event.preventDefault(),
    );
    const push = vi.spyOn(window.history, "pushState");
    await click("profit");
    expect(push).not.toHaveBeenCalled();
    expect(anchor("principal").getAttribute("aria-current")).toBe("page");
  });
  it.each(["?view=unknown", "?view=profit&view=history"])(
    "defaults invalid URL %s to principal",
    async (query) => {
      await mount();
      await act(async () => {
        window.history.replaceState(null, "", `/wallet${query}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      expect(
        container.querySelector('[data-wallet-active-view="principal"]'),
      ).not.toBeNull();
    },
  );
  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])(
    "retains browser navigation for modified or middle activation %j",
    async (options) => {
      await mount();
      const push = vi.spyOn(window.history, "pushState");
      await click("profit", options);
      expect(push).not.toHaveBeenCalled();
    },
  );
  it.each(["target", "download"])(
    "retains %s link semantics",
    async (attribute) => {
      await mount();
      anchor("profit").setAttribute(
        attribute,
        attribute === "target" ? "_blank" : "receipt",
      );
      const push = vi.spyOn(window.history, "pushState");
      await click("profit");
      expect(push).not.toHaveBeenCalled();
    },
  );
  it("retains real hrefs and initial server-rendered history with JavaScript disabled", () => {
    const markup = renderToStaticMarkup(
      createElement(WalletOverviewView, { ...props, initialView: "history" }),
    );
    const dom = document.createElement("div");
    dom.innerHTML = markup;
    expect(
      dom.querySelector('nav a[aria-current="page"]')?.getAttribute("href"),
    ).toBe("/wallet?view=history");
    expect(dom.querySelectorAll("[data-wallet-entry-direction]")).toHaveLength(
      12,
    );
    expect(dom.querySelector('a[href="/wallet/withdraw"]')).not.toBeNull();
  });
});
