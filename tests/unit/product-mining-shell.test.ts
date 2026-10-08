/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductShell } from "@/components/layout/product-shell";
import { ProductHeader } from "@/components/layout/product-header";
import { ProductNavigation } from "@/components/navigation/product-navigation";

const navigation = vi.hoisted(() => ({ pathname: "/mining" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: ReactNode; href: string }) =>
    createElement("a", props, children),
}));
vi.mock("@/components/system/connectivity-status", () => ({
  ConnectivityStatus: () => createElement("div", { "data-connectivity": "" }),
}));
vi.mock("@/components/product/putduk-ai-dock", () => ({
  PutdukAiDock: () => createElement("footer", { "data-ai-dock": "" }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  navigation.pathname = "/mining";
  window.localStorage.clear();
  document.documentElement.dataset.themePreference = "system";
  document.documentElement.dataset.theme = "light";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.localStorage.clear();
  delete document.documentElement.dataset.themePreference;
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(pathname = "/mining", displayName = "퍼뜩 회원") {
  navigation.pathname = pathname;
  await act(async () =>
    root.render(
      createElement(
        ProductShell,
        { displayName },
        createElement(
          "section",
          { "data-ui-ready": pathname },
          "실제 경로 내용",
        ),
      ),
    ),
  );
}

describe("route-scoped Mining chrome with real navigation", () => {
  it("places exactly one Mining header inside the actual main and preserves AI/connectivity", async () => {
    await render();
    const main = host.querySelector("main");
    expect(main?.id).toBe("main-content");
    expect(main?.getAttribute("tabindex")).toBe("-1");
    expect(main?.querySelectorAll("[data-mining-header]")).toHaveLength(1);
    expect(host.querySelectorAll("header")).toHaveLength(1);
    expect(host.querySelector("h1")).toBeNull();
    expect(host.querySelector("[data-ai-dock]")).not.toBeNull();
    expect(host.querySelector("[data-connectivity]")).not.toBeNull();
  });

  it("uses real five desktop links and six sidebar links without unsupported destinations or benefits", async () => {
    await render();
    const top = host.querySelector('nav[aria-label="채굴 주요 메뉴"]');
    expect(
      Array.from(top!.querySelectorAll("a"), (link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "/mining",
      "/products",
      "/wallet",
      "/wallet?view=history",
      "/support",
    ]);
    const sidebar = host.querySelector('nav[aria-label="채굴 전체 메뉴"]');
    expect(
      Array.from(sidebar!.querySelectorAll("a"), (link) =>
        link.getAttribute("href"),
      ),
    ).toEqual([
      "/mining",
      "/products",
      "/wallet",
      "/wallet?view=history",
      "/menu/account",
      "/support",
    ]);
    expect(
      sidebar?.querySelector('[aria-current="page"]')?.getAttribute("href"),
    ).toBe("/mining");
    expect(host.textContent).not.toContain("L5");
    expect(host.textContent).not.toContain("PRO");
    expect(host.querySelector('a[href="/security"]')).toBeNull();
  });

  it("renders the supplied identity as escaped text on the genuine account link and retains notifications", async () => {
    await render("/mining", "회원 <다온>");
    const account = host.querySelector(
      '[data-mining-header] a[aria-label="내 계정 보기"]',
    );
    expect(account?.getAttribute("href")).toBe("/menu/account");
    expect(account?.textContent).toContain("회원 <다온>님");
    expect(account?.querySelector("다온")).toBeNull();
    expect(
      host
        .querySelector('[data-mining-header] a[aria-label="알림 센터"]')
        ?.getAttribute("href"),
    ).toBe("/notifications");
  });

  it("keeps the actual native System/Light/Dark control functional", async () => {
    await render();
    const select = host.querySelector('select[aria-label="화면 테마"]')!;
    expect(
      Array.from(select.querySelectorAll("option"), (option) => option.value),
    ).toEqual(["system", "light", "dark"]);
    await act(async () => {
      (select as HTMLSelectElement).value = "dark";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
    expect(window.localStorage.getItem("putduk-theme")).toBe("dark");
  });

  it.each(["/wallet/deposit", "/wallet/withdraw"])(
    "retains Wallet chrome at %s and Home structure when navigating out of Mining",
    async (walletPath) => {
      await render();
      host.querySelector("main")!.scrollTo = vi.fn();
      await render(walletPath);
      expect(host.querySelector("[data-mining-header]")).toBeNull();
      expect(host.querySelector('nav[aria-label="채굴 전체 메뉴"]')).toBeNull();
      expect(
        host.querySelector(".product-workspace > .product-header"),
      ).toBeNull();
      expect(
        host.querySelector('main [data-wallet-header="mobile"]'),
      ).not.toBeNull();
      expect(
        host.querySelector('[data-wallet-header="desktop"]'),
      ).not.toBeNull();
      expect(host.querySelector(".product-sidebar")).not.toBeNull();
      expect(host.querySelector("[data-ai-dock]")).not.toBeNull();
      await render("/home");
      expect(host.querySelector("[data-mining-header]")).toBeNull();
      expect(host.querySelector(".product-sidebar")).toBeNull();
      expect(
        host.querySelector(".product-workspace > .product-header"),
      ).toBeNull();
      expect(host.querySelector("[data-ai-dock]")).toBeNull();
      expect(
        host
          .querySelector(".product-shell")
          ?.getAttribute("data-home-page-active"),
      ).toBe("true");
    },
  );

  it("preserves five native bottom destinations and marks only Mining active", async () => {
    await act(async () => root.render(createElement(ProductNavigation)));
    const links = host.querySelectorAll("a");
    expect(Array.from(links, (link) => link.getAttribute("href"))).toEqual([
      "/home",
      "/mining",
      "/products",
      "/wallet",
      "/menu",
    ]);
    expect(host.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe(
      "채굴",
    );
    expect(host.querySelector('[aria-current="page"] svg')).not.toBeNull();
  });

  it("does not replace the Home header or generic default header contracts", async () => {
    await act(async () =>
      root.render(
        createElement(ProductHeader, { home: true, displayName: "하나" }),
      ),
    );
    expect(host.querySelector('nav[aria-label="홈 주요 메뉴"]')).not.toBeNull();
    expect(
      host.querySelector('a[aria-label="내 계정 보기"]')?.textContent,
    ).toContain("하나님");
    expect(host.querySelector("[data-mining-header]")).toBeNull();
    await act(async () =>
      root.render(createElement(ProductHeader, { displayName: "하나" })),
    );
    expect(
      host.querySelector(".product-header__identity")?.textContent,
    ).toContain("회원하나");
    expect(host.querySelector('nav[aria-label="홈 주요 메뉴"]')).toBeNull();
    expect(host.querySelector("[data-mining-header]")).toBeNull();
  });
});
