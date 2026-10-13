import { expect, test } from "@playwright/test";

import { awaitPaintedImages } from "../e2e/authenticated/helpers/painted-images";

import {
  assertTypographyClean,
  settleRenderedTypographyImages,
} from "./helpers";

// Separate harness invocation: these are not protected-route or screenshot evidence.
test("closed details are not painted, but the same opened broken Korean copy fails", async ({
  page,
}) => {
  await page.setContent(
    '<details><summary>도움말</summary><p style="width:1em;word-break:break-all;font-size:20px">확인하세요</p></details>',
  );
  await assertTypographyClean(page, "closed-details");
  await page.getByText("도움말", { exact: true }).click();
  await expect(assertTypographyClean(page, "opened-details")).rejects.toThrow(
    "Korean token split across lines",
  );
});

test("rendered lazy images load through real scrolling and restore nested scroll position", async ({
  page,
}) => {
  await page.route("https://typography.test/lazy.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="green"/></svg>',
    }),
  );
  await page.route("https://typography.test/hidden.svg", (route) =>
    route.fulfill({ status: 404, body: "hidden missing image" }),
  );
  await page.setContent(
    '<img style="position:fixed;top:5px;left:5px" src="https://typography.test/lazy.svg" width="12" height="12" alt="보이는 이미지"><img style="position:fixed;top:5px;left:25px;opacity:0" src="https://typography.test/hidden.svg" width="12" height="12" alt="투명한 이미지"><img style="position:fixed;top:5px;left:45px;visibility:hidden" src="https://typography.test/hidden.svg" width="12" height="12" alt="숨긴 이미지"><details><summary>숨긴 그림</summary><img src="https://typography.test/hidden.svg" width="12" height="12" alt="닫힌 도움말 이미지"></details><main style="height:100px;overflow:auto"><div style="height:10000px"></div><img loading="lazy" src="https://typography.test/lazy.svg" width="12" height="12" alt="정상 이미지"></main>',
  );
  await page.locator("main").evaluate((element) => {
    element.scrollTop = 20;
  });
  await settleRenderedTypographyImages(page);
  expect(
    await page.locator("main").evaluate((element) => element.scrollTop),
  ).toBe(20);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page
      .locator("main img")
      .evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0,
      ),
  ).toBe(true);
  const painted = await awaitPaintedImages(page);
  expect(painted).toHaveLength(1);
  expect(painted[0]).toEqual({
    source_path: "/lazy.svg",
    natural_width: 12,
    natural_height: 12,
  });
});

test("a broken rendered image fails and still restores the original scroll position", async ({
  page,
}) => {
  await page.route("https://typography.test/broken.svg", (route) =>
    route.fulfill({ status: 404, body: "missing" }),
  );
  await page.setContent(
    '<main style="height:100px;overflow:auto"><div style="height:10000px"></div><img loading="lazy" src="https://typography.test/broken.svg" width="12" height="12" alt="실패 이미지"></main>',
  );
  await page.locator("main").evaluate((element) => {
    element.scrollTop = 20;
  });
  await expect(settleRenderedTypographyImages(page)).rejects.toThrow(
    "rendered image must load before typography capture",
  );
  expect(
    await page.locator("main").evaluate((element) => element.scrollTop),
  ).toBe(20);
  await page.locator("img").evaluate((image) => image.scrollIntoView());
  await expect(awaitPaintedImages(page)).rejects.toThrow();
});
