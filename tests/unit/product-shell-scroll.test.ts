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
