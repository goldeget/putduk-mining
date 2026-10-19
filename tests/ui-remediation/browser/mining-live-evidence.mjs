import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

/**
 * Local rendering evidence for the live mining summary and scene. Run
 * `node tests/ui-remediation/browser/server.mjs` first. Fixture data and the
 * display server are synthetic; this is not an authenticated end-to-end run.
 */
const base = new URL(
  process.env.PUTDUK_UI_FIXTURE_URL ?? "http://127.0.0.1:4175/",
);
assert(
  ["localhost", "127.0.0.1"].includes(base.hostname),
  "Local-only fixture required",
);
const output =
  process.env.PUTDUK_MINING_EVIDENCE_DIR ??
  "F:/_PUTDUK/Workspaces/putduk-launch-20261019/mining-evidence/mining-live";
await fs.mkdir(output, { recursive: true });
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
});
const results = { cases: [], frames: [], consoleErrors: [], http: [] };
const url = (query = "") => `${base.origin}/?fixture=mining-live${query}`;

async function open(options, query = "") {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height ?? 900 },
    colorScheme: options.scheme ?? "dark",
    reducedMotion: options.reduced ? "reduce" : "no-preference",
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  if (options.cores) {
    await context.addInitScript((cores) => {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => cores,
      });
    }, options.cores);
  }
  page.on("response", (response) => {
    if (response.status() >= 400)
      results.http.push(`${options.name}: ${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    // Failed resource loads are recorded with their URL in `results.http`.
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource"))
      results.consoleErrors.push(`${options.name}: ${message.text()}`);
  });
  page.on("pageerror", (error) =>
    results.consoleErrors.push(`${options.name}: ${error.message}`),
  );
  await page.goto(url(query));
  // The first Vite transform of the fixture graph is slow on this machine.
  await page.waitForSelector("[data-mining-live-summary]", { timeout: 90000 });
  if (options.textScale) {
    await page.addStyleTag({
      content: `html{font-size:${options.textScale}%}`,
    });
  }
  return { context, page };
}

async function metrics(page) {
  return page.evaluate(() => {
    const summary = document.querySelector("[data-mining-live-summary]");
    const layer = document.querySelector("[data-mining-energy]");
    const pending = document.querySelector(
      "[data-mining-live-summary] dl dd [aria-hidden=true]",
    );
    const root = document.documentElement;
    return {
      theme: root.dataset.theme ?? null,
      live: summary?.getAttribute("data-live"),
      readState: summary?.getAttribute("data-read-state"),
      pending: pending?.textContent ?? null,
      energy: layer?.getAttribute("data-mining-energy") ?? null,
      animations: layer
        ? layer.getAnimations({ subtree: true }).length
        : null,
      overflowX: root.scrollWidth - root.clientWidth,
      scrollWidth: root.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
}

// 1. Width x theme matrix, normal motion.
for (const scheme of ["light", "dark"]) {
  for (const width of [320, 390, 834, 1440]) {
    const name = `mining-live-${width}-${scheme}`;
    const { context, page } = await open({ name, width, scheme });
    await page.waitForSelector('[data-mining-live-summary][data-live="true"]', {
      timeout: 20000,
    });
    await page.waitForTimeout(2500);
    const before = await metrics(page);
    await page.screenshot({
      path: path.join(output, `${name}.png`),
      fullPage: true,
    });
    results.cases.push({ name, ...before });
    assert(before.overflowX <= 0, `${name}: horizontal overflow`);
    await context.close();
  }
}

// 2. Reduced motion once (calm equivalent).
{
  const name = "mining-live-390-dark-reduced";
  const { context, page } = await open({
    name,
    width: 390,
    scheme: "dark",
    reduced: true,
  });
  await page.waitForTimeout(3000);
  const state = await metrics(page);
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
  });
  results.cases.push({ name, ...state });
  assert.equal(state.live, "false", "reduced motion must not extend the estimate");
  assert.equal(state.energy, "calm");
  await context.close();
}

// 3. 200% text.
for (const width of [390, 834]) {
  const name = `mining-live-${width}-light-text200`;
  const { context, page } = await open({
    name,
    width,
    scheme: "light",
    textScale: 200,
  });
  await page.waitForTimeout(2500);
  const state = await metrics(page);
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
  });
  results.cases.push({ name, ...state });
  assert(state.overflowX <= 0, `${name}: horizontal overflow at 200% text`);
  await context.close();
}

// 4. Frame sequence: the pending number rising from a fetched receipt.
{
  const { context, page } = await open({
    name: "frames",
    width: 390,
    scheme: "dark",
  });
  await page.waitForSelector('[data-mining-live-summary][data-live="true"]', {
    timeout: 20000,
  });
  const row = page.locator("[data-mining-live-summary] dl > div").first();
  const values = [];
  for (let index = 0; index < 6; index += 1) {
    const text = await page
      .locator("[data-mining-live-summary] dl dd [aria-hidden=true]")
      .first()
      .textContent();
    values.push(text);
    await row.screenshot({
      path: path.join(output, `frame-${String(index).padStart(2, "0")}.png`),
    });
    await page.waitForTimeout(1000);
  }
  const numeric = values.map((value) =>
    BigInt(value.replace("원", "").replace(".", "").replaceAll(",", "")),
  );
  results.frames = values;
  for (let index = 1; index < numeric.length; index += 1)
    assert(numeric[index] >= numeric[index - 1], "number must never fall");
  assert(numeric.at(-1) > numeric[0], "number must rise over time");
  await context.close();
}

// 5. Server settlement indicator (synthetic worker acceptance at +25 s).
{
  const name = "mining-live-390-dark-settlement";
  const { context, page } = await open(
    { name, width: 390, scheme: "dark" },
    "&settle=1",
  );
  await page.waitForSelector("[data-settlement-cue]", { timeout: 60000 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
  });
  results.cases.push({
    name,
    cue: await page.locator("[data-settlement-cue]").textContent(),
    ...(await metrics(page)),
  });
  await context.close();
}

// 6. Scene light layer actually playing (this PC reports 2 cores, which the
// app correctly treats as low-power, so the capability is overridden here).
for (const [width, scheme] of [
  [1440, "dark"],
  [390, "dark"],
  [1440, "light"],
]) {
  const name = `mining-scene-playing-${width}-${scheme}`;
  const { context, page } = await open({ name, width, scheme, cores: 8 });
  await page.waitForSelector('[data-mining-energy="playing"]', {
    timeout: 30000,
  });
  const hero = page.locator("[data-scene-art]").first();
  await hero.screenshot({ path: path.join(output, `${name}-a.png`) });
  await page.waitForTimeout(2500);
  await hero.screenshot({ path: path.join(output, `${name}-b.png`) });
  const probe = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const layer = document.querySelector("[data-mining-energy]");
        const running = layer
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === "running").length;
        const intervals = [];
        let last = performance.now();
        const start = last;
        const tick = (now) => {
          intervals.push(now - last);
          last = now;
          if (now - start < 3000) requestAnimationFrame(tick);
          else {
            intervals.sort((a, b) => a - b);
            resolve({
              running,
              frames: intervals.length,
              medianMs: intervals[Math.floor(intervals.length / 2)],
              p95Ms: intervals[Math.floor(intervals.length * 0.95)],
              worstMs: intervals.at(-1),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  results.cases.push({ name, ...(await metrics(page)), ...probe });
  assert(probe.running >= 3, `${name}: light layer animations must run`);
  await context.close();
}

await browser.close();
await fs.writeFile(
  path.join(output, "results.json"),
  JSON.stringify(results, null, 2),
);
assert.deepEqual(results.consoleErrors, [], "console errors in fixture");
console.info(`Evidence written to ${output}`);
