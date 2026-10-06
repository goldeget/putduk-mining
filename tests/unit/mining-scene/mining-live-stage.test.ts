// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MiningLiveStage } from "@/components/mining-live/mining-live-stage";
import { resolveDefaultStageInput } from "@/lib/mining-scene/default-stage";
import { SAFE_SCENE_COPY } from "@/lib/mining-scene/safe-scene-copy";
import type { StageSceneInput } from "@/lib/mining-scene/stage-input";
import { APPROVED_SCENE_ASSET_PATHS } from "@/lib/mining-scene/types";
import { themeChangeEvent } from "@/lib/design/theme";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) =>
    createElement(
      "img",
      Object.fromEntries(
        Object.entries(props).filter(([name]) => name !== "unoptimized"),
      ),
    ),
}));
vi.mock("@/components/mining-live/scene-decoration", () => ({
  SceneDecoration: (props: {
    enabled: boolean;
    particleCount: number;
    maxFps: number;
    maxDpr: number;
    imageWidth: number;
    imageHeight: number;
  }) =>
    props.enabled
      ? createElement("canvas", {
          "aria-hidden": "true",
          "data-particles": props.particleCount,
          "data-fps": props.maxFps,
          "data-dpr": props.maxDpr,
          "data-image-width": props.imageWidth,
          "data-image-height": props.imageHeight,
        })
      : null,
}));

let host: HTMLDivElement;
let root: Root;
let approved: StageSceneInput;

async function render({
  scene = approved,
  running = true,
  reducedMotion = false,
  children,
}: {
  scene?: StageSceneInput;
  running?: boolean;
  reducedMotion?: boolean;
  children?: ReactNode;
} = {}) {
  await act(async () =>
    root.render(
      createElement(
        MiningLiveStage,
        { scene, running, reducedMotion },
        children,
      ),
    ),
  );
}

async function imageEvent(type: "load" | "error") {
  await act(async () =>
    host.querySelector("img")!.dispatchEvent(new Event(type)),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  approved = resolveDefaultStageInput();
  expect(approved.master).not.toBeNull();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
});

