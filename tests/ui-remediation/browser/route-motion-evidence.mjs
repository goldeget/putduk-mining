import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { readMotionEvidenceSnapshot } from "./motion-evidence-provenance.mjs";
import { readMotionControlStates } from "./motion-control-contrast.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const base = new URL(
  process.env.PUTDUK_UI_FIXTURE_URL ?? "http://127.0.0.1:4175/",
);
assert(
  ["localhost", "127.0.0.1"].includes(base.hostname),
  "Local-only fixture required",
);
const output = path.join(
  projectRoot,
  "test-results/ui-motion-remediation/route-motion-browser",
);
await fs.mkdir(output, { recursive: true });
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const executablePath =
  process.env.PUTDUK_MOTION_BROWSER_PATH ??
  (existsSync(chrome) ? chrome : undefined);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const results = [];
const sourceBefore = await readMotionEvidenceSnapshot(projectRoot);

async function waitMotion(page, state) {
  await page.waitForFunction(
    (state) =>
      document.querySelector("[data-mining-running]")?.dataset.motion === state,
    state,
  );
}

async function waitNoSceneAnimations(page) {
  try {
    // A React data attribute can commit before Chrome has retired a CSS
    // transition task. Require the actual animation list to become empty.
    await page.waitForFunction(
      () =>
        document
          .querySelector("[data-mining-running]")
          .getAnimations({ subtree: true }).length === 0,
      undefined,
      { timeout: 3000 },
    );
  } catch (error) {
    console.error(
      "REDUCED_ANIMATION_DIAGNOSTIC",
      await page.locator("[data-mining-running]").evaluate((node) =>
        node.getAnimations({ subtree: true }).map((animation) => ({
          type: animation.constructor.name,
          name: animation.animationName,
          transition: animation.transitionProperty,
          state: animation.playState,
          pending: animation.pending,
          time: animation.currentTime,
          target: animation.effect?.target?.className,
        })),
      ),
    );
    throw error;
  }
}

async function measure(page) {
  return page.locator("[data-fixture-scene-panel]").evaluate((panel) => {
    const core = panel.querySelector("[data-mining-running]");
    const button = core.querySelector("button");
    const panelRect = panel.getBoundingClientRect();
    const coreRect = core.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(
      buttonRect.left + buttonRect.width / 2,
      buttonRect.top + buttonRect.height / 2,
    );
    const overlap = (rect) =>
      Math.max(
        0,
        Math.min(rect.right, buttonRect.right) -
          Math.max(rect.left, buttonRect.left),
      ) *
      Math.max(
        0,
        Math.min(rect.bottom, buttonRect.bottom) -
          Math.max(rect.top, buttonRect.top),
      );
    const textOverlaps = [];
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (!text.textContent.trim() || core.contains(text)) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      for (const rect of range.getClientRects()) {
        if (overlap(rect) > 1) textOverlaps.push(text.textContent.trim());
      }
    }
    return {
      panel: panelRect.toJSON(),
      core: coreRect.toJSON(),
      button: buttonRect.toJSON(),
      centerHit: hit === button || button.contains(hit),
      textOverlaps,
      focusOutline: {
        width: getComputedStyle(button).outlineWidth,
        style: getComputedStyle(button).outlineStyle,
        offset: getComputedStyle(button).outlineOffset,
      },
      theme: document.documentElement.dataset.theme,
      preference: document.documentElement.dataset.themePreference,
      canvas: getComputedStyle(document.body).backgroundColor,
    };
  });
}

function assertButtonGeometry(geometry) {
  assert(
    geometry.button.width >= 44 && geometry.button.height >= 44,
    "Manual pause touch target must be at least44x44",
  );
  assert(
    geometry.centerHit,
    "Manual pause center must hit the control rather than a visual overlay",
  );
  assert(
    geometry.button.left >= geometry.panel.left &&
      geometry.button.right <= geometry.panel.right &&
      geometry.button.top >= geometry.panel.top &&
      geometry.button.bottom <= geometry.panel.bottom,
    "Control must not be clipped by production wrapper",
  );
  assert.deepEqual(
    geometry.textOverlaps,
    [],
    "Pause control must not cover status/result text",
  );
}

