import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";
import {
  seedMiningReadSession,
  setMiningWorldsActive,
} from "./helpers/mining-fixtures";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "mining-product");

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

test("unsigned visitors keep the mining return path", async ({ page }) => {
  const hydration = trackHydration(page);
  await page.goto("/mining");
  await expect(page).toHaveURL(/\/login\?next=%2Fmining$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/mining");
  await expect(page.getByRole("heading", { name: "채굴 월드" })).toHaveCount(0);
  expect(hydration).toEqual([]);
});

test("shows the empty session, world directory, themes, and keyboard path", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("mining-empty");
  await loginAsMember(page, member, "/mining");
  await expect(
    page.getByRole("heading", { name: "채굴 월드", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("시작 전")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "첫 월드에서 채굴을 시작해 보세요" }),
  ).toBeVisible();
  await expect(page.getByText("채굴 중")).toHaveCount(0);

  const mainText = await page.locator("main").innerText();
  expect(mainText).toContain("앱을 닫아도 채굴은 계속돼요.");
  expect(mainText).toContain(
    "월드는 채굴 테마예요. 시세나 투자 수익을 따르지 않습니다.",
  );
  expect(mainText).not.toContain("가상 채굴");
  expect(mainText).not.toMatch(/수익 보장|확정 수익|무조건 지급|무위험/);

  for (const name of ["코리아", "미국", "골드", "실버", "크립토"]) {
    await expect(page.getByRole("heading", { name, level: 3 })).toBeVisible();
  }
  await expect(
    page.getByText("퍼뜩의 첫 여정이 시작되는 기본 채굴 월드"),
  ).toBeVisible();

  const startLink = page.getByRole("link", { name: "PUTDUK START 확인" });
  await expect(startLink).toHaveAttribute("href", "/start");
  for (let step = 0; step < 40; step += 1) {
    if (await startLink.evaluate((node) => node === document.activeElement)) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(startLink).toBeFocused();
  const focusShadow = await startLink.evaluate(
    (node) => getComputedStyle(node).boxShadow,
  );
  expect(focusShadow).not.toBe("none");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/start$/);
  await dismissGuidedQuestIfPresent(page);
  const startHeading = page.getByRole("heading", {
    name: "첫 채굴, 분명한 시작.",
  });
  if (!(await startHeading.isVisible())) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissGuidedQuestIfPresent(page);
  }
  await expect(startHeading).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/start$/);

  await page.goto("/mining");
  await expect(page.getByText("시작 전")).toBeVisible();

  for (const viewport of VIEWPORTS) {
    for (const theme of ["dark", "light"] as const) {
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });
      await applyTheme(page, theme);
      await expect(page.getByText("시작 전")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (viewport.width < 980) {
        const navigation = page.locator(
          ".product-workspace > .product-navigation",
        );
        await expect(navigation).toBeVisible();
        await expect(
          navigation.getByRole("link", { name: "채굴" }),
        ).toHaveAttribute("aria-current", "page");
        const launcher = page.locator("#putduk-support-launcher");
        await expect(launcher).toBeVisible();
        const launcherBox = await launcher.boundingBox();
        const navigationBox = await navigation.boundingBox();
        expect(launcherBox).not.toBeNull();
        expect(navigationBox).not.toBeNull();
        if (launcherBox && navigationBox) {
          const overlaps = !(
            launcherBox.y + launcherBox.height <= navigationBox.y ||
            navigationBox.y + navigationBox.height <= launcherBox.y ||
            launcherBox.x + launcherBox.width <= navigationBox.x ||
            navigationBox.x + navigationBox.width <= launcherBox.x
          );
          expect(overlaps).toBe(false);
        }
      }
      await shoot(page, `no-session-${viewport.name}-${theme}.png`);
    }
  }

  await page.setViewportSize({ height: 844, width: 390 });
  await page.getByLabel("화면 테마").selectOption("system");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
    )
    .toBe("rgb(248, 244, 234)");
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
    )
    .toBe("rgb(7, 7, 6)");

  const infiniteInMain = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) {
      return ["missing-main"];
    }
    return main.getAnimations({ subtree: true }).flatMap((animation) => {
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect)) {
        return [];
      }
      const iterations = effect.getTiming().iterations;
      if (iterations === Infinity && animation.playState === "running") {
        return [
          effect.target instanceof Element ? effect.target.tagName : "unknown",
        ];
      }
      return [];
    });
  });
  expect(infiniteInMain).toEqual([]);

  const sample = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    const images = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("orbital-earth"))
      .map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        return {
          encodedBodySize: resource.encodedBodySize,
          name: resource.name,
          transferSize: resource.transferSize,
        };
      });
    return {
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      images,
      loadEventMs: navigation?.loadEventEnd ?? null,
      mode: "next-dev-or-start",
      transferSize: navigation?.transferSize ?? null,
    };
  });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUTPUT_DIR, "route-timing.json"),
    `${JSON.stringify(sample, null, 2)}\n`,
  );
  expect(hydration).toEqual([]);
});

