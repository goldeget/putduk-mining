import { test, expect, type Page } from "@playwright/test";
import { login, member } from "./helpers";

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

async function publicSurface(page: Page) {
  return page
    .locator("main")
    .first()
    .evaluate((node) => {
      for (
        let element: Element | null = node;
        element;
        element = element.parentElement
      ) {
        const color = getComputedStyle(element).backgroundColor;
        if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent")
          return color;
      }
      return "transparent";
    });
}

test("public account recovery, documents and terminal pages share responsive WORKROOM themes", async ({
  page,
}) => {
  const paths = [
    "/find-id",
    "/recover",
    "/terms",
    "/privacy",
    "/about",
    "/how-it-works",
    "/faq",
    "/auth/error",
    "/auth/forbidden",
    "/offline",
  ];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/find-id");
  await page.getByRole("combobox", { name: "화면 테마" }).selectOption("light");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(
        page.getByRole("link", { name: "WORKROOM 홈", exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "화면 테마" }),
      ).toHaveValue("light");
      if (width === 1440) {
        const light = await publicSurface(page);
        await page
          .getByRole("combobox", { name: "화면 테마" })
          .selectOption("dark");
        await expect.poll(() => publicSurface(page)).not.toBe(light);
        await page
          .getByRole("combobox", { name: "화면 테마" })
          .selectOption("light");
      }
      await fits(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/privacy");
  expect(await page.locator("body").innerText()).not.toContain(
    "입금, 출금, 채굴",
  );
  await page.screenshot({
    path: test.info().outputPath("privacy-workroom-light-desktop.png"),
  });
  await page.getByRole("combobox", { name: "화면 테마" }).selectOption("dark");
  for (const path of ["/privacy", "/find-id"]) {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(path);
    await fits(page);
  }
  await page.screenshot({
    path: test.info().outputPath("find-id-workroom-dark-mobile.png"),
  });
  const missing = await page.goto("/workroom-page-missing");
  // Next returns 200 after a loading boundary has streamed; the explicit
  // not-found state must still render rather than an unrelated success page.
  expect([200, 404]).toContain(missing?.status());
  await expect(page.locator('[data-ui-ready="not-found"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await fits(page);
});

test("real member account, support, notifications and AI menus fit mobile without retired mining chrome", async ({
  page,
}) => {
  await login(page, await member());
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/menu",
    "/menu/account",
    "/menu/support",
    "/menu/trust",
    "/menu/notifications",
    "/notifications",
    "/menu/ai",
    "/ai",
    "/support",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('img[src*="semiconductor-tower"]')).toHaveCount(
      0,
    );
    await fits(page);
  }
  await page.goto("/menu");
  await expect(
    page.getByRole("link", { name: "이벤트", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 844 });
  await fits(page);
  await page.screenshot({
    path: test.info().outputPath("member-menu-workroom-mobile.png"),
  });
});

test("actual pending state animates, respects reduced motion and clears after the real response", async ({
  page,
}) => {
  await login(page, await member());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/workroom/state", async (route) => {
    if (route.request().method() === "GET") await barrier;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    const loader = page.locator('[data-workroom-loading="page"]');
    await expect(loader).toBeVisible();
    const mark = loader.locator("[data-workroom-loading-mark]");
    await expect
      .poll(() =>
        mark.evaluate((node) =>
          node
            .getAnimations()
            .some((animation) => animation.playState === "running"),
        ),
      )
      .toBe(true);
    await fits(page);
    await page.screenshot({
      path: test.info().outputPath("member-live-pending-mobile.png"),
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() =>
        loader.evaluate((node) =>
          node
            .getAnimations({ subtree: true })
            .every((animation) => animation.playState !== "running"),
        ),
      )
      .toBe(true);
  } finally {
    release();
    await page.unroute("**/api/v1/workroom/state");
  }
  await expect(page.locator('[data-workroom-loading="page"]')).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: /나만의 워크룸을 개설하세요|모니터링 시작하기|이번 모의 참여/,
    }),
  ).toBeVisible();
});
