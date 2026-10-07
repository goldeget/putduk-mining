import { writeFile } from "node:fs/promises";
import { expect, type Page, type TestInfo } from "@playwright/test";

/** A clipped scrolling main can hide overflow from document.scrollWidth. */
export async function assertViewportFits(
  page: Page,
  info: TestInfo,
  label: string,
) {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      documentOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      mainOverflow: main ? main.scrollWidth - main.clientWidth : null,
      outsideViewport: [...document.querySelectorAll("body *")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.top < innerHeight &&
            (rect.left < -1 || rect.right > innerWidth + 1)
          );
        })
        .slice(0, 40)
        .map((element) => {
          const { left, right, width } = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            class: element.getAttribute("class"),
            left,
            right,
            width,
          };
        }),
    };
  });
  if (
    geometry.documentOverflow > 1 ||
    geometry.mainOverflow === null ||
    geometry.mainOverflow > 1
  ) {
    await writeFile(
      info.outputPath(`${label}-overflow.json`),
      JSON.stringify(geometry, null, 2) + "\n",
    );
    await page
      .getByRole("main")
      .evaluate((element) => element.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath(`${label}-overflow.png`),
      animations: "disabled",
    });
  }
  expect(
    geometry.documentOverflow,
    JSON.stringify(geometry),
  ).toBeLessThanOrEqual(1);
  expect(geometry.mainOverflow, JSON.stringify(geometry)).not.toBeNull();
  expect(geometry.mainOverflow, JSON.stringify(geometry)).toBeLessThanOrEqual(
    1,
  );
}
