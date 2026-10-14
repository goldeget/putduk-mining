import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { expect, type Page, type TestInfo } from "@playwright/test";

import { awaitPaintedImages } from "./painted-images";
import { assertViewportFits } from "./viewport-geometry";
import {
  assertTypographyClean,
  settleRenderedTypographyImages,
} from "../../../typography/helpers";

async function captureAllocatedOverflowDiagnostics(
  page: Page,
  info: TestInfo,
  label: string,
) {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector("main");
    const mainBounds = main?.getBoundingClientRect();
    const documentOverflow =
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth;
    const mainOverflow = main ? main.scrollWidth - main.clientWidth : null;
    if (documentOverflow <= 1 && mainOverflow !== null && mainOverflow <= 1)
      return null;
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
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    };
    const candidates = [...(main?.querySelectorAll("*") ?? [])]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          (element.scrollWidth > element.clientWidth + 1 ||
            rect.right > (mainBounds?.right ?? innerWidth) + 1 ||
            rect.left < (mainBounds?.left ?? 0) - 1)
        );
      })
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          sourceClasses: [...element.classList]
            .filter((value) => /^[A-Za-z_][A-Za-z0-9_-]{0,100}$/.test(value))
            .slice(0, 8),
          bounds: bounds(element),
          parent: element.parentElement
            ? {
                tag: element.parentElement.tagName,
                bounds: bounds(element.parentElement),
              }
            : null,
          sourceFlags: {
            walletScene: element.hasAttribute("data-wallet-scene-state"),
            walletSummary: element.hasAttribute("data-wallet-summary"),
            walletMetrics: element.hasAttribute("data-wallet-metrics"),
            walletValue: element.hasAttribute("data-wallet-value"),
            walletLedger: element.hasAttribute("data-wallet-entry-direction"),
          },
          layout: {
            display: style.display,
            position: style.position,
            overflowX: style.overflowX,
            whiteSpace: style.whiteSpace,
            width: style.width,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
            flexBasis: style.flexBasis,
            flexShrink: style.flexShrink,
          },
        };
      })
      .sort(
        (a, b) =>
          b.bounds.right -
          (mainBounds?.right ?? innerWidth) -
          (a.bounds.right - (mainBounds?.right ?? innerWidth)),
      );
    return {
      documentOverflow,
      mainOverflow,
      main: main ? bounds(main) : null,
      candidateCount: candidates.length,
      cappedAt: 40,
      // Include offscreen descendants: a clipped main can hide their overflow.
      offenders: candidates.slice(0, 40),
    };
  });
  if (!geometry) return;
  const output = info.outputPath(`${label}-bounded-overflow-nodes.json`);
  await writeFile(output, JSON.stringify(geometry, null, 2) + "\n");
  await info.attach("catalog-bounded-overflow-nodes", {
    path: output,
    contentType: "application/json",
  });
}

