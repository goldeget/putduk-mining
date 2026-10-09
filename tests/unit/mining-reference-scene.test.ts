/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MiningReferenceScene,
  MINING_REFERENCE_ART,
} from "@/components/mining-live/mining-reference-scene";

const state = vi.hoisted(() => ({ theme: "dark" as "dark" | "light" }));
vi.mock("@/lib/design/use-resolved-theme", () => ({
  useResolvedTheme: () => state.theme,
}));

describe("decorative mining art, theme and image recovery", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.theme = "dark";
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });
  async function render(running = false) {
    await act(async () =>
      root.render(createElement(MiningReferenceScene, { running })),
    );
  }
  async function failImage() {
    const image = host.querySelector("img");
    if (!image) throw new Error("missing actual image node");
    await act(async () => image.dispatchEvent(new Event("error")));
  }

  it("uses a native-width mobile family and contains no raster labels or formula renderer", async () => {
    await render();
    const mobile = host.querySelector('source[media="(max-width: 699px)"]');
    expect(mobile?.getAttribute("srcset")).toContain(
      "mobile-dark-941-v1.avif 941w",
    );
    expect(mobile?.getAttribute("srcset")).not.toContain("960w");
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(host.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("canvas")).toBeNull();
    expect(host.textContent).toBe("");
    expect(
      host
        .querySelector("[data-mining-running]")
        ?.getAttribute("data-mining-running"),
    ).toBe("false");
    await render(true);
    expect(
      host
        .querySelector("[data-mining-running]")
        ?.getAttribute("data-mining-running"),
    ).toBe("true");
    expect(
      host.querySelector("[data-motion]")?.getAttribute("data-motion"),
    ).toBe("static");
  });
  it("drops failed responsive sources before reporting a failure and supports a real retry", async () => {
    await render();
    expect(host.querySelectorAll("source")).toHaveLength(4);
    await failImage();
    expect(host.querySelectorAll("source")).toHaveLength(0);
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      `${MINING_REFERENCE_ART.desktopDark.prefix}960-v1.webp`,
    );
    expect(host.querySelector("[role=status]")).toBeNull();
    await failImage();
    expect(host.querySelector("[role=status]")?.textContent).toContain(
      "배경을 불러오지 못했어요.",
    );
    const retry = host.querySelector("button");
    expect(retry?.textContent).toBe("배경 다시 보기");
    await act(async () => retry?.click());
    expect(host.querySelectorAll("source")).toHaveLength(4);
    expect(host.querySelector("[role=status]")).toBeNull();
  });
  it("selects the bright tower Light family and clears a Dark image failure on theme change", async () => {
    await render();
    await failImage();
    await failImage();
    state.theme = "light";
    await render();
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(
      host
        .querySelector("[data-scene-theme]")
        ?.getAttribute("data-scene-theme"),
    ).toBe("light");
    expect(host.querySelector("img")?.getAttribute("src")).toBe(
      `${MINING_REFERENCE_ART.desktopLight.prefix}960-v1.webp`,
    );
    expect(host.querySelectorAll("source")).toHaveLength(4);
    for (const source of host.querySelectorAll("source"))
      expect(source.getAttribute("srcset")).toContain(
        source.hasAttribute("media")
          ? MINING_REFERENCE_ART.mobileLight.prefix
          : MINING_REFERENCE_ART.desktopLight.prefix,
      );
  });
});
