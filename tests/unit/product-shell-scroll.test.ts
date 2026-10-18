// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductShell } from "@/components/layout/product-shell";

const navigation = vi.hoisted(() => ({ pathname: "/home" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));
vi.mock("@/components/brand/brand-mark", () => ({ BrandMark: () => null }));
vi.mock("@/components/icons/putduk-icon", () => ({ PutdukIcon: () => null }));
vi.mock("@/components/navigation/product-navigation", () => ({
  ProductNavigation: () => null,
}));
vi.mock("@/components/system/theme-control", () => ({
  ThemeControl: () => null,
}));
vi.mock("@/components/system/connectivity-status", () => ({
  ConnectivityStatus: () => null,
}));
vi.mock("@/components/product/putduk-ai-dock", () => ({
  PutdukAiDock: () => null,
}));

let host: HTMLDivElement;
let root: Root;
let scrollTo: ReturnType<typeof vi.fn>;

async function render(pathname = navigation.pathname) {
  navigation.pathname = pathname;
  await act(async () =>
    root.render(createElement(ProductShell, { displayName: "회원" }, pathname)),
  );
}

async function scrollMain(top: number) {
  const main = host.querySelector("main")!;
  await act(async () => {
    main.scrollTop = top;
    main.dispatchEvent(new Event("scroll"));
  });
}

async function backTo(path: string, pathname = path) {
  window.history.replaceState(null, "", path);
  await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
  await render(pathname);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.pathname = "/home";
  window.history.replaceState(null, "", "/home");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("product main scroll history", () => {
  it("preserves the same actual main and Mining position across other-route history", async () => {
    await render("/mining");
    const main = host.querySelector("main")!;
    const mainScrollTo = vi.fn();
    main.scrollTo = mainScrollTo;
    await scrollMain(640);
    await render("/wallet");
    expect(host.querySelector("main")).toBe(main);
    await scrollMain(125);
    await backTo("/mining");
    expect(host.querySelector("main")).toBe(main);
    expect(mainScrollTo).toHaveBeenLastCalledWith({
      top: 640,
      left: 0,
      behavior: "instant",
    });
    expect(main.querySelector("[data-mining-header]")).not.toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it("keeps Wallet's actual main and restores its position through Mining and Wallet subroutes", async () => {
    await render("/wallet");
    const main = host.querySelector("main")!;
    const mainScrollTo = vi.fn();
    main.scrollTo = mainScrollTo;
    await scrollMain(735);
    await render("/mining");
    expect(host.querySelector("main")).toBe(main);
    expect(main.querySelector("[data-wallet-header]")).toBeNull();
    await scrollMain(245);
    await backTo("/wallet");
    expect(host.querySelector("main")).toBe(main);
    expect(mainScrollTo).toHaveBeenLastCalledWith({
      top: 735,
      left: 0,
      behavior: "instant",
    });
    expect(main.querySelector('[data-wallet-header="mobile"]')).not.toBeNull();
    await render("/wallet/deposit");
    expect(host.querySelector("main")).toBe(main);
    expect(main.querySelector('[data-wallet-header="mobile"]')).not.toBeNull();
    expect(mainScrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: "instant",
    });
    expect(scrollTo).not.toHaveBeenCalled();
    await scrollMain(310);
    await render("/mining");
    await backTo("/wallet/deposit");
    expect(host.querySelector("main")).toBe(main);
    expect(mainScrollTo).toHaveBeenLastCalledWith({
      top: 310,
      left: 0,
      behavior: "instant",
    });
  });

  it("does not turn a Wallet history-view query into restoration for the next normal route", async () => {
    await render("/wallet");
    const main = host.querySelector("main")!;
    const mainScrollTo = vi.fn();
    main.scrollTo = mainScrollTo;
    await scrollMain(270);
    await backTo("/wallet?view=history", "/wallet");
    expect(host.querySelector("main")).toBe(main);
    expect(mainScrollTo).not.toHaveBeenCalled();
    await render("/mining");
    expect(mainScrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: "instant",
    });
  });

  it("uses the current route when a hidden previous AI page remains in the DOM", async () => {
    const previousAi = document.createElement("div");
    previousAi.hidden = true;
    previousAi.setAttribute("data-ai-page", "");
    host.append(previousAi);
    await render("/wallet");
    const workspace = host.querySelector(".product-workspace")!;
    expect(workspace.getAttribute("data-ai-page-active")).toBe("false");
    host.querySelector("main")!.scrollTo = vi.fn();
    await render("/ai");
    expect(workspace.getAttribute("data-ai-page-active")).toBe("true");
    await render("/wallet");
    expect(workspace.getAttribute("data-ai-page-active")).toBe("false");
  });
  it("scrolls the actual main rather than the window on a normal route change", async () => {
    await render();
    const main = host.querySelector("main")!;
    const mainScrollTo = vi.fn();
    main.scrollTo = mainScrollTo;
    await scrollMain(420);
    await render("/wallet");
    expect(mainScrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: "instant",
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("restores the previous route's own main position on back navigation", async () => {
    await render();
    const mainScrollTo = vi.fn();
    host.querySelector("main")!.scrollTo = mainScrollTo;
    await scrollMain(420);
    await render("/wallet");
    await scrollMain(180);
    await backTo("/home");
    expect(mainScrollTo).toHaveBeenLastCalledWith({
      top: 420,
      left: 0,
      behavior: "instant",
    });
  });

  it("keeps the visible catalog hero when a hidden stream still has the server scene", async () => {
    const streamed = document.createElement("div");
    streamed.hidden = true;
    streamed.id = "S:1";
    streamed.innerHTML =
      '<div class="page"><section aria-labelledby="catalog-hero-title"><div data-catalog-hero-theme="dark" data-catalog-hero-state="responsive"></div></section></div>';
    document.body.append(streamed);
    try {
      navigation.pathname = "/products";
      window.history.replaceState(null, "", "/products");
      await act(async () =>
        root.render(
          createElement(
            ProductShell,
            { displayName: "회원" },
            createElement(
              "section",
              { "aria-labelledby": "catalog-hero-title" },
              createElement("div", {
                "data-catalog-hero-theme": "light",
                "data-catalog-hero-state": "unavailable",
              }),
            ),
          ),
        ),
      );
      const scenes = document.querySelectorAll("[data-catalog-hero-state]");
      expect(scenes).toHaveLength(1);
      expect(scenes[0]?.getAttribute("data-catalog-hero-state")).toBe(
        "unavailable",
      );
      expect(scenes[0]?.getAttribute("data-catalog-hero-theme")).toBe("light");
      expect(host.querySelector("main")?.contains(scenes[0] ?? null)).toBe(
        true,
      );
      expect(
        document.querySelectorAll(
          "section[aria-labelledby='catalog-hero-title']",
        ),
      ).toHaveLength(1);
      expect(streamed.querySelector("[data-catalog-hero-state]")).toBeNull();
    } finally {
      streamed.remove();
    }
  });

  it("leaves a hidden stream hero untouched until the visible hero exists", async () => {
    const streamed = document.createElement("div");
    streamed.hidden = true;
    streamed.id = "S:1";
    streamed.innerHTML =
      '<section aria-labelledby="catalog-hero-title"><div data-catalog-hero-theme="dark" data-catalog-hero-state="responsive"></div></section>';
    document.body.append(streamed);
    try {
      await render("/products");
      expect(
        streamed.querySelector("section")?.getAttribute("aria-labelledby"),
      ).toBe("catalog-hero-title");
      expect(
        streamed
          .querySelector("[data-catalog-hero-state]")
          ?.getAttribute("data-catalog-hero-state"),
      ).toBe("responsive");
    } finally {
      streamed.remove();
    }
  });

  it("keeps the products ready marker that is inside main", async () => {
    const streamedCopy = document.createElement("div");
    streamedCopy.setAttribute("data-ui-ready", "/products");
    streamedCopy.setAttribute("data-ui-state", "empty");
    document.body.append(streamedCopy);
    try {
      navigation.pathname = "/products";
      window.history.replaceState(null, "", "/products");
      await act(async () =>
        root.render(
          createElement(
            ProductShell,
            { displayName: "회원" },
            createElement("section", {
              "data-ui-ready": "/products",
              "data-ui-state": "empty",
            }),
          ),
        ),
      );
      const markers = document.querySelectorAll('[data-ui-ready="/products"]');
      expect(markers).toHaveLength(1);
      expect(host.querySelector("main")?.contains(markers[0] ?? null)).toBe(
        true,
      );
    } finally {
      streamedCopy.remove();
    }
  });

  it.each(["/home#details", "/home?selected=1"])(
    "does not treat the next normal route as back after same-path history %s",
    async (samePathHistory) => {
      await render();
      const mainScrollTo = vi.fn();
      host.querySelector("main")!.scrollTo = mainScrollTo;
      await render("/wallet");
      await scrollMain(180);
      await backTo("/home");
      mainScrollTo.mockClear();
      await backTo(samePathHistory, "/home");
      expect(mainScrollTo).not.toHaveBeenCalled();
      await render("/wallet");
      expect(mainScrollTo).toHaveBeenLastCalledWith({
        top: 0,
        left: 0,
        behavior: "instant",
      });
    },
  );
});
