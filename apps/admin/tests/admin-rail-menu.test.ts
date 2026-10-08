// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminRailMenu } from "@/components/admin-rail-menu";

const route = vi.hoisted(() => ({ pathname: "/members/member-id" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
}));
vi.mock("next/link", () => ({
  default: ({
    onNavigate,
    ...props
  }: ComponentProps<"a"> & { onNavigate?: () => void }) =>
    createElement("a", {
      ...props,
      onClick: (event) => {
        event.preventDefault();
        if (
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        )
          onNavigate?.();
      },
    }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        AdminRailMenu,
        null,
        createElement("button", { type: "button" }, "이 기기 로그아웃"),
      ),
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

function toggle() {
  return host.querySelector<HTMLButtonElement>(".control-menu-toggle")!;
}
async function click(element: HTMLElement, modifiers: MouseEventInit = {}) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...modifiers,
      }),
    );
  });
}

describe("admin labelled navigation disclosure", () => {
  it("starts collapsed and identifies its complete navigation and session region", () => {
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("운영 메뉴");
    const region = document.getElementById(
      toggle().getAttribute("aria-controls")!,
    )!;
    expect(region.querySelectorAll("nav a")).toHaveLength(14);
    expect(region.querySelector('a[href="/ai-conversations"]')).not.toBeNull();
    expect(region.querySelector('a[href="/content"]')).not.toBeNull();
    expect(region.querySelector('a[href="/catalog"]')?.textContent).toContain(
      "상품 검토",
    );
    expect(region.textContent).toContain("이 기기 로그아웃");
    expect(
      region.querySelector('[aria-current="page"]')?.getAttribute("href"),
    ).toBe("/members");
  });

  it("opens and closes from the labelled button", async () => {
    await click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("aside")?.getAttribute("data-menu-open")).toBe(
      "true",
    );
    await click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape from a destination closes the menu and restores toggle focus", async () => {
    await click(toggle());
    const destination =
      host.querySelector<HTMLAnchorElement>('nav a[href="/"]')!;
    destination.focus();
    await act(async () => {
      destination.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle());
  });

  it("closes on same-tab navigation but preserves the menu when opening a new tab", async () => {
    await click(toggle());
    const destination = host.querySelector<HTMLAnchorElement>(
      'nav a[href="/assistant"]',
    )!;
    await click(destination, { ctrlKey: true });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await click(destination);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle());
  });
});
