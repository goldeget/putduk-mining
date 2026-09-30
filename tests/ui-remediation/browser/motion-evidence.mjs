import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { readMotionEvidenceSnapshot } from "./motion-evidence-provenance.mjs";
import {
  assertMotionControlContrast,
  readMotionControlContrast,
  readMotionControlStates,
} from "./motion-control-contrast.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const url = new URL(
  process.env.PUTDUK_UI_FIXTURE_URL ?? "http://127.0.0.1:4175/?fixture=motion",
);
assert(
  ["127.0.0.1", "localhost"].includes(url.hostname),
  "Only a local, client-only fixture is allowed",
);
assert.equal(url.searchParams.get("fixture"), "motion");
const output = path.join(
  projectRoot,
  "test-results/ui-motion-remediation/motion-browser",
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
const caseFilter = process.env.PUTDUK_MOTION_CASE_FILTER;
const results =
  caseFilter && existsSync(path.join(output, "results.json"))
    ? JSON.parse(
        await fs.readFile(path.join(output, "results.json"), "utf8"),
      ).results.filter((result) => !result.name.includes(caseFilter))
    : [];
const sourceBefore = await readMotionEvidenceSnapshot(projectRoot);
let actualDevice;

async function expectMotion(page, motion, quality) {
  try {
    await page.waitForFunction(
      ({ motion, quality }) => {
        const scene = document.querySelector("[data-mining-running]");
        return (
          scene?.getAttribute("data-motion") === motion &&
          (!quality || scene?.getAttribute("data-motion-quality") === quality)
        );
      },
      { motion, quality },
      { timeout: 8000 },
    );
  } catch (error) {
    console.error(
      "MOTION_DIAGNOSTIC",
      await page.evaluate(() => ({
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        saveData: navigator.connection?.saveData,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        reducedData: matchMedia("(prefers-reduced-data: reduce)").matches,
        visibility: document.visibilityState,
        rect: document
          .querySelector("[data-mining-running]")
          ?.getBoundingClientRect()
          .toJSON(),
        attrs: document
          .querySelector("[data-mining-running]")
          ?.outerHTML.slice(0, 350),
        cssSupport: CSS.supports("animation-name", "none"),
        observer: typeof IntersectionObserver,
      })),
    );
    throw error;
  }
}

async function animationSample(page) {
  return page.locator("[data-mining-running]").evaluate((scene) =>
    scene.getAnimations({ subtree: true }).map((animation) => ({
      state: animation.playState,
      time: Number(animation.currentTime),
    })),
  );
}

async function performanceSample(page, duration) {
  return page.evaluate(async (duration) => {
    const longTasks = [];
    let observer;
    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask" });
    }
    const initialHeap = performance.memory?.usedJSHeapSize ?? null;
    const intervals = [];
    let last;
    const start = performance.now();
    await new Promise((resolve) => {
      function frame(time) {
        if (last !== undefined) intervals.push(time - last);
        last = time;
        if (time - start < duration) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
    observer?.disconnect();
    const sorted = [...intervals].sort((a, b) => a - b);
    return {
      sampleMs: performance.now() - start,
      frames: intervals.length,
      averageFrameMs:
        intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? null,
      framesOver50ms: intervals.filter((value) => value > 50).length,
      longTasks,
      heapBeforeBytes: initialHeap,
      heapAfterBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, duration);
}

try {
  const rawContext = await browser.newContext({
    viewport: { width: 390, height: 900 },
    reducedMotion: "no-preference",
  });
  const rawPage = await rawContext.newPage();
  await rawPage.goto(url.href, { waitUntil: "networkidle" });
  await rawPage.waitForFunction(
    () => window.__PUTDUK_FIXTURE__?.ready === true,
  );
  actualDevice = await rawPage.evaluate(() => ({
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    saveData: navigator.connection?.saveData,
    appTheme: document.documentElement.dataset.themePreference,
    resolvedTheme: document.documentElement.dataset.theme,
    osTheme: matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
    viewport: { width: innerWidth, height: innerHeight },
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  if (actualDevice.hardwareConcurrency <= 2) {
    await expectMotion(rawPage, "paused", "static");
    await rawPage.screenshot({
      path: path.join(output, "actual-device-constrained-static.png"),
      animations: "allow",
    });
  }
  await rawContext.close();
  for (const width of [390, 834, 1440]) {
    for (const theme of ["light", "dark"]) {
      for (const motion of ["normal", "reduced"]) {
        const name = `motion-${width}-${theme}-${motion}`;
        if (caseFilter && !name.includes(caseFilter)) continue;
        const context = await browser.newContext({
          viewport: { width, height: width === 834 ? 1112 : 900 },
          colorScheme: theme,
          reducedMotion: motion === "reduced" ? "reduce" : "no-preference",
          recordVideo: {
            dir: output,
            size: { width, height: width === 834 ? 1112 : 900 },
          },
        });
        await context.addInitScript((theme) => {
          localStorage.setItem("putduk-theme", theme);
          // Test the enhanced presentation contract independently of the
          // runner's real 2-core hint. This does not emulate a faster CPU.
          Object.defineProperty(navigator, "hardwareConcurrency", {
            configurable: true,
            get: () => 8,
          });
        }, theme);
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(url.href, { waitUntil: "networkidle" });
        await page.waitForFunction(
          () => window.__PUTDUK_FIXTURE__?.ready === true,
        );
        await page.evaluate(() => document.fonts.ready);
        const coach = page.locator("[data-guided-quest-coach]");
        if (await coach.isVisible())
          await coach.getByRole("button", { name: "나중에 보기" }).click();
        const scene = page.locator("[data-mining-running]");
        await scene.scrollIntoViewIfNeeded();
        await expectMotion(
          page,
          motion === "normal" ? "playing" : "paused",
          motion === "normal" ? "ambient" : "static",
        );
        const before = await animationSample(page);
        const performance = await performanceSample(
          page,
          motion === "normal" ? 2500 : 1000,
        );
        const after = await animationSample(page);
        if (motion === "normal") {
          assert(
            before.length > 0 &&
              after.every((animation) => animation.state === "running"),
          );
          assert(
            after.some(
              (animation, index) => animation.time > before[index].time + 1000,
            ),
          );
        } else
          assert.equal(
            after.length,
            0,
            "Reduced motion must remove all scene animation, including opacity loops",
          );
        await page.locator(".fixture-world").screenshot({
          path: path.join(output, `${name}.png`),
          animations: "allow",
        });
        const sceneGeometry = await scene.evaluate((node) => {
          const core = node.getBoundingClientRect();
          const button = node.querySelector("button");
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return {
            scene: core.toJSON(),
            button: rect.toJSON(),
            buttonAtCenter: hit === button || button.contains(hit),
          };
        });
        assert(
          sceneGeometry.buttonAtCenter,
          "Motion pause control must remain reachable",
        );
        const result = {
          name,
          width,
          theme,
          motion,
          evidenceLevel:
            "REAL_COMPONENT_CLIENT_MOUNTED_LOCAL_FIXTURE_SYNTHETIC_RUNNING_NO_BACKEND",
          capabilityHintOverride: {
            hardwareConcurrency: 8,
            physicalCpuUnchanged: true,
          },
          normalLoopAdvanced: motion === "normal",
          reducedHasNoSceneAnimations: motion === "reduced",
          sceneGeometry,
          performance,
        };
        result.pauseControlContrast = await readMotionControlStates(
          page,
          scene.locator("button"),
        );

        if (width === 1440 && theme === "dark" && motion === "normal") {
          const pause = scene.getByRole("button", {
            name: "채굴 공간 연출 일시정지",
            exact: true,
          });
          await pause.click();
          await expectMotion(page, "paused");
          await page.waitForFunction(() =>
            document
              .querySelector("[data-mining-running]")
              .getAnimations({ subtree: true })
              .every(
                (animation) =>
                  animation.playState === "paused" && !animation.pending,
              ),
          );
          const pausedBefore = await animationSample(page);
          await page.waitForTimeout(250);
          const pausedAfter = await animationSample(page);
          assert(
            pausedAfter.every(
              (animation, index) =>
                animation.state === "paused" &&
                Math.abs(animation.time - pausedBefore[index].time) < 25,
            ),
            `Paused animation times changed: ${JSON.stringify({ pausedBefore, pausedAfter })}`,
          );
          await scene
            .getByRole("button", { name: "채굴 공간 연출 재생", exact: true })
            .click();
          await expectMotion(page, "playing");
          await page.evaluate(() =>
            window.scrollTo({
              top: document.body.scrollHeight,
              behavior: "instant",
            }),
          );
          await expectMotion(page, "paused");
          await scene.scrollIntoViewIfNeeded();
          await expectMotion(page, "playing");
          await page.emulateMedia({ reducedMotion: "reduce" });
          await expectMotion(page, "paused", "static");
          assert.equal((await animationSample(page)).length, 0);
          await page.emulateMedia({ reducedMotion: "no-preference" });
          await expectMotion(page, "playing", "ambient");
          await page.locator("[data-fixture-low-power]").check();
          await expectMotion(page, "paused", "static");
          await page.locator("[data-fixture-low-power]").uncheck();
          await expectMotion(page, "playing", "ambient");
          await page.locator("[data-fixture-running]").uncheck();
          await expectMotion(page, "paused", "static");
          assert.equal(await scene.locator("[class*='particle']").count(), 0);
          await page.locator("[data-fixture-running]").check();
          await scene.scrollIntoViewIfNeeded();
          await expectMotion(page, "playing");
          result.pauseFreezeOffscreenLiveReduceLowPowerAndRunningGate = true;
        }

        const replay = page.getByRole("button", {
          name: "처음 안내 다시 보기",
          exact: true,
        });
        await replay.click();
        await coach.waitFor({ state: "visible" });
        await page.waitForTimeout(250);
        assert.equal(await coach.getAttribute("aria-modal"), "false");
        result.replayContrast = await readMotionControlContrast(replay);
        assertMotionControlContrast(result.replayContrast);
        result.dismissContrast = await readMotionControlContrast(
          coach.getByRole("button", { name: "나중에 보기", exact: true }),
        );
        assertMotionControlContrast(result.dismissContrast);
        assert.equal(
          await page.evaluate(() => document.activeElement?.tagName),
          "H2",
        );
        const coachGeometry = await coach.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return {
            rect: rect.toJSON(),
            viewport: { width: innerWidth, height: innerHeight },
          };
        });
        assert(
          coachGeometry.rect.left >= -1 &&
            coachGeometry.rect.top >= -1 &&
            coachGeometry.rect.right <= width + 1 &&
            coachGeometry.rect.bottom <= coachGeometry.viewport.height + 1,
          "Coach mark must stay within viewport",
        );
        await page.screenshot({
          path: path.join(output, `${name}-coach.png`),
          animations: "allow",
        });
        await page.keyboard.press("Escape");
        await coach.waitFor({ state: "detached" });
        assert.equal(
          await replay.evaluate((node) => document.activeElement === node),
          true,
        );
        result.coachGeometry = coachGeometry;
        result.nonmodalReplayFocusEscapeReturn = true;
        result.mockCalls = await page.evaluate(
          () => window.__PUTDUK_FIXTURE__.calls,
        );
        assert.deepEqual(
          result.mockCalls,
          [],
          "Presentation must not issue money/auth/backend operations",
        );
        result.consoleErrors = errors;
        assert.deepEqual(errors, []);
        const video = page.video();
        await context.close();
        const videoPath = await video.path();
        const savedVideo = path.join(output, `${name}.webm`);
        await fs.rename(videoPath, savedVideo);
        result.video = path.basename(savedVideo);
        results.push(result);
        console.info(`${name}: passed`);
      }
    }
  }
} finally {
  await browser.close();
  const sourceAfter = await readMotionEvidenceSnapshot(projectRoot);
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        fixtureUrl: url.href,
        actualDevice,
        sourceBefore,
        sourceAfter,
        observedAt: new Date().toISOString(),
        acceptance:
          "LOCAL_PRESENTATION_ONLY_NOT_AUTHENTICATED_PRODUCT_ACCEPTANCE",
        results,
      },
      null,
      2,
    ),
  );
  assert.deepEqual(
    sourceAfter,
    sourceBefore,
    "Source/CSS/asset changed during evidence; do not accept the recording as one source state",
  );
}
