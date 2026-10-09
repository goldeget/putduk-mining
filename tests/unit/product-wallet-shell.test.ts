/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductShell } from "@/components/layout/product-shell";
import { ProductNavigation } from "@/components/navigation/product-navigation";

const navigation = vi.hoisted(() => ({ pathname: "/wallet" }));
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
  navigation.pathname = "/wallet";
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

async function render(pathname = "/wallet", displayName = "퍼뜩 회원") {
  navigation.pathname = pathname;
  await act(async () =>
    root.render(
      createElement(
        ProductShell,
        { displayName },
        createElement(
          "section",
          { "data-wallet-presentation": "reference-reconstruction" },
          createElement("h1", null, "지갑"),
          "실제 지갑 내용",
        ),
      ),
    ),
  );
}

function hrefs(element: Element) {
  return Array.from(element.querySelectorAll("a"), (link) =>
    link.getAttribute("href"),
  );
}

describe("root Wallet chrome preserves real destinations and native controls", () => {
  it("places the desktop bar above both columns, keeps mobile tools in the actual main and preserves the page heading", async () => {
    await render();
    const shell = host.querySelector(".product-shell")!;
    const workspace = shell.querySelector(".product-workspace")!;
    const desktop = shell.querySelector('[data-wallet-header="desktop"]')!;
    const main = workspace.querySelector("main")!;
    expect(desktop.parentElement).toBe(shell);
    expect(main.querySelectorAll('[data-wallet-header="mobile"]')).toHaveLength(
      1,
    );
    expect(main.querySelector("[data-wallet-presentation]")).not.toBeNull();
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(main.id).toBe("main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
    expect(workspace.querySelector(".product-header")).toBeNull();
    expect(shell.getAttribute("data-wallet-page-active")).toBe("true");
    expect(host.querySelector("[data-connectivity]")).not.toBeNull();
    expect(host.querySelectorAll("[data-ai-dock]")).toHaveLength(1);
  });

  it("uses the genuine five top routes and the reference sidebar with real Wallet subroutes", async () => {
    await render();
    const top = host.querySelector('nav[aria-label="지갑 주요 메뉴"]')!;
    expect(hrefs(top)).toEqual([
      "/home",
      "/mining",
      "/products",
      "/wallet",
      "/menu",
    ]);
    const sidebar = host.querySelector('nav[aria-label="지갑 전체 메뉴"]')!;
    expect(hrefs(sidebar)).toEqual([
      "/home",
      "/mining",
      "/products",
      "/wallet",
      "/wallet",
      "/wallet/deposit",
      "/wallet?view=history",
      "/menu/account",
    ]);
    expect(sidebar.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(
      sidebar.querySelector('[aria-current="page"]')?.getAttribute("href"),
    ).toBe("/wallet");
    expect(host.querySelector('.product-sidebar a[href="/ai"]')).not.toBeNull();
    for (const unsupported of [
      "L5",
      "PRO",
      "+12.8%",
      "54,281",
      "PUTDUK 잔액",
      "투자 추천",
    ]) {
      expect(host.textContent).not.toContain(unsupported);
    }
  });

  it("escapes the supplied identity and keeps real notification and account links in each responsive toolbar", async () => {
    await render("/wallet", "회원 <다온>");
    for (const toolbar of host.querySelectorAll("[data-wallet-header]")) {
      const account = toolbar.querySelector('a[aria-label="내 계정 보기"]')!;
      expect(account.getAttribute("href")).toBe("/menu/account");
      expect(account.textContent).toContain("회원 <다온>님");
      expect(account.querySelector("다온")).toBeNull();
      expect(
        toolbar
          .querySelector('a[aria-label="알림 센터"]')
          ?.getAttribute("href"),
      ).toBe("/notifications");
    }
    expect(
      host
        .querySelector('a[aria-label="내 계정 정보 확인"]')
        ?.getAttribute("href"),
    ).toBe("/menu/account");
  });

  it("shares the actual native System/Light/Dark preference across responsive toolbars", async () => {
    await render();
    const controls = host.querySelectorAll<HTMLSelectElement>(
      'select[aria-label="화면 테마"]',
    );
    expect(controls).toHaveLength(2);
    for (const control of controls) {
      expect(Array.from(control.options, (option) => option.value)).toEqual([
        "system",
        "light",
        "dark",
      ]);
    }
    await act(async () => {
      controls[1]!.value = "dark";
      controls[1]!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
    expect(window.localStorage.getItem("putduk-theme")).toBe("dark");
    expect(controls[0]!.value).toBe("dark");
    await act(async () => {
      controls[0]!.value = "system";
      controls[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(controls[1]!.value).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it.each(["/wallet/deposit", "/wallet/withdraw", "/wallet/deposit/receipt"])(
    "keeps the wallet tools, navigation and dock throughout the wallet family for %s",
    async (pathname) => {
      await render(pathname);
      expect(host.querySelectorAll("[data-wallet-header]")).toHaveLength(2);
      expect(
        host.querySelector('nav[aria-label="지갑 전체 메뉴"]'),
      ).not.toBeNull();
      expect(
        host.querySelector(".product-workspace > .product-header"),
      ).toBeNull();
      expect(host.querySelector(".product-sidebar > .brand-lockup")).toBeNull();
      expect(host.querySelector("[data-ai-dock]")).not.toBeNull();
      expect(
        host
          .querySelector(".product-shell")
          ?.getAttribute("data-wallet-page-active"),
      ).toBe("true");
    },
  );

  it("does not apply financial chrome to a similarly prefixed non-wallet route", async () => {
    await render("/wallet-preview");
    expect(host.querySelector("[data-wallet-header]")).toBeNull();
    expect(
      host.querySelector(".product-workspace > .product-header"),
    ).not.toBeNull();
  });

  it("marks only Wallet active among the five native bottom destinations", async () => {
    await act(async () => root.render(createElement(ProductNavigation)));
    const nav = host.querySelector('nav[aria-label="주요 메뉴"]')!;
    expect(hrefs(nav)).toEqual([
      "/home",
      "/mining",
      "/products",
      "/wallet",
      "/menu",
    ]);
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const active = nav.querySelector('[aria-current="page"]')!;
    expect(active.getAttribute("href")).toBe("/wallet");
    expect(active.textContent).toBe("지갑");
    expect(active.querySelector("svg")).not.toBeNull();
  });

  it("removes all Wallet chrome on Home and restores the existing Mining chrome through navigation", async () => {
    await render();
    const main = host.querySelector("main")!;
    main.scrollTo = vi.fn();
    await render("/home");
    expect(host.querySelector("main")).toBe(main);
    expect(host.querySelector("[data-wallet-header]")).toBeNull();
    expect(host.querySelector(".product-sidebar")).toBeNull();
    expect(host.querySelector("[data-ai-dock]")).toBeNull();
    await render("/mining");
    expect(host.querySelector("main")).toBe(main);
    expect(main.querySelector("[data-mining-header]")).not.toBeNull();
    expect(
      host.querySelector('nav[aria-label="채굴 전체 메뉴"]'),
    ).not.toBeNull();
    expect(host.querySelector("[data-wallet-header]")).toBeNull();
    expect(host.querySelector("[data-ai-dock]")).not.toBeNull();
  });
});