export async function captureAllocatedMatrix(
  page: Page,
  info: TestInfo,
  label: string,
  selectedTheme?: "dark" | "light",
) {
  const records = [];
  const matrixStartedAt = Date.now();
  const expandedTypographyMatrix =
    label === "funded-wallet-real-principal" ||
    label === "funded-home-server-status";
  const widths = expandedTypographyMatrix
    ? [320, 360, 390, 430, 834, 1024, 1440]
    : [320, 390, 834, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
    for (const theme of selectedTheme
      ? [selectedTheme]
      : (["dark", "light"] as const)) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page
        .getByRole("combobox", { name: "화면 테마" })
        .first()
        .selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme-preference",
        theme,
      );
      const textScales = expandedTypographyMatrix
        ? [100, 125, 150, 200]
        : [100];
      for (const textScale of textScales) {
        const stateStartedAt = Date.now();
        const firstCapture = records.length;
        await page.evaluate((scale) => {
          document.documentElement.style.fontSize = `${16 * (scale / 100)}px`;
        }, textScale);
        await expect(
          page.getByRole("combobox", { name: "화면 테마" }).first(),
        ).toHaveValue(theme);
        for (const scene of await page.locator("[data-scene-theme]").all()) {
          await expect(scene).toHaveAttribute("data-scene-theme", theme);
        }
        await captureAllocatedOverflowDiagnostics(
          page,
          info,
          `${label}-${width}-${theme}-text-${textScale}`,
        );
        await assertViewportFits(
          page,
          info,
          `${label}-${width}-${theme}-text-${textScale}`,
        );
        await page.evaluate(() => document.fonts.ready);
        if (
          label === "funded-wallet-real-principal" ||
          label === "funded-home-server-status"
        ) {
          await assertTypographyClean(
            page,
            `${label}-${width}-${theme}-text-${textScale}`,
            info,
          );
        }
        if (label === "funded-wallet-real-principal") {
          // Audit the whole rendered name, including the separate JSX suffix.
          // Per-text-node Korean checks previously missed a lone wrapped 님.
          const balance = page.getByRole("region", {
            name: "원화 지갑 잔액",
            exact: true,
          });
          await expect(balance).toHaveCount(1);
          await expect(balance).toBeVisible();
          const labels = [
            balance.getByText("총 원화 잔액", { exact: true }),
            balance.getByText("원화 지갑", { exact: true }),
          ];
          for (const label of labels) {
            await expect(label).toHaveCount(1);
            await expect(label).toBeVisible();
          }
          if (width >= 980) {
            const name = page.locator("[data-wallet-account-name]");
            await expect(name).toHaveText("퍼뜩테스트님");
            labels.push(name);
          }
          for (const label of labels) {
            const geometry = await label.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const fragments = [...range.getClientRects()].filter(
                (rect) => rect.width > 0,
              );
              const bounds = element.getBoundingClientRect();
              return {
                text: element.textContent,
                oneLine:
                  fragments.length > 0 &&
                  fragments.every(
                    (rect) => Math.abs(rect.top - fragments[0]!.top) <= 1,
                  ),
                fits: fragments.every(
                  (rect) =>
                    rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1,
                ),
              };
            });
            const context = JSON.stringify({
              width,
              theme,
              textScale,
              geometry,
            });
            expect(geometry.oneLine, context).toBe(true);
            expect(geometry.fits, context).toBe(true);
          }
          const amounts = balance.locator("dl > div > dd");
          await expect(amounts).toHaveCount(3);
          await expect(balance.locator("dl dt")).toHaveText([
            "인정 원금",
            "대기 수익",
            "출금 가능",
          ]);
          for (const [amountIndex, amount] of (await amounts.all()).entries()) {
            if (amountIndex === 1) {
              // Pending is the server's micro-KRW display, not settled wallet won.
              // formatMiningMicroKrw intentionally preserves sub-won accrual.
              await expect(amount).toHaveText(
                /^(?:(?:0|[1-9][0-9]{0,2}(?:,[0-9]{3})*)원|1원 미만|약 [1-9][0-9]{0,2}(?:,[0-9]{3})*원)$/,
              );
              const displayedValue = await amount
                .locator("[data-wallet-value]")
                .getAttribute("data-wallet-value");
              expect(displayedValue).not.toBeNull();
              await expect(amount).toHaveText(displayedValue!);
            } else {
              await expect(amount).toHaveText(
                /^-?[0-9][0-9,]*(?:\.[0-9]+)?원$/,
              );
            }
            const geometry = await amount.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
              );
              const fragments: {
                top: number;
                bottom: number;
                left: number;
                right: number;
              }[] = [];
              while (walker.nextNode()) {
                const range = document.createRange();
                range.selectNodeContents(walker.currentNode);
                fragments.push(
                  ...[...range.getClientRects()]
                    .filter((rect) => rect.width > 0)
                    .map(({ top, bottom, left, right }) => ({
                      top,
                      bottom,
                      left,
                      right,
                    })),
                );
              }
              return {
                text: element.textContent,
                oneLine:
                  fragments.length > 0 &&
                  // A smaller currency unit shares the number's visual line
                  // through vertical overlap, even when glyph tops differ.
                  // A wrapped number or unit has no common vertical interval.
                  Math.max(...fragments.map((rect) => rect.top)) <
                    Math.min(...fragments.map((rect) => rect.bottom)) - 1,
                fits: fragments.every(
                  (rect) =>
                    rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1,
                ),
                fontSize: Number.parseFloat(
                  getComputedStyle(element.firstElementChild ?? element)
                    .fontSize,
                ),
                fragments,
              };
            });
            if (
              !geometry.oneLine ||
              !geometry.fits ||
              geometry.fontSize < 16 * (textScale / 100)
            ) {
              await amount.scrollIntoViewIfNeeded();
              const failure = info.outputPath(
                `wallet-amount-failed-${width}-${theme}-text-${textScale}.png`,
              );
              await page.screenshot({ path: failure, animations: "disabled" });
              await info.attach("wallet-painted-amount-failure", {
                path: failure,
                contentType: "image/png",
              });
            }
            const context = JSON.stringify({
              width,
              theme,
              textScale,
              geometry,
            });
            expect(geometry.oneLine, context).toBe(true);
            expect(geometry.fits, context).toBe(true);
            expect(geometry.fontSize, context).toBeGreaterThanOrEqual(
              16 * (textScale / 100),
            );
          }
          const history = page.getByRole("region", {
            name: "최근 거래 내역",
            exact: true,
          });
          const credit = history.locator(
            '[data-wallet-entry-direction="CREDIT"]',
          );
          await expect(credit).toHaveCount(1);
          const historyAmount = credit.getByText("+100,000원", { exact: true });
          await expect(historyAmount).toHaveCount(1);
          await expect(historyAmount).toHaveText("+100,000원");
          const historyGeometry = await historyAmount.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const fragments = [...range.getClientRects()].filter(
              (rect) => rect.width > 0,
            );
            const bounds = element.getBoundingClientRect();
            return {
              oneLine:
                fragments.length > 0 &&
                fragments.every(
                  (rect) => Math.abs(rect.top - fragments[0]!.top) <= 1,
                ),
              fits: fragments.every(
                (rect) =>
                  rect.left >= bounds.left - 1 &&
                  rect.right <= bounds.right + 1,
              ),
            };
          });
          expect(
            historyGeometry,
            `${width}px ${theme} ${textScale}% exact ledger amount and currency`,
          ).toEqual({ oneLine: true, fits: true });
        }
        const main = page.getByRole("main");
        await expect(main).toHaveCount(1);
        // The previous viewport may have ended at the bottom of main. Reset
        // before checking the new responsive/theme source and its decoded paint.
        await main.evaluate((element) =>
          element.scrollTo({ top: 0, behavior: "instant" }),
        );
        await page.evaluate(() => window.scrollTo(0, 0));
        await settleRenderedTypographyImages(page);
        await expect
          .poll(() =>
            page.evaluate(() =>
              [...document.images]
                .filter(
                  (image) =>
                    image.checkVisibility({
                      opacityProperty: true,
                      visibilityProperty: true,
                    }) &&
                    image.getBoundingClientRect().width > 0 &&
                    image.getBoundingClientRect().height > 0,
                )
                .every((image) => image.complete && image.naturalWidth > 0),
            ),
          )
          .toBe(true);
        if (label === "funded-home-server-status") {
          const summaryRows = await page
            .getByRole("region", { name: "내 채굴 정보", exact: true })
            .evaluate((section) => {
              const grid = section.querySelector(":scope > div")!;
              const rows = new Map<number, number>();
              for (const card of grid.children) {
                const rect = card.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                const top = Math.round(rect.top);
                rows.set(top, (rows.get(top) ?? 0) + 1);
              }
              return [...rows.values()];
            });
          expect(summaryRows.reduce((sum, count) => sum + count, 0)).toBe(
            theme === "dark" ? 4 : 3,
          );
          expect(
            new Set(summaryRows).size,
            `${width}px ${theme} ${textScale}% balanced summary rows`,
          ).toBe(1);
          const accountAmounts = page.locator("[data-home-amount]");
          await expect(accountAmounts).toHaveCount(2);
          const confirmedPrincipal = page.locator(
            '[data-fact="principal"] strong',
          );
          await expect(confirmedPrincipal).toHaveText("100,000원");
          for (const amount of [
            ...(await accountAmounts.all()),
            confirmedPrincipal,
          ]) {
            await expect(amount).toHaveText(/^-?[0-9][0-9,]*(?:\.[0-9]+)?원$/);
            const geometry = await amount.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const fragments = [...range.getClientRects()].filter(
                (rect) => rect.width > 0,
              );
              const bounds = element.getBoundingClientRect();
              return {
                text: element.textContent,
                oneLine:
                  fragments.length > 0 &&
                  fragments.every(
                    (rect) => Math.abs(rect.top - fragments[0]!.top) <= 1,
                  ),
                fits: fragments.every(
                  (rect) =>
                    rect.left >= bounds.left - 1 &&
                    rect.right <= bounds.right + 1,
                ),
              };
            });
            const context = JSON.stringify({
              width,
              theme,
              textScale,
              geometry,
            });
            expect(geometry.oneLine, context).toBe(true);
            expect(geometry.fits, context).toBe(true);
          }
          const hero = page
            .getByRole("region", { name: "오늘의 채굴 상태", exact: true })
            .locator("picture[data-scene-theme] img");
          await expect(hero).toHaveCount(1);
          const family =
            theme === "light"
              ? width >= 980
                ? "semiconductor-wafer-light-desktop"
                : "semiconductor-wafer-light"
              : width >= 980
                ? "semiconductor-tower-desktop"
                : "semiconductor-tower";
          await expect
            .poll(() =>
              hero.evaluate(
                (image: HTMLImageElement) =>
                  new URL(image.currentSrc, location.href).pathname,
              ),
            )
            .toContain(`/brand/scenes/${family}/`);
          await awaitPaintedImages(page);
          await expect
            .poll(() =>
              hero.evaluate(
                (image: HTMLImageElement) =>
                  new URL(image.currentSrc, location.href).pathname,
              ),
            )
            .toContain(`/brand/scenes/${family}/`);
          const capacity = page.locator('a[data-fact="capacity"] strong');
          await expect(capacity).toHaveCount(1);
          await expect(capacity).not.toHaveText("확인할 수 없음");
          // Exact server precision must fit instead of being clipped by the card.
          expect(
            await capacity.evaluate(
              (element) => element.scrollWidth <= element.clientWidth + 1,
            ),
          ).toBe(true);
          if (theme === "dark") {
            // Full server precision and currency remain together. A scrollWidth
            // check alone previously passed even while fractional digits wrapped.
            const geometry = await capacity.evaluate((element) => {
              const range = document.createRange();
              range.selectNodeContents(element);
              const fragments = [...range.getClientRects()].filter(
                (rect) => rect.width > 0,
              );
              const oneLine =
                fragments.length > 0 &&
                fragments.every(
                  (rect) => Math.abs(rect.top - fragments[0]!.top) <= 1,
                );
              return {
                oneLine,
                valueWidth: element.getBoundingClientRect().width,
                cardWidth: element.closest("a")!.getBoundingClientRect().width,
                fontSize: getComputedStyle(element).fontSize,
                fragments: fragments.map(({ top, width }) => ({ top, width })),
              };
            });
            if (!geometry.oneLine) {
              await capacity.scrollIntoViewIfNeeded();
              await awaitPaintedImages(page);
              const failure = info.outputPath(
                `capacity-failed-${width}-${theme}-text-${textScale}.png`,
              );
              await page.screenshot({ path: failure, animations: "disabled" });
              await info.attach("capacity-painted-failure", {
                path: failure,
                contentType: "image/png",
              });
            }
            expect(
              geometry.oneLine,
              JSON.stringify({ width, theme, textScale, geometry }),
            ).toBe(true);
          }
        }
        const { range, step } = await main.evaluate((element) => ({
          range: element.scrollHeight - element.clientHeight,
          step: Math.max(1, Math.floor(element.clientHeight * 0.7)),
        }));
        const positions = [0];
        for (let top = step; top < range; top += step) positions.push(top);
        if (range > 16) positions.push(range);
        for (const [index, top] of positions.entries()) {
          await main.evaluate(
            (element, top) => element.scrollTo({ top, behavior: "instant" }),
            top,
          );
          await expect
            .poll(() => main.evaluate((element) => element.scrollTop))
            .toBe(top);
          const paintedImages = await awaitPaintedImages(page);
          const position =
            top === 0 ? "top" : top === range ? "bottom" : `middle-${index}`;
          const scaleSuffix = textScale === 100 ? "" : `-text-${textScale}`;
          const name = `${label}-${width}-${theme}${scaleSuffix}-${position}`;
          const screenshot = `${name}.png`;
          const output = info.outputPath(screenshot);
          // A body-only attachment is discarded by the list reporter. Keep the
          // actual file so every accepted paid render can be reviewed afterwards.
          await page.screenshot({
            path: output,
            fullPage: true,
            animations: "disabled",
          });
          await info.attach(name, { path: output, contentType: "image/png" });
          records.push({
            label,
            route: new URL(page.url()).pathname,
            width,
            theme,
            text_scale: textScale,
            screenshot,
            sha256: createHash("sha256")
              .update(await readFile(output))
              .digest("hex"),
            scroll_position: position,
            scroll_top: top,
            scroll_range: range,
            capture_step: step,
            decoded_image_sources: paintedImages,
            manual_reference_comparison: "pending",
          });
        }
        // Bounded one row per matrix state: only reviewed labels and numbers.
        console.info(
          "[catalog-matrix-state] " +
            JSON.stringify({
              label,
              width,
              theme,
              textScale,
              stateElapsedMs: Date.now() - stateStartedAt,
              matrixElapsedMs: Date.now() - matrixStartedAt,
              captureCount: records.length - firstCapture,
            }),
        );
      }
    }
  }
  await writeFile(
    info.outputPath(`${label}-render-index.json`),
    JSON.stringify({ records, visual_qa_complete: false }, null, 2) + "\n",
  );
}
