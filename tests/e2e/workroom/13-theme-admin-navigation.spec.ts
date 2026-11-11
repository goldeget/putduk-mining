import { test, expect, type Page } from "@playwright/test";
import { ADMIN_MENU_ITEMS } from "../../../apps/admin/components/admin-menu";
import { adminLogin, adminOrigin, login, member, service } from "./helpers";

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

async function surface(page: Page) {
  return page.locator("main").evaluate((node) => {
    for (
      let current: Element | null = node;
      current;
      current = current.parentElement
    ) {
      const color = getComputedStyle(current).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") return color;
    }
    return "transparent";
  });
}

test("member system light dark preference renders and persists across responsive cash screens", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await login(page, await member());
  const theme = page
    .locator("header")
    .getByRole("combobox", { name: "화면 테마" });
  await theme.selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await theme.selectOption("dark");
  await page.goto("/workroom/cash");
  const dark = await surface(page);
  await theme.selectOption("light");
  await expect.poll(() => surface(page)).not.toBe(dark);
  await page.reload();
  await expect(theme).toHaveValue("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(theme).toBeVisible();
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("member-cash-light-mobile.png"),
  });
  await theme.selectOption("dark");
  await noOverflow(page);
  await page.screenshot({
    path: test.info().outputPath("member-cash-dark-mobile.png"),
  });
});

test("verified administrator reaches every active menu and uses responsive themed navigation", async ({
  page,
}) => {
  const user = await member();
  const granted = await service()
    .from("user_roles")
    .insert({
      user_id: user.userId,
      role: "SUPER_ADMIN",
      granted_by: user.userId,
    });
  expect(granted.error).toBeNull();
  await adminLogin(page, user);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const navigation = page.getByRole("navigation", { name: "운영자 주 메뉴" });
  await expect(navigation.getByRole("link")).toHaveCount(13);
  for (const item of ADMIN_MENU_ITEMS) {
    const response = await page.goto(`${adminOrigin}${item.href}`);
    expect(response?.status(), item.href).toBe(200);
    await expect(page).toHaveURL(`${adminOrigin}${item.href}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(
      navigation.getByRole("link", { name: item.label, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await noOverflow(page);
  }
  await page.goto(`${adminOrigin}/workroom?tab=invites`);
  const theme = page.getByRole("combobox", { name: "화면 테마" });
  await theme.selectOption("dark");
  const dark = await surface(page);
  await theme.selectOption("light");
  await expect.poll(() => surface(page)).not.toBe(dark);
  await page.screenshot({
    path: test.info().outputPath("admin-invites-light-desktop.png"),
  });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
  }
  const toggle = page.getByRole("button", { name: /운영 메뉴/ });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await navigation
    .getByRole("link", { name: "원화 입금 관리", exact: true })
    .click();
  await expect(page).toHaveURL(`${adminOrigin}/deposits/krw`);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await theme.selectOption("dark");
  await noOverflow(page);
  await page.screenshot({
    path: test.info().outputPath("admin-queue-dark-mobile.png"),
  });
});
