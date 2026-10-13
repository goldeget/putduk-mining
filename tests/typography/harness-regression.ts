import { expect, test } from "@playwright/test";

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
  await page.setContent(
    '<main style="height:100px;overflow:auto"><div style="height:10000px"></div><img loading="lazy" src="https://typography.test/lazy.svg" width="12" height="12" alt="정상 이미지"></main>',
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
      .locator("img")
      .evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0,
      ),
  ).toBe(true);
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
});
