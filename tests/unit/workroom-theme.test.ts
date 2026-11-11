// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductShell } from "@/components/layout/product-shell";
import { WorkroomAuth } from "@/components/workroom/identity";
import { ThemeRuntime } from "@/components/system/theme-runtime";

vi.mock("next/navigation", () => ({ usePathname: () => "/workroom/cash" }));
vi.mock("next/link", () => ({
  default: ({
    children,
    prefetch,
    ...props
  }: {
    children: ReactNode;
    prefetch?: boolean;
  }) => {
    void prefetch;
    return createElement("a", props, children);
  },
}));
let root: Root;
let host: HTMLDivElement;
let dark = false;
let systemChange: (() => void) | undefined;
const removeSystemListener = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dark = false;
  systemChange = undefined;
  removeSystemListener.mockClear();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: () => void) => {
      systemChange = listener;
    },
    removeEventListener: removeSystemListener,
  }));
  window.localStorage.clear();
  delete document.documentElement.dataset.themePreference;
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
});
async function renderMember() {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(ThemeRuntime),
        createElement(ProductShell, { displayName: "테스트 회원" }, "내용"),
      ),
    ),
  );
}
describe("WORKROOM member theme", () => {
  it("exposes all three modes in the member header and follows OS only in system mode", async () => {
    await renderMember();
    const select = host.querySelector<HTMLSelectElement>(
      'header select[aria-label="화면 테마"]',
    );
    expect(select).not.toBeNull();
    expect(Array.from(select!.options, (option) => option.value)).toEqual([
      "system",
      "light",
      "dark",
    ]);
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => {
      dark = true;
      systemChange?.();
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await act(async () => {
      select!.value = "light";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(window.localStorage.getItem("putduk-theme")).toBe("light");
    await act(async () => {
      dark = false;
      systemChange?.();
      dark = true;
      systemChange?.();
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    await renderMember();
    expect(host.querySelector<HTMLSelectElement>("header select")!.value).toBe(
      "light",
    );
  });
  it("syncs another tab's preference and storage reset, and removes OS listeners", async () => {
    await renderMember();
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: "putduk-theme", newValue: "dark" }),
      ),
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(host.querySelector<HTMLSelectElement>("header select")!.value).toBe(
      "dark",
    );
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", { key: null, newValue: null }),
      ),
    );
    expect(document.documentElement.dataset.themePreference).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => root.render(null));
    expect(removeSystemListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });
  it("provides the same control on the public authentication frame", async () => {
    await act(async () => root.render(WorkroomAuth({ children: "가입 양식" })));
    expect(host.querySelector('select[aria-label="화면 테마"]')).not.toBeNull();
  });
  it("uses semantic theme colors for all member and cash surfaces", () => {
    for (const name of ["workroom", "cash"]) {
      const css = readFileSync(
        `components/workroom/${name}.module.css`,
        "utf8",
      );
      // Colors belong to the shared palette, not permanent dark declarations.
      expect(css.replace(/--[\w-]+\s*:[^;]+;/g, "")).not.toMatch(
        /#[0-9a-f]{3,8}\b/i,
      );
    }
    const css = readFileSync("components/workroom/workroom.module.css", "utf8");
    expect(css).toContain('html[data-theme="light"]');
    expect(css).not.toMatch(/color-scheme:\s*dark/);
  });
  it("keeps text, feedback, and action colors readable in both palettes", () => {
    const css = readFileSync("components/workroom/workroom.module.css", "utf8");
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((index) => {
        const value = parseInt(hex.slice(index, index + 2), 16) / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return (
        channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      );
    };
    for (const block of [
      css.split(":global(html")[0]!,
      css
        .split(':global(html[data-theme="light"]) .theme {')[1]!
        .split("}")[0]!,
    ]) {
      const colors = Object.fromEntries(
        Array.from(
          block.matchAll(/--wr-([\w-]+):\s*(#[a-f0-9]{6});/g),
          (match) => [match[1], match[2]],
        ),
      );
      for (const [foreground, background] of [
        ["text", "panel"],
        ["secondary", "raised"],
        ["muted", "raised"],
        ["accent", "success-bg"],
        ["negative", "panel"],
        ["warning", "warning-bg"],
        ["danger", "danger-bg"],
        ["action-text", "action"],
      ]) {
        const a = luminance(colors[foreground!]!);
        const b = luminance(colors[background!]!);
        expect(
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          `${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
