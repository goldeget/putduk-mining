import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

function sourceManifest() {
  const base = "dccbfab63c5ba2fefe7f8cc689e512d326235b2e";
  const names = new Set([
    ...execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" })
      .trim()
      .split("\n"),
    ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n"),
  ]);
  return Object.fromEntries(
    [...names]
      .filter(
        (name) => name && !name.startsWith("docs/") && fs.existsSync(name),
      )
      .sort()
      .map((name) => [
        name,
        createHash("sha256").update(fs.readFileSync(name)).digest("hex"),
      ]),
  );
}
const sourceBefore = sourceManifest();

const output =
  process.env.PUTDUK_UI_EVIDENCE_DIR ??
  "test-results/ui-motion-remediation/admin-anonymous-browser";
fs.mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:3351";
const routes = [
  "/login",
  "/reauth",
  "/session-expired",
  "/unauthorized",
  "/mfa",
  "/ui-remediation-missing-page",
];

const cases = [
  { width: 390, preference: "light", os: "dark" },
  { width: 390, preference: "dark", os: "light" },
  { width: 834, preference: "system", os: "light" },
  { width: 834, preference: "system", os: "dark" },
  { width: 1440, preference: "light", os: "dark" },
  { width: 1440, preference: "dark", os: "light" },
];
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const results = [];
const failures = [];
const fonts = [];
const interactions = [];
try {
  for (const setting of cases) {
    const context = await browser.newContext({
      viewport: { width: setting.width, height: 952 },
      locale: "ko-KR",
      colorScheme: setting.os,
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    await context.addInitScript((preference) => {
      localStorage.setItem("putduk-theme", preference);
    }, setting.preference);
    await context.route("**/*", (route) =>
      route.request().url().startsWith(origin) &&
      ["GET", "HEAD"].includes(route.request().method())
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const route of routes) {
      const label = `${route === "/" ? "landing" : route.slice(1).replaceAll("/", "-")}-${setting.width}-${setting.preference}-${setting.os}`;
      try {
        const response = await page.goto(origin + route, {
          waitUntil: "networkidle",
          timeout: 90000,
        });
        await page.locator("main").first().waitFor({ timeout: 15000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.images].map((image) => image.decode().catch(() => {})),
          );
        });
        const data = await page.evaluate(() => {
          const rect = (element) => {
            const r = element.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              right: r.right,
              bottom: r.bottom,
            };
          };
          const visible = (element) => {
            const s = getComputedStyle(element),
              r = rect(element);
            return (
              s.display !== "none" &&
              s.visibility !== "hidden" &&
              r.width > 0 &&
              r.height > 0
            );
          };
          const root = document.documentElement;
          const passwordFields = [
            ...document.querySelectorAll(
              ".auth-form__password,.signup-form__password",
            ),
          ].map((wrapper) => {
            const input = wrapper.querySelector("input"),
              button = wrapper.querySelector("button");
            const a = rect(input),
              b = rect(button),
              style = getComputedStyle(input);
            return {
              input: a,
              button: b,
              centerOffset: b.y + b.height / 2 - (a.y + a.height / 2),
              paddingEnd: parseFloat(style.paddingRight),
              buttonReserve: a.right - b.x,
            };
          });
          const mascot = document.querySelector(".hero__mascot img"),
            visual = document.querySelector(".hero__visual");
          const mascotContained =
            mascot && visual
              ? (() => {
                  const a = rect(mascot),
                    b = rect(visual);
                  return (
                    a.x >= b.x &&
                    a.y >= b.y &&
                    a.right <= b.right &&
                    a.bottom <= b.bottom
                  );
                })()
              : null;
          return {
            resolved: root.dataset.theme,
            preference: root.dataset.themePreference,
            colorScheme: root.style.colorScheme,
            themeColors: [
              ...document.querySelectorAll('meta[name="theme-color"]'),
            ].map((meta) => meta.content),
            bodyWidth: root.scrollWidth,
            viewport: innerWidth,
            fontFamily: getComputedStyle(document.body).fontFamily,
            fontFaces: document.fonts.size,
            fontResources: performance
              .getEntriesByType("resource")
              .filter((entry) => entry.name.includes(".woff"))
              .map((entry) => ({
                name: new URL(entry.name).pathname,
                bytes: entry.transferSize,
              })),
            passwordFields,
            mascotContained,
            smallText: [...document.querySelectorAll("main *")]
              .filter(
                (element) =>
                  visible(element) &&
                  [...element.childNodes].some(
                    (node) => node.nodeType === 3 && node.textContent.trim(),
                  ) &&
                  parseFloat(getComputedStyle(element).fontSize) < 14,
              )
              .map((element) => ({
                tag: element.tagName,
                text: element.textContent.slice(0, 60),
                size: getComputedStyle(element).fontSize,
              })),
            state:
              document
                .querySelector("[data-ui-ready]")
                ?.getAttribute("data-ui-state") ?? null,
          };
        });
        const expected =
          setting.preference === "system" ? setting.os : setting.preference;
        const problems = [];
        if (response.status() >= 500)
          problems.push(`HTTP ${response.status()}`);
        if (data.resolved !== expected) problems.push("theme mismatch");
        if (data.bodyWidth > setting.width + 1)
          problems.push("horizontal overflow");
        if (data.mascotContained === false) problems.push("mascot clipped");
        if (
          data.passwordFields.some(
            (field) =>
              Math.abs(field.centerOffset) > 1 ||
              field.paddingEnd + 1 < field.buttonReserve,
          )
        )
          problems.push("password geometry");
        await page.evaluate(() =>
          scrollTo(0, document.documentElement.scrollHeight),
        );
        const supportOverlaps = await page.evaluate(() => {
          const button = document.querySelector("#putduk-support-launcher");
          if (!button) return [];
          const a = button.getBoundingClientRect();
          return [
            ...document.querySelectorAll(
              "main a,main button,main input,footer a,footer p",
            ),
          ]
            .filter(
              (element) => element !== button && !button.contains(element),
            )
            .filter((element) => {
              const b = element.getBoundingClientRect();
              return (
                b.width > 0 &&
                b.height > 0 &&
                b.left < a.right &&
                b.right > a.left &&
                b.top < a.bottom &&
                b.bottom > a.top
              );
            })
            .map((element) => element.textContent.trim().slice(0, 70));
        });
        if (supportOverlaps.length) problems.push("support overlap");
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: path.join(output, label + ".png"),
          fullPage: true,
          animations: "disabled",
        });
        results.push({
          route,
          ...setting,
          label,
          status: response.status(),
          ...data,
          supportOverlaps,
          problems,
        });
        if (problems.length) failures.push({ route, ...setting, problems });
        if (route === "/login") {
          const session = await context.newCDPSession(page);
          await session.send("DOM.enable");
          await session.send("CSS.enable");
          const document = await session.send("DOM.getDocument");
          const node = await session.send("DOM.querySelector", {
            nodeId: document.root.nodeId,
            selector: ".auth-card h1",
          });
          if (node.nodeId)
            fonts.push({
              setting,
              ...(await session.send("CSS.getPlatformFontsForNode", {
                nodeId: node.nodeId,
              })),
            });
          await session.detach();
          const control = page.getByRole("combobox", { name: "화면 테마" });
          await control.selectOption("system");
          await page.emulateMedia({
            colorScheme: setting.os === "dark" ? "light" : "dark",
          });
          await page.waitForFunction(
            (os) => document.documentElement.dataset.theme === os,
            setting.os === "dark" ? "light" : "dark",
          );
          interactions.push({
            scenario: "live OS theme change",
            setting,
            resolved: await page.locator("html").getAttribute("data-theme"),
          });
          await page.emulateMedia({ colorScheme: setting.os });
          await control.selectOption(setting.preference);
        }
      } catch (error) {
        failures.push({ route, ...setting, error: error.message });
      }
    }
    if (errors.length) failures.push({ setting, pageerrors: errors });
    await context.close();
    console.log(
      JSON.stringify({
        setting,
        completed: results.length,
        failures: failures.length,
      }),
    );
  }
} finally {
  await browser.close();
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        sourceBefore,
        sourceAfter: sourceManifest(),
        sourceStable:
          JSON.stringify(sourceBefore) === JSON.stringify(sourceManifest()),
        basis:
          "Actual Next administrator anonymous/recovery SSR and client hydration; MFA may redirect to login; local-only GET/HEAD and no authenticated/DB acceptance",
        results,
        failures,
        fonts,
        interactions,
      },
      null,
      2,
    ),
  );
}
console.log(JSON.stringify({ contexts: results.length, failures }));
if (failures.length) process.exitCode = 1;
if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceManifest()))
  throw new Error("Source changed during public evidence");
