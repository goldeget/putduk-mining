import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";
import {
  seedExpiredNotification,
  seedMemberNotification,
  seedUnsafeRouteNotification,
} from "./helpers/notification-fixtures";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "notifications-product");

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
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    animations: "disabled",
    caret: "initial",
    fullPage: true,
    path: path.join(OUTPUT_DIR, fileName),
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

test("unsigned visitors keep the notifications return path", async ({
  page,
}) => {
  const hydration = trackHydration(page);
  await page.goto("/notifications");
  await expect(page).toHaveURL(/\/login\?next=%2Fnotifications$/);
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/notifications",
  );
  await expect(
    page.getByRole("heading", { name: "중요한 변화를 놓치지 않도록." }),
  ).toHaveCount(0);
  expect(hydration).toEqual([]);
});

test("shows empty state, preferences, themes, and keyboard path", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("notif-empty");
  await loginAsMember(page, member, "/notifications");
  await dismissGuidedQuestIfPresent(page);

  await expect(
    page.getByRole("heading", {
      name: "중요한 변화를 놓치지 않도록.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByText("아직 도착한 알림이 없어요")).toBeVisible();
  await expect(page.getByText("NOTIFICATION CENTER")).toHaveCount(0);
  await expect(page.getByText("PWA PUSH")).toHaveCount(0);

  const settingsLink = page.getByRole("link", { name: "알림 설정" });
  await expect(settingsLink).toBeVisible();
  await settingsLink.focus();
  await expect(settingsLink).toBeFocused();
  await settingsLink.click();
  await expect(page).toHaveURL(/\/menu\/notifications$/);
  await expect(
    page.getByRole("heading", {
      name: "필요한 순간에만, 명확한 알림.",
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("채굴과 정산")).toBeVisible();
  await expect(page.getByLabel("혜택과 소식")).toBeVisible();

  await page.getByLabel("혜택과 소식").check();
  await page.getByRole("button", { name: "설정 저장" }).click();
  await expect(page.getByText("알림 설정을 저장했습니다.")).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await applyTheme(page, "dark");
    await expectNoHorizontalOverflow(page);
    await shoot(page, `preferences-${viewport.name}-dark.webp`);
    await applyTheme(page, "light");
    await expectNoHorizontalOverflow(page);
    await shoot(page, `preferences-${viewport.name}-light.webp`);
  }

  await page.goto("/notifications");
  await dismissGuidedQuestIfPresent(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await applyTheme(page, "dark");
    await expect(page.getByText("아직 도착한 알림이 없어요")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shoot(page, `empty-${viewport.name}-dark.webp`);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUTPUT_DIR, "hydration.json"),
    JSON.stringify({ count: hydration.length, samples: hydration }, null, 2),
  );
  expect(hydration).toEqual([]);
});

test("lists own notifications, marks read, hides expired and unsafe links", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const hydration = trackHydration(page);
  const owner = await createConfirmedMember("notif-owner");
  const other = await createConfirmedMember("notif-other");

  const unread = seedMemberNotification({
    body: "읽지 않은 본인 알림입니다.",
    category: "wallet",
    route: "/wallet/deposit",
    title: "입금 안내",
    userId: owner.userId,
  });
  const readCreatedAt = new Date().toISOString();
  const read = seedMemberNotification({
    body: "이미 읽은 본인 알림입니다.",
    category: "mining",
    createdAt: readCreatedAt,
    readAt: readCreatedAt,
    route: "/mining",
    title: "채굴 안내",
    userId: owner.userId,
  });
  const foreign = seedMemberNotification({
    body: "다른 회원에게만 보여야 합니다.",
    category: "service",
    title: "타인 전용 알림",
    userId: other.userId,
  });
  const expired = seedExpiredNotification(owner.userId);
  const unsafe = seedUnsafeRouteNotification(owner.userId);

  await loginAsMember(page, owner, "/notifications");
  await dismissGuidedQuestIfPresent(page);

  await expect(page.getByRole("heading", { name: /새 소식/ })).toBeVisible();
  await expect(page.getByText(unread.title)).toBeVisible();
  await expect(page.getByText(read.title)).toBeVisible();
  await expect(page.getByText(foreign.title)).toHaveCount(0);
  await expect(page.getByText(expired.title)).toHaveCount(0);
  await expect(page.getByText(unsafe.title)).toBeVisible();
  await expect(page.getByRole("link", { name: /^로그인$/ })).toHaveCount(0);

  const unreadCard = page.locator(
    `article[data-notification-id="${unread.id}"]`,
  );
  await expect(unreadCard).toHaveAttribute("data-read", "false");
  await expect(
    unreadCard.getByRole("link", { name: /내용 확인/ }),
  ).toHaveAttribute("href", "/wallet/deposit");

  const unsafeCard = page.locator(
    `article[data-notification-id="${unsafe.id}"]`,
  );
  await expect(unsafeCard.getByRole("link", { name: /내용 확인/ })).toHaveCount(
    0,
  );

  const markRead = unreadCard.getByRole("button", { name: /읽음 처리/ });
  await markRead.focus();
  await expect(markRead).toBeFocused();
  const readResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/notifications/${unread.id}/read`) &&
      response.request().method() === "POST",
  );
  await markRead.click();
  const response = await readResponse;
  expect(response.ok()).toBe(true);
  await expect(
    page.locator(`article[data-notification-id="${unread.id}"]`),
  ).toHaveAttribute("data-read", "true");

  const foreignRead = await page.request.post(
    `/api/v1/notifications/${foreign.id}/read`,
  );
  expect(foreignRead.status()).toBe(404);

  const expiredRead = await page.request.post(
    `/api/v1/notifications/${expired.id}/read`,
  );
  expect(expiredRead.status()).toBe(410);

  const invalidRead = await page.request.post(
    "/api/v1/notifications/not-a-uuid/read",
  );
  expect(invalidRead.status()).toBe(400);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await applyTheme(page, "light");
    await expectNoHorizontalOverflow(page);
    await shoot(page, `inbox-${viewport.name}-light.webp`);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUTPUT_DIR, "hydration-inbox.json"),
    JSON.stringify({ count: hydration.length, samples: hydration }, null, 2),
  );
  expect(hydration).toEqual([]);
});
