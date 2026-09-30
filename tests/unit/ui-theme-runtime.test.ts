// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  normalizeTheme,
  readThemePreference,
  setThemePreference,
  themeBootstrap,
} from "../../lib/design/theme";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function documentFor(dark: boolean, saved?: string, denied = false) {
  document.head.innerHTML =
    '<meta name="theme-color" media="(prefers-color-scheme: dark)"><meta name="theme-color" media="(prefers-color-scheme: light)">';
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: dark }));
  if (saved !== undefined) window.localStorage.setItem("putduk-theme", saved);
  if (denied)
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
  return {
    window: {
      eval: (source: string) => new Function(source)(),
      close: () => {},
    },
  };
}

describe("shared initial/resolved theme", () => {
  for (const dark of [false, true])
    for (const preference of [
      undefined,
      "invalid",
      "system",
      "light",
      "dark",
    ]) {
      it(`initial paint OS=${dark} saved=${preference}`, () => {
        const dom = documentFor(dark, preference);
        dom.window.eval(themeBootstrap);
        const expected =
          preference === "light" || preference === "dark"
            ? preference
            : dark
              ? "dark"
              : "light";
        expect(document.documentElement.dataset.theme).toBe(expected);
        expect(document.documentElement.dataset.themePreference).toBe(
          normalizeTheme(preference),
        );
        expect(document.documentElement.style.colorScheme).toBe(expected);
        for (const meta of document.querySelectorAll(
          'meta[name="theme-color"]',
        )) {
          expect(meta.hasAttribute("media")).toBe(false);
          expect(meta.getAttribute("content")).toBe(
            expected === "dark" ? "#070706" : "#f8f4ea",
          );
        }
        expect(applyTheme(readThemePreference())).toBe(expected);
        for (const meta of document.querySelectorAll(
          'meta[name="theme-color"]',
        )) {
          expect(meta.hasAttribute("media")).toBe(false);
          expect(meta.getAttribute("content")).toBe(
            expected === "dark" ? "#070706" : "#f8f4ea",
          );
        }
        dom.window.close();
      });
    }
  it("storage denial permits control updates and keeps selected preference", () => {
    const dom = documentFor(false, undefined, true);
    expect(() => dom.window.eval(themeBootstrap)).not.toThrow();
    expect(() => setThemePreference("dark")).not.toThrow();
    expect(readThemePreference()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    setThemePreference("system");
    expect(readThemePreference()).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    dom.window.close();
  });
});
