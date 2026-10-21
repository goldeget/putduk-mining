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
    const documentOverflow =
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth;
    const mainOverflow = main ? main.scrollWidth - main.clientWidth : null;
    const sourceClasses = (element: Element) =>
      [...element.classList]
        .filter((value) => /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(value))
        .slice(0, 8);
    // Capture the failing geometry atomically. A separate evaluate before this
    // assertion can observe a different resize/font layout and miss the offender.
    const bounds = (element: Element) => {
      const { left, right, top, bottom, width, height } =
        element.getBoundingClientRect();
      return {
        left,
        right,
        top,
        bottom,
        width,
        height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };
    const failing =
      documentOverflow > 1 || mainOverflow === null || mainOverflow > 1;
    const mainBounds = main ? bounds(main) : null;
    const mainStyle = main && failing ? getComputedStyle(main) : null;
    const clientRight =
      main && mainBounds
        ? mainBounds.left + main.clientLeft + main.clientWidth
        : innerWidth;
    const offenders = failing
      ? [...(main?.querySelectorAll("*") ?? [])]
          .map((element) => ({
            element,
            rect: element.getBoundingClientRect(),
          }))
          .filter(
            ({ element, rect }) =>
              rect.width > 0 &&
              rect.height > 0 &&
              (element.scrollWidth > element.clientWidth + 1 ||
                rect.right > clientRight + 1 ||
                rect.left < (mainBounds?.left ?? 0) - 1),
          )
          .sort((a, b) => b.rect.right - a.rect.right)
          .slice(0, 40)
          .map(({ element }) => {
            const style = getComputedStyle(element);
            return {
              tag: element.tagName,
              sourceClasses: sourceClasses(element),
              bounds: bounds(element),
              parent: element.parentElement
                ? {
                    tag: element.parentElement.tagName,
                    bounds: bounds(element.parentElement),
                  }
                : null,
              layout: {
                display: style.display,
                position: style.position,
                overflowX: style.overflowX,
                whiteSpace: style.whiteSpace,
                width: style.width,
                minWidth: style.minWidth,
                maxWidth: style.maxWidth,
                boxSizing: style.boxSizing,
                flexBasis: style.flexBasis,
                flexShrink: style.flexShrink,
              },
            };
          })
      : [];
    return {
      documentOverflow,
      mainOverflow,
      mainGeometry:
        main && mainBounds && mainStyle
          ? {
              ...mainBounds,
              clientRight,
              clientHeight: main.clientHeight,
              scrollHeight: main.scrollHeight,
              offsetWidth: main.offsetWidth,
              offsetHeight: main.offsetHeight,
              scrollTop: main.scrollTop,
              scrollLeft: main.scrollLeft,
              scrollbarGutter: mainStyle.scrollbarGutter,
              overflowX: mainStyle.overflowX,
              overflowY: mainStyle.overflowY,
              boxSizing: mainStyle.boxSizing,
              paddingLeft: mainStyle.paddingLeft,
              paddingRight: mainStyle.paddingRight,
              borderLeftWidth: mainStyle.borderLeftWidth,
              borderRightWidth: mainStyle.borderRightWidth,
            }
          : null,
      offenders,
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
            class: sourceClasses(element).join(" ") || null,
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
