import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "menu-product");

const FORBIDDEN_COPY = [
  "휴대폰 인증",
  "SMS 인증",
  "USDT 잔액",
  "coming soon",
  "API",
  "RPC",
  "RLS",
  "schema",
];

function trackHydration(page: Page) {
  const hydration: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      text.includes("react.dev/link/hydration-mismatch") ||
      text.includes("hydration-mismatch") ||
      text.includes("Hydration failed because") ||
      text.includes("A tree hydrated but some attributes") ||
      /Text content did not match/i.test(text)
    ) {
      hydration.push(text.slice(0, 500));
    }
  });
  return hydration;
}

async function waitForHydratedControls(page: Page) {
  await page.waitForFunction(
    () => {
      const hydrated = (node: Element) =>
        Object.getOwnPropertyNames(node).some(
          (key) =>
            key.startsWith("__reactFiber") ||
            key.startsWith("__reactProps") ||
            key.startsWith("__reactContainer"),
        );
      const main = document.querySelector("main") ?? document.body;
      if (hydrated(main)) {
        return true;
      }
      return Array.from(main.querySelectorAll("*")).some(hydrated);
    },
    undefined,
    { timeout: 60_000 },
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function shoot(page: Page, fileName: string) {
  await waitForHydratedControls(page);
  const projectOutput = path.join(OUTPUT_DIR, test.info().project.name);
  mkdirSync(projectOutput, { recursive: true });
  await page.screenshot({
    animations: "disabled",
    caret: "initial",
    fullPage: true,
    path: path.join(projectOutput, fileName),
  });
}

async function applyTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.evaluate((selected) => {
    localStorage.setItem("putduk-theme", selected);
    document.documentElement.dataset.theme = selected;
    document.documentElement.style.colorScheme = selected;
  }, theme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectKoreanSafe(page: Page) {
  const mainText = await page.locator("main").innerText();
  for (const forbidden of FORBIDDEN_COPY) {
    expect(mainText).not.toContain(forbidden);
  }
}

test("unsigned visitors keep menu return paths", async ({ page }) => {
  const hydration = trackHydration(page);

  await page.goto("/menu");
  await expect(page).toHaveURL(/\/login\?next=%2Fmenu$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/menu");
  await expect(
    page.getByRole("heading", { name: "내 퍼뜩", level: 1 }),
  ).toHaveCount(0);

  await page.goto("/menu/account");
  await expect(page).toHaveURL(/\/login\?next=%2Fmenu%2Faccount$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/menu/account");

  await page.goto("/menu/notifications");
  await expect(page).toHaveURL(/\/login\?next=%2Fmenu%2Fnotifications$/);
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/menu/notifications",
  );

  expect(hydration).toEqual([]);
});

test("menu hub, account, and settings cover states and navigation", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("menu-hub");
  await loginAsMember(page, member, "/menu");
  await dismissGuidedQuestIfPresent(page);

  await expect(
    page.getByRole("heading", { name: "내 퍼뜩", level: 1 }),
  ).toBeVisible();
  await expectKoreanSafe(page);

  const menuNav = page.getByRole("navigation", { name: "내 퍼뜩 메뉴" });
  const primaryNavigation = page.locator("nav.product-navigation:visible");
  await expect(primaryNavigation).toHaveCount(1);
  await expect(primaryNavigation.getByRole("link")).toHaveText([
    "홈",
    "채굴",
    "상품",
    "지갑",
    "더보기",
  ]);
  const eventsLink = menuNav.getByRole("link", { name: /^이벤트\s/ });
  await expect(eventsLink).toBeVisible();
  await expect(eventsLink).toHaveAttribute("href", "/events");
  const headerNotificationLink = page
    .locator("header.product-header")
    .getByRole("link", { name: "알림 센터", exact: true });
  const menuNotificationLink = menuNav.locator('a[href="/notifications"]');
  await expect(menuNav.getByRole("link", { name: /계정 관리/ })).toBeVisible();
  await expect(headerNotificationLink).toBeVisible();
  await expect(menuNotificationLink).toHaveAccessibleName(/알림 센터/);
  await expect(menuNav.getByRole("link", { name: /알림 설정/ })).toBeVisible();
  await expect(menuNav.getByRole("link", { name: /퍼뜩 AI/ })).toBeVisible();

  await menuNav.getByRole("link", { name: /계정 관리/ }).click();
  await expect(page).toHaveURL(/\/menu\/account$/);
  await expect(
    page.getByRole("heading", { name: "내 계정", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "계정 정보" })).toBeVisible();
  await expect(page.getByText("로그인 아이디")).toBeVisible();
  await expect(page.getByText("복구 이메일")).toBeVisible();
  await expectKoreanSafe(page);

  const localLogout = page.getByRole("form", { name: "이 기기 로그아웃" });
  const globalLogout = page.getByRole("form", {
    name: "모든 기기 로그아웃",
  });
  await expect(
    localLogout.getByRole("button", { name: "이 기기에서 로그아웃" }),
  ).toBeVisible();
  await expect(
    globalLogout.getByRole("button", { name: "모든 기기에서 로그아웃" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "내 퍼뜩으로" }).click();
  await expect(page).toHaveURL(/\/menu$/);

  await menuNav.getByRole("link", { name: /알림 설정/ }).click();
  await expect(page).toHaveURL(/\/menu\/notifications$/);
  await expect(
    page.getByRole("heading", {
      name: "필요한 순간에만, 명확한 알림.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "설정 저장" })).toBeVisible();
  await expectKoreanSafe(page);

  // 헤더와 메뉴 카드가 같은 이름을 쓰므로 설정 화면에서는 헤더 href로 이동한다.
  await headerNotificationLink.click();
  await expect(page).toHaveURL(/\/notifications$/);

  expect(hydration).toEqual([]);
});

test("menu account keyboard focus, themes, and viewports", async ({ page }) => {
  test.setTimeout(480_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("menu-a11y");
  await loginAsMember(page, member, "/menu/account");
  await dismissGuidedQuestIfPresent(page);

  await expect(
    page.getByRole("heading", { name: "내 계정", level: 1 }),
  ).toBeVisible();

  const localButton = page.getByRole("button", {
    name: "이 기기에서 로그아웃",
  });
  const globalButton = page.getByRole("button", {
    name: "모든 기기에서 로그아웃",
  });

  await localButton.focus();
  await expect(localButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(globalButton).toBeFocused();

  for (const theme of ["light", "dark"] as const) {
    await applyTheme(page, theme);
    await expect(
      page.getByRole("heading", { name: "내 계정", level: 1 }),
    ).toBeVisible();
    await shoot(page, `account-${theme}-1440.png`);
  }

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/menu");
    await dismissGuidedQuestIfPresent(page);
    await expect(
      page.getByRole("heading", { name: "내 퍼뜩", level: 1 }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shoot(page, `menu-hub-${viewport.name}.png`);

    await page.goto("/menu/account");
    await expect(
      page.getByRole("heading", { name: "내 계정", level: 1 }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shoot(page, `menu-account-${viewport.name}.png`);

    await page.goto("/menu/notifications");
    await expect(
      page.getByRole("heading", {
        name: "필요한 순간에만, 명확한 알림.",
        level: 1,
      }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shoot(page, `menu-settings-${viewport.name}.png`);
  }

  // 의도적 장애 주입(네트워크 차단·쿼리 강제 실패)은 안전 범위 밖으로 OPEN.
  expect(hydration).toEqual([]);
});

test("logout failure query shows recovery without ending the session", async ({
  page,
}) => {
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("menu-logout-fail");
  await loginAsMember(page, member, "/menu/account?logout=failed");
  await dismissGuidedQuestIfPresent(page);

  await expect(
    page.getByRole("heading", { name: "로그아웃을 완료하지 못했어요" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "다시 시도" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "이 기기에서 로그아웃" }),
  ).toBeVisible();
  await expect(page.getByText("회원", { exact: true }).first()).toBeVisible();
  expect(hydration).toEqual([]);
});
