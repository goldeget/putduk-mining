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
    for (const { theme, preference } of [
      { theme: "dark", preference: "dark" },
      { theme: "light", preference: "light" },
      { theme: "dark", preference: "system" },
      { theme: "light", preference: "system" },
    ] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page
        .getByRole("combobox", { name: "화면 테마" })
        .first()
        .selectOption(preference);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const scale of [100, 125, 150, 200]) {
        const label = `unfunded-home-${width}-${preference}-${theme}-${scale}`;
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
        const shortcuts = page.getByRole("navigation", {
          name: "바로 가기",
          exact: true,
        });
        const primaryActions = shortcuts.locator("[data-home-primary-actions]");
        const visibleLinks = primaryActions.getByRole("link");
        await expect(visibleLinks).toHaveCount(4);
        expect(
          await visibleLinks.evaluateAll((links) =>
            links.map((link) => link.getAttribute("href")),
          ),
        ).toEqual([
          "/mining",
          "/wallet/deposit",
          "/wallet/withdraw",
          theme === "dark" ? "/events" : "/wallet?view=history",
        ]);
        const actionGeometry = await primaryActions.evaluate((grid) => {
          const bounds = grid.getBoundingClientRect();
          const rows = new Map<number, number>();
          const cards = [...grid.children].filter(
            (card) => card.getBoundingClientRect().width > 0,
          );
          const violations: string[] = [];
          for (const card of cards) {
            const rect = card.getBoundingClientRect();
            const top = Math.round(rect.top);
            rows.set(top, (rows.get(top) ?? 0) + 1);
            if (rect.width < 44 || rect.height < 44)
              violations.push("small touch target");
            if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
              violations.push("card outside primary group");
            const label = card.querySelector("strong")!;
            const range = document.createRange();
            range.selectNodeContents(label);
            const textRects = [...range.getClientRects()].filter(
              (text) => text.width > 0 && text.height > 0,
            );
            if (new Set(textRects.map((text) => Math.round(text.top))).size > 1)
              violations.push("wrapped action label");
            if (
              textRects.some(
                (text) =>
                  text.left < rect.left - 1 || text.right > rect.right + 1,
              )
            )
              violations.push("label outside card");
          }
          return { rows: [...rows.values()], violations };
        });
        expect(
          actionGeometry.violations,
          `${label}: readable shortcut labels and touch targets`,
        ).toEqual([]);
        expect(actionGeometry.rows.reduce((sum, count) => sum + count, 0)).toBe(
          4,
        );
        expect(
          new Set(actionGeometry.rows).size,
          `${label}: balanced primary shortcut rows`,
        ).toBe(1);
        const aiHelp = shortcuts.getByRole("button", {
          name: "AI 도움",
          exact: true,
        });
        if (theme === "dark") {
          await expect(aiHelp).toBeVisible();
          const placement = await shortcuts.evaluate((nav) => {
            const group = nav
              .querySelector("[data-home-primary-actions]")!
              .getBoundingClientRect();
            const help = nav
              .querySelector("footer[data-ai-dock]")!
              .getBoundingClientRect();
            return {
              inOwnRow: help.top >= group.bottom - 1,
              fillsGroupWidth: Math.abs(help.width - group.width) <= 1,
              alignedBesideGroup:
                Math.abs(help.top - group.top) <= 1 && help.left >= group.right,
            };
          });
          expect(
            placement.inOwnRow
              ? placement.fillsGroupWidth
              : placement.alignedBesideGroup,
            `${label}: AI remains a deliberate help action`,
          ).toBe(true);
        } else {
          await expect(aiHelp).toBeHidden();
        }
        await info.attach(`${label}-shortcut-layout`, {
          body: JSON.stringify(actionGeometry),
          contentType: "application/json",
        });
        await info.attach(`${label}-shortcuts`, {
          body: await shortcuts.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
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
          preference,
          textScale: scale,
          route: "/home",
          fixture: "real confirmed member, no funding",
          wallet: "0원",
        });
      }
    }
  }
  expect(records).toHaveLength(112);
  await info.attach("unfunded-home-typography-matrix", {
    body: JSON.stringify(records),
    contentType: "application/json",
  });
});