try {
  for (const kind of ["home-motion", "start-motion"]) {
    for (const width of [390, 834, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 834 ? 1112 : 900 },
        colorScheme: "light",
        reducedMotion: "no-preference",
        recordVideo: {
          dir: output,
          size: { width, height: width === 834 ? 1112 : 900 },
        },
      });
      await context.addInitScript(() => {
        localStorage.setItem("putduk-theme", "system");
        // Capability contract fixture only; physical runner CPU is unchanged.
        Object.defineProperty(navigator, "hardwareConcurrency", {
          configurable: true,
          get: () => 8,
        });
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const url = new URL(base);
      url.searchParams.set("fixture", kind);
      await page.goto(url.href, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__PUTDUK_FIXTURE__?.ready);
      const imagesReady = await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((image) =>
            image.decode().catch(() => undefined),
          ),
        );
        return [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        );
      });
      assert(
        imagesReady,
        "Production wrapper imagery must actually decode before visual evidence",
      );
      const coach = page.locator("[data-guided-quest-coach]");
      let initialAutomaticCoach = null;
      if (kind === "start-motion") {
        await coach.waitFor({ state: "visible" });
        await page.waitForFunction(() => {
          const coach = document.querySelector("[data-guided-quest-coach]");
          if (!coach?.style.top || !coach.style.left) return false;
          const rect = coach.getBoundingClientRect();
          return (
            rect.left >= 11 &&
            rect.top >= 11 &&
            rect.right <= window.innerWidth - 11 &&
            rect.bottom <= window.innerHeight - 11
          );
        });
        initialAutomaticCoach = await coach.evaluate((node) => ({
          coach: node.getBoundingClientRect().toJSON(),
          target: document
            .querySelector("[data-quest-target='world']")
            .getBoundingClientRect()
            .toJSON(),
          scrollY: window.scrollY,
          spotlightPresent: Boolean(
            document.querySelector(
              "[data-guided-quest] > [aria-hidden='true']",
            ),
          ),
          focusTag: document.activeElement.tagName,
        }));
        assert.equal(initialAutomaticCoach.scrollY, 0);
        await page.screenshot({
          path: path.join(output, `${kind}-${width}-initial-coach.png`),
          animations: "allow",
        });
        await coach.getByRole("button", { name: "나중에 보기" }).click();
      }
      const core = page.locator("[data-mining-running]");
      await core.scrollIntoViewIfNeeded();
      await waitMotion(page, "playing");
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "light",
      );
      const result = {
        kind,
        width,
        evidenceLevel:
          "PRODUCTION_SCENE_WRAPPER_REPLICA_REAL_CSS_CLIENT_MOUNTED_COMPONENT_NOT_AUTHENTICATED_FULL_ROUTE",
        syntheticProps: {
          running: true,
          hardwareConcurrencyHint: 8,
          physicalCpuUnchanged: true,
        },
        initialAutomaticCoach,
        states: [],
      };
      let geometry = await measure(page);
      assert.equal(geometry.preference, "system");
      assertButtonGeometry(geometry);
      result.states.push({ state: "system-os-light-normal", geometry });
      await page.locator("[data-fixture-scene-panel]").screenshot({
        path: path.join(output, `${kind}-${width}-system-light-normal.png`),
        animations: "allow",
      });

      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      geometry = await measure(page);
      assert.equal(geometry.preference, "system");
      assertButtonGeometry(geometry);
      result.states.push({ state: "system-os-dark-normal", geometry });
      await page.locator("[data-fixture-scene-panel]").screenshot({
        path: path.join(output, `${kind}-${width}-system-dark-normal.png`),
        animations: "allow",
      });

      const pause = core.getByRole("button", {
        name: "채굴 공간 연출 일시정지",
        exact: true,
      });
      result.pauseControlContrast = await readMotionControlStates(page, pause);
      await page.keyboard.press("Tab");
      await pause.focus();
      const focusGeometry = await measure(page);
      assertButtonGeometry(focusGeometry);
      assert(
        Number.parseFloat(focusGeometry.focusOutline.width) >= 2 &&
          focusGeometry.focusOutline.style !== "none",
        "Manual pause must retain a visible keyboard focus outline",
      );
      result.keyboardFocus = focusGeometry.focusOutline;
      await pause.click();
      await waitMotion(page, "paused");
      await page.waitForFunction(() =>
        document
          .querySelector("[data-mining-running]")
          .getAnimations({ subtree: true })
          .every(
            (animation) =>
              animation.playState === "paused" && !animation.pending,
          ),
      );
      const before = await core.evaluate((node) =>
        node
          .getAnimations({ subtree: true })
          .map((animation) => Number(animation.currentTime)),
      );
      await page.waitForTimeout(250);
      const after = await core.evaluate((node) =>
        node
          .getAnimations({ subtree: true })
          .map((animation) => Number(animation.currentTime)),
      );
      assert(after.every((time, index) => Math.abs(time - before[index]) < 25));
      await core
        .getByRole("button", { name: "채굴 공간 연출 재생", exact: true })
        .click();
      await waitMotion(page, "playing");
      result.manualPauseFreezeResume = true;

      await page.emulateMedia({ reducedMotion: "reduce" });
      await waitMotion(page, "paused");
      await waitNoSceneAnimations(page);
      assert.equal(
        await core.evaluate(
          (node) => node.getAnimations({ subtree: true }).length,
        ),
        0,
      );
      geometry = await measure(page);
      assertButtonGeometry(geometry);
      result.states.push({ state: "system-os-dark-reduced", geometry });
      await page.locator("[data-fixture-scene-panel]").screenshot({
        path: path.join(output, `${kind}-${width}-system-dark-reduced.png`),
        animations: "allow",
      });
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "light",
      );
      await waitNoSceneAnimations(page);
      assert.equal(
        await core.evaluate(
          (node) => node.getAnimations({ subtree: true }).length,
        ),
        0,
      );
      result.systemOSLiveTransitionsPreservePreference = true;
      result.reducedRemainsStillAcrossOSTransition = true;
      result.mockCalls = await page.evaluate(
        () => window.__PUTDUK_FIXTURE__.calls,
      );
      assert.deepEqual(result.mockCalls, []);
      result.pageErrors = errors;
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await fs.rename(
        await video.path(),
        path.join(output, `${kind}-${width}.webm`),
      );
      results.push(result);
      console.info(`${kind}-${width}:passed`);
    }
  }
} finally {
  await browser.close();
  const sourceAfter = await readMotionEvidenceSnapshot(projectRoot);
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        sourceBefore,
        sourceAfter,
        acceptance:
          "PROTECTED_SCENE_WRAPPER_ONLY_NOT_FULL_ROUTE_AUTH_ACCEPTANCE",
        results,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(
    sourceAfter,
    sourceBefore,
    "Source/CSS/asset changed during protected wrapper evidence",
  );
}
