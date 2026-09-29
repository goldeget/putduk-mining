import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  cleanupE2eEventsFixtures,
  countPublishedMemberEvents,
  countPublishedMemberNotices,
  seedMemberEventsReadModel,
} from "./helpers/events-fixtures";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "events-product");

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

test("unsigned visitors keep the events return path", async ({ page }) => {
  const hydration = trackHydration(page);
  await page.goto("/events");
  await expect(page).toHaveURL(/\/login\?next=%2Fevents$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/events");
  await expect(
    page.getByRole("heading", { name: "참여할 수 있는 여정" }),
  ).toHaveCount(0);
  expect(hydration).toEqual([]);
});

test("unsigned visitors keep an events detail return path", async ({
  page,
}) => {
  await page.goto("/events/local-live-check");
  await expect(page).toHaveURL(
    /\/login\?next=%2Fevents%2Flocal-live-check$/,
  );
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/events/local-live-check",
  );
});

test("shows empty events and notices without invented content", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const hydration = trackHydration(page);
  cleanupE2eEventsFixtures();
  const publishedEvents = countPublishedMemberEvents();
  const publishedNotices = countPublishedMemberNotices();
  const member = await createConfirmedMember("events-empty");
  await loginAsMember(page, member, "/events");
  await dismissGuidedQuestIfPresent(page);

  await expect(
    page.getByRole("heading", { name: "참여할 수 있는 여정", level: 1 }),
  ).toBeVisible();

  const mainText = await page.locator("main").innerText();
  expect(mainText).toContain("퍼뜩");
  expect(mainText).not.toMatch(/수익 보장|확정 수익|무조건 지급|무위험/);
  expect(mainText).not.toContain("휴대폰 인증");
  expect(mainText).not.toContain("USDT 잔액");
  expect(mainText).not.toContain("로컬 진행 이벤트");
  expect(mainText).not.toContain("로컬 초안 이벤트");

  const canProveGlobalEmpty =
    publishedEvents === 0 && publishedNotices === 0;
  if (canProveGlobalEmpty) {
    await expect(
      page.getByRole("heading", { name: "현재 공개된 이벤트가 없어요" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "새로운 공지가 없어요" }),
    ).toBeVisible();
  } else {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(
      path.join(OUTPUT_DIR, "empty-state-open.json"),
      JSON.stringify(
        {
          status: "OPEN",
          reason:
            "Non-e2e published events/notices already exist in local DB; global empty panels are not asserted.",
          publishedEvents,
          publishedNotices,
        },
        null,
        2,
      ),
    );
  }

  for (const viewport of VIEWPORTS) {
    for (const theme of ["dark", "light"] as const) {
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });
      await applyTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "참여할 수 있는 여정", level: 1 }),
      ).toBeVisible();
      if (canProveGlobalEmpty) {
        await expect(
          page.getByRole("heading", { name: "현재 공개된 이벤트가 없어요" }),
        ).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);
      await shoot(
        page,
        `${canProveGlobalEmpty ? "empty" : "baseline"}-${viewport.name}-${theme}.png`,
      );
    }
  }

  await page.setViewportSize({ height: 844, width: 390 });
  await page.getByLabel("화면 테마").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await expectNoHorizontalOverflow(page);
  await shoot(
    page,
    `${canProveGlobalEmpty ? "empty" : "baseline"}-390-system.png`,
  );

  writeFileSync(
    path.join(OUTPUT_DIR, "hydration-empty.json"),
    JSON.stringify({ count: hydration.length, samples: hydration }, null, 2),
  );
  expect(hydration).toEqual([]);
});

test("shows LIVE SCHEDULED ENDED notices isolation and detail", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const hydration = trackHydration(page);
  const viewer = await createConfirmedMember("events-viewer");
  const other = await createConfirmedMember("events-other");
  cleanupE2eEventsFixtures();
  const seeded = await seedMemberEventsReadModel({
    otherUserId: other.userId,
    viewerUserId: viewer.userId,
  });

  await loginAsMember(page, viewer, "/events");
  await dismissGuidedQuestIfPresent(page);

  const startedAt = Date.now();
  await expect(
    page.getByRole("heading", { name: "로컬 진행 이벤트" }),
  ).toBeVisible();
  await expect(page.getByText("진행 중").first()).toBeVisible();
  await expect(page.getByText("참여 중").first()).toBeVisible();
  await expect(page.getByText("로컬 예정 이벤트")).toBeVisible();
  await expect(page.getByText("예정").first()).toBeVisible();
  await expect(page.getByText("로컬 종료 이벤트")).toBeVisible();
  await expect(page.getByText("종료").first()).toBeVisible();
  await expect(page.getByText("조건 달성")).toBeVisible();

  const mainText = await page.locator("main").innerText();
  expect(mainText).not.toContain("로컬 초안 이벤트");
  expect(mainText).not.toContain("공개되면 안 되는 초안");
  expect(mainText).toContain(seeded.pinnedNoticeTitle);
  expect(mainText).toContain("중요 ·");
  expect(mainText).not.toContain("만료된 공지");
  expect(mainText).not.toContain("미공개 공지");
  // 다른 회원의 REWARDED 상태는 노출되면 안 된다.
  expect(mainText).not.toContain("보상 반영 완료");

  const detailLink = page.getByRole("link", { name: "자세히 보기" });
  await expect(detailLink).toBeVisible();
  for (let step = 0; step < 50; step += 1) {
    if (await detailLink.evaluate((node) => node === document.activeElement)) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(detailLink).toBeFocused();
  const focusShadow = await detailLink.evaluate(
    (node) => getComputedStyle(node).boxShadow,
  );
  expect(focusShadow).not.toBe("none");
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`/events/${seeded.liveSlug}$`));
  await expect(
    page.getByRole("heading", { name: "로컬 진행 이벤트" }),
  ).toBeVisible();
  await expect(page.getByText("참여 중").first()).toBeVisible();
  await expect(page.getByText("다른 회원의 참여 기록은 보이지 않습니다.")).toBeVisible();
  await expect(page.getByText("보상 반영 완료")).toHaveCount(0);
  await shoot(page, "detail-live-390-dark.png");

  await page.goto(`/events/${seeded.draftSlug}`);
  await expect(
    page.getByRole("heading", { name: "공개된 이벤트를 찾을 수 없어요" }),
  ).toBeVisible();

  await page.goto("/events");
  for (const viewport of VIEWPORTS) {
    for (const theme of ["dark", "light"] as const) {
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });
      await applyTheme(page, theme);
      await expect(page.getByText("로컬 진행 이벤트")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (viewport.width < 980) {
        const navigation = page.locator(
          ".product-workspace > .product-navigation",
        );
        await expect(navigation).toBeVisible();
        await expect(
          navigation.getByRole("link", { name: "이벤트" }),
        ).toHaveAttribute("aria-current", "page");
      }
      await shoot(page, `seeded-${viewport.name}-${theme}.png`);
    }
  }

  const loadMs = Date.now() - startedAt;
  writeFileSync(
    path.join(OUTPUT_DIR, "performance-seeded.json"),
    JSON.stringify(
      {
        interactionWindowMs: loadMs,
        note: "Bounded local interaction window only; not production percentile evidence.",
        route: "/events",
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(OUTPUT_DIR, "hydration-seeded.json"),
    JSON.stringify({ count: hydration.length, samples: hydration }, null, 2),
  );
  expect(hydration).toEqual([]);
  expect(loadMs).toBeLessThan(240_000);
});
