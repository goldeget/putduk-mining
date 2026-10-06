import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

const widths = [320, 390, 834, 1440] as const;
const themes = ["dark", "light"] as const;

type Reference = {
  reference_id: string;
  sha256: string;
  route_mapping: string[];
  classification: { viewport: string; theme: string; screen_type: string };
};

async function sourceReferences() {
  const index = JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "docs/design/mockup-source-index-2026-10-06.json",
      ),
      "utf8",
    ),
  ) as { images: Reference[] };
  expect(index.images).toHaveLength(52);
  expect(new Set(index.images.map((image) => image.sha256)).size).toBe(45);
  expect(
    index.images.every(
      (image) =>
        image.route_mapping.length > 0 &&
        image.classification.screen_type !== "unreviewed",
    ),
  ).toBe(true);
  return index.images;
}

async function captureRoutes(
  page: Page,
  testInfo: TestInfo,
  routes: string[],
  references: Reference[],
) {
  const records = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`page:${error.name}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console:error");
  });
  page.on("requestfailed", (request) => {
    // A route change may cancel its previous prefetch. Other failures remain errors.
    if (request.failure()?.errorText !== "net::ERR_ABORTED")
      errors.push(`network:${new URL(request.url()).pathname}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(
        `http:${response.status()}:${new URL(response.url()).pathname}`,
      );
  });
  await page.goto(routes[0]!, { waitUntil: "networkidle" });
  for (const route of routes) {
    for (const width of widths) {
      for (const theme of themes) {
        await page.setViewportSize({
          width,
          height: width === 834 ? 1112 : 900,
        });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.evaluate((value) => {
          localStorage.setItem("putduk-theme", value);
        }, theme);
        const response = await page.goto(route, { waitUntil: "networkidle" });
        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL((url) => url.pathname === route);
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        await main.evaluate((element) =>
          element.scrollTo({ top: 0, behavior: "instant" }),
        );
        const ready = page.locator(`[data-ui-ready="${route}"]`);
        await expect(ready).toHaveCount(1);
        await expect(ready).toBeVisible();
        for (const textScale of route === "/wallet" &&
        width === 390 &&
        theme === "light"
          ? [1, 2]
          : [1]) {
          await page.evaluate((scale) => {
            document.documentElement.style.fontSize = scale === 2 ? "200%" : "";
          }, textScale);
          await main.evaluate((element) =>
            element.scrollTo({ top: 0, behavior: "instant" }),
          );
          await page.evaluate(() => document.fonts.ready);
          await expect
            .poll(() =>
              page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1,
              ),
            )
            .toBe(true);
          expect(
            await page.evaluate(() => /[가-힣]/.test(document.body.innerText)),
          ).toBe(true);
          await expect
            .poll(() =>
              page.evaluate(() =>
                [...document.images]
                  .filter((image) => image.getBoundingClientRect().width > 0)
                  .every((image) => image.complete && image.naturalWidth > 0),
              ),
            )
            .toBe(true);
          expect(errors).toEqual([]);
          const suffix = textScale === 2 ? "-text-200" : "";
          const filename = `${route.slice(1)}-${width}-${theme}${suffix}.png`;
          const output = testInfo.outputPath(filename);
          await page.screenshot({
            path: output,
            fullPage: true,
            animations: "disabled",
            caret: "initial",
          });
          const contents = await readFile(output);
          const matched = references.filter(
            (reference) =>
              reference.route_mapping.includes(route) &&
              reference.classification.theme === theme &&
              (width === 390
                ? reference.classification.viewport === "mobile"
                : width === 1440
                  ? reference.classification.viewport === "desktop"
                  : false),
          );
          records.push({
            route,
            width,
            theme,
            screenshot: filename,
            sha256: createHash("sha256").update(contents).digest("hex"),
            state: await ready.getAttribute("data-ui-state"),
            scroll_position: "top",
            text_scale: textScale,
            references: matched.map((reference) => reference.reference_id),
            manual_reference_comparison: "pending",
          });
          const { scrollRange, step } = await main.evaluate((element) => ({
            scrollRange: element.scrollHeight - element.clientHeight,
            // Overlapping tiles cover the middle of independently scrolling main.
            step: Math.max(1, Math.floor(element.clientHeight * 0.7)),
          }));
          if (scrollRange > 16) {
            const positions = [];
            for (let top = step; top < scrollRange; top += step) {
              positions.push(top);
            }
            positions.push(scrollRange);
            for (const [index, top] of positions.entries()) {
              await main.evaluate(
                (element, top) =>
                  element.scrollTo({
                    top,
                    behavior: "instant",
                  }),
                top,
              );
              await expect
                .poll(() =>
                  main.evaluate(
                    (element, expected) =>
                      Math.abs(element.scrollTop - expected),
                    top,
                  ),
                )
                .toBeLessThanOrEqual(1);
              const position =
                top === scrollRange ? "bottom" : `middle-${index + 1}`;
              const bottomFilename = `${route.slice(1)}-${width}-${theme}${suffix}-${position}.png`;
              const bottomOutput = testInfo.outputPath(bottomFilename);
              await page.screenshot({
                path: bottomOutput,
                fullPage: true,
                animations: "disabled",
                caret: "initial",
              });
              const bottomContents = await readFile(bottomOutput);
              records.push({
                route,
                width,
                theme,
                screenshot: bottomFilename,
                sha256: createHash("sha256")
                  .update(bottomContents)
                  .digest("hex"),
                state: await ready.getAttribute("data-ui-state"),
                scroll_position: position,
                scroll_top: top,
                scroll_range: scrollRange,
                capture_step: step,
                text_scale: textScale,
                references: matched.map((reference) => reference.reference_id),
                manual_reference_comparison: "pending",
              });
            }
          }
        }
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });
      }
    }
  }
  await writeFile(
    testInfo.outputPath("reference-render-index.json"),
    JSON.stringify(
      { records, console_network_errors: errors, visual_qa_complete: false },
      null,
      2,
    ) + "\n",
  );
}

test("captures every public authentication reference family with live controls", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const references = await sourceReferences();
  await captureRoutes(page, testInfo, ["/login", "/signup"], references);
});

test("captures every member reference family without fabricated balances or activity", async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  const references = await sourceReferences();
  const member = await createConfirmedMember("mockup-reference-empty");
  await loginAsMember(page, member, "/home");
  await dismissGuidedQuestIfPresent(page);
  await captureRoutes(
    page,
    testInfo,
    ["/home", "/mining", "/products", "/wallet", "/menu", "/ai"],
    references,
  );
});
