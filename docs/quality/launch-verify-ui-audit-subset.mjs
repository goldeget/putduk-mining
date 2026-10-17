import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const outDir = process.env.PUTDUK_UI_AUDIT_DIR;
if (!outDir) {
  console.error("PUTDUK_UI_AUDIT_DIR required");
  process.exit(1);
}

const base = "http://127.0.0.1:3000";
const routes = ["/offline", "/login"];
const profile = {
  name: "system-light",
  preference: "system",
  colorScheme: "light",
};

const browser = await chromium.launch({ headless: true });
const rows = [];

for (const route of routes) {
  const file = `${profile.name}-${route.replace(/\//g, "") || "home"}.png`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: profile.colorScheme,
  });
  await context.addInitScript((pref) => {
    if (pref === "system") localStorage.removeItem("putduk-theme");
    else localStorage.setItem("putduk-theme", pref);
  }, profile.preference);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror:${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console:${m.text()}`);
  });
  let status = 0;
  let error = "";
  try {
    const response = await page.goto(base + route, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    status = response?.status() ?? 0;
    await page.locator("body").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(250);
    // Playwright 기본 caret:hide 는 input 에 caret-color:transparent 를 넣어
    // dev hydration 콘솔을 오탐한다. PRODUCT-COMPLETE-MATRIX `/wallet/withdraw` 와 동일.
    await page.screenshot({
      path: path.join(outDir, file),
      fullPage: true,
      caret: "initial",
    });
  } catch (e) {
    error = String(e?.message || e).slice(0, 300);
  }
  const row = {
    profile: profile.name,
    route,
    status,
    consoleErrors,
    error,
    screenshot: error ? "" : file,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  await context.close();
}

fs.writeFileSync(
  path.join(outDir, "subset-public-route-capture.json"),
  JSON.stringify(rows, null, 2),
);
await browser.close();