test("renders an active session and a maintenance session from the server snapshot", async ({
  page,
}) => {
  test.setTimeout(480_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("mining-active");
  const startedRecently = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const startedEarlier = new Date(
    Date.now() - 3 * 60 * 60 * 1000,
  ).toISOString();
  const settledRecently = new Date(Date.now() - 15 * 1000).toISOString();
  await seedMiningReadSession({
    activeEquipment: 2,
    code: "KOREA",
    lastSettledAt: settledRecently,
    startedAt: startedRecently,
    status: "NORMAL",
    userId: member.userId,
  });
  await seedMiningReadSession({
    activeEquipment: 0,
    code: "USA",
    lastSettledAt: settledRecently,
    startedAt: startedEarlier,
    status: "MAINTENANCE",
    userId: member.userId,
  });

  await loginAsMember(page, member, "/mining");
  await expect(
    page.getByRole("heading", { name: "코리아에서 채굴이 이어지고 있어요" }),
  ).toBeVisible();
  await expect(page.getByText("채굴 중").first()).toBeVisible();
  await expect(page.getByText("점검 중").first()).toBeVisible();
  await expect(page.getByText("1분 미만").first()).toBeVisible();
  await expect(page.getByText("2개").first()).toBeVisible();
  await expect(page.getByText("0개").first()).toBeVisible();
  await expect(
    page.getByText("현재 활성 세션이 이어지고 있어요.").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "PUTDUK START 확인" }),
  ).toHaveCount(0);
  await expect(page.getByText("가상 채굴")).toHaveCount(0);

  const seoulClock = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(settledRecently));
  await expect(page.getByText(seoulClock).first()).toBeVisible();

  const homeLink = page
    .locator(
      ".product-workspace > .product-navigation, .product-sidebar .product-navigation",
    )
    .getByRole("link", { name: "홈" })
    .first();
  await homeLink.focus();
  await expect(homeLink).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/home$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/mining$/);
  await expect(page.getByText("점검 중").first()).toBeVisible();

  for (const viewport of VIEWPORTS) {
    for (const theme of ["dark", "light"] as const) {
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });
      await applyTheme(page, theme);
      await expect(page.getByText("점검 중").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shoot(page, `active-${viewport.name}-${theme}.png`);
    }
  }
  expect(hydration).toEqual([]);
});

test("shows an empty world directory and restores the shared worlds", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("mining-worlds-empty");
  try {
    await setMiningWorldsActive(false);
    await loginAsMember(page, member, "/mining");
    await expect(page.getByText("표시할 월드가 아직 없어요")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "코리아", level: 3 }),
    ).toHaveCount(0);
    await expect(page.getByText("시작 전")).toBeVisible();
    await page.setViewportSize({ height: 844, width: 390 });
    await applyTheme(page, "dark");
    await expectNoHorizontalOverflow(page);
    await shoot(page, "worlds-empty-390-dark.png");
  } finally {
    await setMiningWorldsActive(true);
  }

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "코리아", level: 3 }),
  ).toBeVisible();
  expect(hydration).toEqual([]);
});
