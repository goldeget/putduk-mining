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
  const chart = page.getByTestId("workroom-chart");
  await expect(chart).toHaveAttribute("data-progress", "0");
  await expect(chart).toHaveAttribute("data-current-value", "100");
  await expect(page.getByText(/종료 시점 미리보기|경로 미리보기/)).toHaveCount(
    0,
  );
  await expect(
    page.getByText("현재 모의 평가 포인트 · 예상값", { exact: true }),
  ).toHaveCount(0);
  const theme = page
    .locator("header")
    .getByRole("combobox", { name: "화면 테마" });
  await expect(chart).toHaveAttribute(
    "aria-label",
    /사전 설정된.*모의 지수 차트.*실제 시세와 다릅니다/,
  );
  for (const mode of ["light", "dark"]) {
    await theme.selectOption(mode);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(chart).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          chart.evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return (
              bounds.width > 0 &&
              bounds.height >= 160 &&
              bounds.left >= 0 &&
              bounds.right <= innerWidth
            );
          }),
        )
        .toBe(true);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(chart).toBeVisible();
  expect(
    await chart.evaluate((node) =>
      (node.parentElement ?? node)
        .getAnimations({ subtree: true })
        .every((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return (
            !timing ||
            timing.duration === 0 ||
            animation.playState !== "running"
          );
        }),
    ),
  ).toBe(true);
  await expect(
    page.getByText("체험 포인트 · 현금 전환 불가", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/workroom-auth/chart-dark-member-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "워크룸 빠른 메뉴" })
    .getByRole("link", { name: "참여 내역" })
    .click();
  await expect(page).toHaveURL(/\/workroom\/history$/);
  await expect(
    page.getByRole("heading", { name: "참여 내역", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("member-mobile.png"),
    fullPage: true,
  });
});
