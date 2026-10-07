import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import { assertTypographyClean } from "../../typography/helpers";
import { ensureLocalTrialProgram } from "./helpers/eligibility";
import { loginAsMember } from "./helpers/member-session";
import { expectSettledRoute } from "./helpers/settled-route";
import { assertViewportFits } from "./helpers/viewport-geometry";

test.beforeAll(async () => {
  await ensureLocalTrialProgram();
});

test("unfunded home retains Korean layout across viewport and text scales", async ({
  page,
}, info) => {
  const member = await createConfirmedMember("home-korean-typography");
  await loginAsMember(page, member, "/home");
  await expectSettledRoute(page, "/home");
  await expect(page.locator('[data-home-amount="wallet"]')).toHaveText("0원");
  const records = [];
  // Start with the newly exposed 430px breakpoint, then cover every requested width.
  for (const width of [430, 320, 360, 390, 834, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
    for (const theme of ["dark", "light"] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page
        .getByRole("combobox", { name: "화면 테마" })
        .first()
        .selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const scale of [100, 125, 150, 200]) {
        const label = `unfunded-home-${width}-${theme}-${scale}`;
        await page.evaluate(async (value) => {
          document.documentElement.style.fontSize = `${(16 * value) / 100}px`;
          await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
        }, scale);
        const overflows = await page.getByRole("main").evaluate((main) =>
          [...main.querySelectorAll<HTMLElement>("*")]
            .filter(
              (el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1,
            )
            .map((el) => ({
              className: el.className,
              tag: el.tagName,
              client: el.clientWidth,
              scroll: el.scrollWidth,
              overflow: getComputedStyle(el).overflowX,
              text: el.innerText?.slice(0, 80),
            })),
        );
        await info.attach(`${label}-intrinsic-overflows`, {
          body: JSON.stringify(overflows),
          contentType: "application/json",
        });
        await assertViewportFits(page, info, label);
        await assertTypographyClean(page, label, info);
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
          `${label}: balanced summary rows`,
        ).toBe(1);
        await page
          .getByRole("main")
          .evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
        await info.attach(label, {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
        records.push({
          width,
          theme,
          textScale: scale,
          route: "/home",
          fixture: "real confirmed member, no funding",
          wallet: "0원",
        });
      }
    }
  }
  expect(records).toHaveLength(56);
  await info.attach("unfunded-home-typography-matrix", {
    body: JSON.stringify(records),
    contentType: "application/json",
  });
});
