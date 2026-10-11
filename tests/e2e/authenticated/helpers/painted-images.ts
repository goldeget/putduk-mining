import { expect, type Page } from "@playwright/test";

/** Wait for responsive image decoding and a stable paint, not just HTTP load. */
export async function awaitPaintedImages(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const images = [...document.images].filter((image) => {
          const box = image.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            box.bottom > 0 &&
            box.top < innerHeight &&
            box.right > 0 &&
            box.left < innerWidth
          );
        });
        const sources = images.map((image) => image.currentSrc);
        const decoded = await Promise.all(
          images.map((image) =>
            image.decode().then(
              () => true,
              () => false,
            ),
          ),
        );
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        return images.every(
          (image, index) =>
            decoded[index] &&
            Boolean(sources[index]) &&
            image.currentSrc === sources[index] &&
            image.complete &&
            image.naturalWidth > 0,
        );
      }),
    )
    .toBe(true);
  return page.evaluate(() =>
    [...document.images]
      .filter((image) => {
        const box = image.getBoundingClientRect();
        return (
          box.width > 0 &&
          box.height > 0 &&
          box.bottom > 0 &&
          box.top < innerHeight
        );
      })
      .map((image) => ({
        source_path: new URL(image.currentSrc, location.href).pathname,
        natural_width: image.naturalWidth,
        natural_height: image.naturalHeight,
      })),
  );
}