describe("approved shared mining stage", () => {
  it("changes the reviewed artwork on theme events while keeping live HTML controls", async () => {
    const control = createElement(
      "button",
      { type: "button" },
      "채굴 상태 확인",
    );
    await render({ children: control });
    const button = host.querySelector("button")!;
    await act(async () => {
      document.documentElement.dataset.theme = "light";
      window.dispatchEvent(new Event(themeChangeEvent));
    });
    expect(host.querySelector("img")!.getAttribute("src")).toBe(
      approved.master!.lightVariant!.master.assetPath,
    );
    expect(host.querySelector("section")!.dataset.sceneTheme).toBe("light");
    expect(host.querySelector("button")).toBe(button);
    await imageEvent("load");
    expect(host.querySelector("canvas")!.dataset.imageWidth).toBe("1536");
    await act(async () => {
      document.documentElement.dataset.theme = "dark";
      window.dispatchEvent(new Event(themeChangeEvent));
    });
    expect(host.querySelector("img")!.getAttribute("src")).toBe(
      approved.master!.assetPath,
    );
    expect(host.querySelector("button")).toBe(button);
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("never renders a light companion under an unapproved primary master", async () => {
    document.documentElement.dataset.theme = "light";
    await render({
      scene: {
        ...approved,
        master: {
          ...approved.master!,
          sha256: "unapproved" as NonNullable<
            StageSceneInput["master"]
          >["sha256"],
        },
      },
    });
    expect(host.querySelector("img")).toBeNull();
  });
  it("renders an approved neutral scene with responsive sources and decorative alt", async () => {
    await render();
    const section = host.querySelector("section")!;
    const image = host.querySelector("img")!;
    expect(section.dataset.sceneFamily).toBe("");
    expect(section.dataset.sceneArt).toBe("ready");
    expect(section.getAttribute("aria-label")).toBe(approved.a11yLabelKo);
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("src")).toBe(approved.master!.assetPath);
    expect(image.getAttribute("width")).toBe(String(approved.master!.width));
    expect(image.getAttribute("height")).toBe(String(approved.master!.height));
    const sources = [...host.querySelectorAll("source")];
    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.type)).toEqual([
      "image/avif",
      "image/webp",
    ]);
    for (const source of sources) {
      expect(source.sizes).toBe("(max-width: 599px) 52rem, 100vw");
      for (const candidate of source.srcset.split(", ")) {
        const [path, width] = candidate.split(" ");
        expect(APPROVED_SCENE_ASSET_PATHS).toContain(path);
        expect(width).toMatch(/^\d+w$/);
      }
    }
    expect(host.textContent).toContain(approved.userCopyKo);
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("starts decorative motion after image load and stops on server pause", async () => {
    await render();
    await imageEvent("load");
    const image = host.querySelector("img")!;
    const decoration = host.querySelector("canvas")!;
    expect(decoration.dataset.fps).toBe("30");
    expect(decoration.dataset.dpr).toBe("1.5");
    expect(decoration.dataset.particles).toBe("12");
    expect(decoration.dataset.imageWidth).toBe(String(approved.master!.width));
    await render({ running: false });
    expect(host.querySelector("canvas")).toBeNull();
    expect(host.querySelector("img")).toBe(image);
    expect(host.querySelector("section")!.dataset.motion).toBe("static");
    await render({ reducedMotion: true });
    expect(host.querySelector("canvas")).toBeNull();
    expect(host.querySelector("img")).toBe(image);
  });

  it("keeps real HTML controls independent from the decorative image", async () => {
    const action = vi.fn();
    const hud = createElement(
      "div",
      {},
      createElement("h2", {}, "채굴 현황"),
      createElement("p", {}, "확인된 기록"),
      createElement("button", { type: "button", onClick: action }, "중지"),
    );
    await render({ children: hud });
    expect(host.querySelectorAll("p")).toHaveLength(1);
    expect(host.querySelector("p")!.textContent).toBe("확인된 기록");
    const button = host.querySelector("button")!;
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    expect(action).toHaveBeenCalledOnce();
    await imageEvent("load");
    await render({ running: false, children: hud });
    expect(host.querySelector("button")).toBe(button);
    expect(host.textContent).toBe("채굴 현황확인된 기록중지");
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("rejects injected hashes, remote paths and inactive images", async () => {
    await render({
      scene: {
        ...approved,
        master: { ...approved.master!, sha256: "unapproved" } as never,
      },
    });
    expect(host.querySelector("picture")).toBeNull();
    await render({
      scene: {
        ...approved,
        master: {
          ...approved.master!,
          assetPath: "https://example.invalid/image.webp",
        } as never,
      },
    });
    expect(host.querySelector("picture")).toBeNull();
    await render({ scene: { ...approved, productionAssetActive: false } });
    expect(host.querySelector("picture")).toBeNull();
    expect(host.querySelector("canvas")).toBeNull();
  });

  it("keeps pending copy as real text and accepts only allowlisted source paths", async () => {
    await render({
      scene: {
        ...approved,
        master: null,
        productionAssetActive: false,
        visualStatus: "VISUAL_MASTER_REQUIRED",
        userCopyKo: " ",
      },
    });
    expect(host.querySelector("section")!.dataset.sceneArt).toBe("pending");
    expect(host.textContent).toBe(SAFE_SCENE_COPY);
    expect(host.textContent).not.toContain("VISUAL_MASTER_REQUIRED");
    await render({
      scene: {
        ...approved,
        responsiveSources: [
          ...approved.responsiveSources,
          {
            media: "",
            assetPath: "https://example.invalid/image.avif",
            width: 999,
            height: 666,
            mimeType: "image/avif",
          } as never,
        ],
      },
    });
    expect(host.innerHTML).not.toContain("example.invalid");
  });

  it("tries the approved fallback, exposes an accessible recovery, and retries", async () => {
    await render();
    await imageEvent("error");
    expect(host.querySelectorAll("source")).toHaveLength(0);
    expect(host.querySelector("img")!.getAttribute("src")).toBe(
      approved.master!.assetPath,
    );
    expect(host.querySelector("canvas")).toBeNull();
    await imageEvent("error");
    expect(host.querySelector('[role="status"]')!.textContent).toBe(
      "배경을 불러오지 못했어요.",
    );
    const oldImage = host.querySelector("img");
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector("img")).not.toBe(oldImage);
    expect(host.querySelectorAll("source")).toHaveLength(2);
    await imageEvent("load");
    expect(host.querySelector("canvas")).not.toBeNull();
  });
});
