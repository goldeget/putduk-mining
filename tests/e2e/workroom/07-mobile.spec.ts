import { test, expect } from "@playwright/test";
import { member, login } from "./helpers";
test("390px browser displays real member simulation and navigates history without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, await member());
  await expect(
    page.getByRole("button", { name: "모니터링 시작", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("navigation", { name: "워크룸 빠른 메뉴" })
    .getByRole("link", { name: "참여 내역" })
    .click();
  await expect(page).toHaveURL(/\/workroom\/history$/);
  await expect(
    page.getByRole("heading", { name: "참여 내역", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("member-mobile.png"),
    fullPage: true,
  });
});
