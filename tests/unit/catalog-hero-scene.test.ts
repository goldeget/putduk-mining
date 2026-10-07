/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogHeroScene } from "@/components/product/catalog-hero-scene";
const theme = vi.hoisted(() => ({ value: "dark" as "dark" | "light" }));
vi.mock("@/lib/design/use-resolved-theme", () => ({
  useResolvedTheme: () => theme.value,
}));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  theme.value = "dark";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(priority = false) {
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement("input", {
          id: "retained-search",
          defaultValue: "기존 검색어",
        }),
        createElement(CatalogHeroScene, {
          sizes: "(min-width: 980px) 80vw, 100vw",
          priority,
        }),
      ),
    ),
  );
}
async function failed() {
  await act(async () =>
    host.querySelector("img")!.dispatchEvent(new Event("error")),
  );
}
describe("strict native Products scene and independent image recovery", () => {
  it("recovers a server-rendered image that failed before hydration attached its error handler", async () => {
    await act(async () => root.unmount());
    host.innerHTML = renderToString(createElement(CatalogHeroScene));
    const serverImage = host.querySelector("img")!;
    Object.defineProperties(serverImage, {
      complete: { value: true, configurable: true },
      currentSrc: {
        value:
          "http://localhost/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-480-v1.avif",
        configurable: true,
      },
      naturalWidth: { value: 0, configurable: true },
    });
    // No React listener existed when this native error occurred.
    serverImage.dispatchEvent(new Event("error"));
    await act(async () => {
      root = hydrateRoot(host, createElement(CatalogHeroScene));
    });
    expect(
      host.querySelector('[data-catalog-hero-state="webp"]'),
    ).not.toBeNull();
    expect(host.querySelector("img")).not.toBe(serverImage);
    expect(host.querySelector("img")?.getAttribute("src")).toContain(
      "products-semiconductor-hero-640-v1.webp",
    );
    await failed();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => host.querySelector("button")!.click());
    expect(
      host.querySelector('[data-catalog-hero-state="responsive"]'),
    ).not.toBeNull();
  });
  it("uses the dedicated chip for mobile Dark and the approved six-layer tower for desktop", async () => {
    await render();
    const sources = host.querySelectorAll("source");
    expect(sources).toHaveLength(4);
    expect(sources[0]?.getAttribute("media")).toBe("(min-width: 980px)");
    expect(sources[0]?.getAttribute("srcset")).toContain(
      "semiconductor-tower-desktop-1920-v1.avif 1920w",
    );
    expect(sources[2]?.getAttribute("srcset")).toContain(
      "products-semiconductor-hero-480-v1.avif 480w",
    );
    expect(sources[3]?.getAttribute("srcset")).toContain(
      "products-semiconductor-hero-1920-v1.webp 1920w",
    );
    expect(host.querySelector("img")?.getAttribute("width")).toBe("1983");
    expect(host.querySelector("img")?.getAttribute("height")).toBe("793");
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(host.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.textContent).not.toMatch(/수익|L5|가격|선택 완료/);
  });
  it("keeps Light as the explicit existing wafer adaptation rather than relabelling the Dark chip", async () => {
    theme.value = "light";
    await render();
    expect(host.innerHTML).toContain(
      "semiconductor-wafer-light-desktop-1920-v1.avif",
    );
    expect(host.innerHTML).toContain("semiconductor-wafer-light-640-v1.webp");
    expect(host.innerHTML).not.toContain("products-semiconductor-hero-");
    expect(host.querySelector("img")?.getAttribute("width")).toBe("1536");
    expect(host.querySelector("img")?.getAttribute("height")).toBe("1024");
  });
  it("falls back to the correct mobile WebP without remounting public browse input", async () => {
    await render();
    const input = host.querySelector("input")!;
    await failed();
    expect(
      host.querySelector('[data-catalog-hero-state="webp"]'),
    ).not.toBeNull();
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      "/brand/scenes/products-semiconductor-hero/products-semiconductor-hero-640-v1.webp",
    );
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("기존 검색어");
  });
  it("uses the desktop WebP only when the actual failed viewport matched the desktop media query", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    await render();
    await failed();
    expect(host.querySelector("img")?.getAttribute("src")).toContain(
      "semiconductor-tower-desktop-1280-v1.webp",
    );
    expect(host.querySelector("img")?.getAttribute("height")).toBe("793");
  });
  it("offers a genuine image retry after both sources fail while keeping browse input untouched", async () => {
    await render();
    const input = host.querySelector("input")!;
    await failed();
    await failed();
    expect(host.querySelector("picture")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "상품 배경을 불러오지 못했어요",
    );
    const retry = host.querySelector("button")!;
    await act(async () => retry.click());
    expect(
      host.querySelector('[data-catalog-hero-state="responsive"]'),
    ).not.toBeNull();
    expect(host.querySelector("img")?.getAttribute("src")).toContain(
      "?catalog-art-retry=1",
    );
    const firstRetry = host.querySelector("img")!.getAttribute("src")!;
    const firstUrl = new URL(firstRetry, "https://putduk.test");
    const firstSource = host
      .querySelector("source")!
      .getAttribute("srcset")!
      .split(",")[0]!
      .trim()
      .split(" ");
    expect(firstSource[1]).toBe("960w");
    const sourceUrl = new URL(firstSource[0]!, "https://putduk.test");
    expect(sourceUrl.searchParams.get("catalog-art-retry")).toBe("1");
    expect(sourceUrl.searchParams.get("catalog-art-instance")).toBeTruthy();
    expect(sourceUrl.search).toBe(firstUrl.search);
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("기존 검색어");
    // A fresh theme mount must not reuse the previous retry's decoded URL.
    // This is the native lifecycle that stalled the enlarged browser matrix.
    theme.value = "light";
    await render();
    theme.value = "dark";
    await render();
    await failed();
    await failed();
    await act(async () => host.querySelector("button")!.click());
    const laterRetry = host.querySelector("img")!.getAttribute("src")!;
    expect(new URL(laterRetry, "https://putduk.test").pathname).toBe(
      firstUrl.pathname,
    );
    expect(
      new URL(laterRetry, "https://putduk.test").searchParams.get(
        "catalog-art-retry",
      ),
    ).toBe("1");
    expect(laterRetry).not.toBe(firstRetry);
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("기존 검색어");
  });
  it("clears a failed family on an actual resolved-theme change", async () => {
    await render();
    await failed();
    await failed();
    theme.value = "light";
    await render();
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(
      host.querySelector('[data-catalog-hero-state="responsive"]'),
    ).not.toBeNull();
    expect(host.querySelector("img")?.getAttribute("src")).toContain(
      "semiconductor-wafer-light-640-v1.webp",
    );
    expect(host.querySelector("img")?.getAttribute("src")).not.toContain(
      "retry",
    );
  });
  it("passes true eager/priority and source sizes only when requested", async () => {
    await render(true);
    expect(host.querySelector("img")?.getAttribute("loading")).toBe("eager");
    expect(host.querySelector("img")?.getAttribute("fetchpriority")).toBe(
      "high",
    );
    expect(host.querySelector("source")?.getAttribute("sizes")).toBe(
      "(min-width: 980px) 80vw, 100vw",
    );
  });
  it("defaults to lazy decoration without a fabricated financial request", async () => {
    await render();
    expect(host.querySelector("img")?.getAttribute("loading")).toBe("lazy");
    expect(host.querySelector("img")?.hasAttribute("fetchpriority")).toBe(
      false,
    );
    expect(host.querySelector("form, a, canvas")).toBeNull();
  });
});
