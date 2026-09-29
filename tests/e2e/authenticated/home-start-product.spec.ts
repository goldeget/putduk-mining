import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
  startTrialFromUi,
} from "./helpers/member-session";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "home-start-product");

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

test("비로그인 방문자는 홈·START 복귀 경로를 유지한다", async ({ page }) => {
  const hydration = trackHydration(page);
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login\?next=%2Fhome$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/home");

  await page.goto("/start");
  await expect(page).toHaveURL(/\/login\?next=%2Fstart$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/start");
  expect(hydration).toEqual([]);
});

test("홈과 START READY 상태를 도메인 스냅샷으로 보여 준다", async ({
  page,
}) => {
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("home-start-ready");
  await loginAsMember(page, member, "/home");

  await expect(
    page.getByRole("heading", { name: "오늘도 채굴이 이어지고 있어요." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /첫 채굴 시작/ }).first()).toBeVisible();
  await expect(page.getByText("사용 가능 KRW")).toBeVisible();
  await expect(page.getByText("체험 값은 포함되지 않습니다.")).toBeVisible();
  await expect(page.getByText("새 알림이 없어요", { exact: false })).toBeVisible();

  await page.goto("/start");
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "첫 채굴, 분명한 시작." }),
  ).toBeVisible();
  await expect(page.getByText("체험과 실제 잔액")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "첫 채굴 시작" }),
  ).toBeVisible();
  await expect(page.getByText("환영 보상 첫 출금에 입금은 필요 없어요")).toBeVisible();

  await page.keyboard.press("Tab");
  await expectNoHorizontalOverflow(page);
  expect(hydration).toEqual([]);
});

test("START ACTIVE 상태는 서버 동기화 안내와 진행 문구를 유지한다", async ({
  page,
}) => {
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("home-start-active");
  await loginAsMember(page, member, "/start");
  await startTrialFromUi(page);

  await expect(page.getByText("채굴이 진행 중이에요")).toBeVisible();
  await expect(
    page.getByText("앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요."),
  ).toBeVisible();
  await expect(page.getByText("진행 중").first()).toBeVisible();

  await page.goto("/home");
  await expect(page.getByText("PUTDUK START 진행 중")).toBeVisible();
  await expect(page.getByRole("link", { name: /START 계속하기/ })).toBeVisible();
  expect(hydration).toEqual([]);
});

test("홈·START 오류 복구와 키보드·축소 모션을 확인한다", async ({ page }) => {
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("home-start-recovery");
  await loginAsMember(page, member, "/home");

  await page.route("**/rest/v1/trial_account_snapshots*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "forced-read-failure" }),
    }),
  );
  await page.route("**/rest/v1/mining_active_session_snapshots*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "forced-read-failure" }),
    }),
  );

  await page.goto("/home");
  await expect(page.getByText("일부 정보를 불러오지 못했어요")).toBeVisible();
  await expect(page.getByRole("button", { name: /다시 확인/ }).first()).toBeVisible();

  await page.unroute("**/rest/v1/trial_account_snapshots*");
  await page.unroute("**/rest/v1/mining_active_session_snapshots*");
  await page.getByRole("button", { name: /다시 확인/ }).first().click();
  await expect(
    page.getByRole("heading", { name: "오늘도 채굴이 이어지고 있어요." }),
  ).toBeVisible({ timeout: 30_000 });

  await applyTheme(page, "dark");
  await page.goto("/start");
  await dismissGuidedQuestIfPresent(page);

  // Tab으로 주요 컨트롤에 포커스가 이동할 수 있는지 확인한다.
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    if (await focused.count()) {
      break;
    }
  }
  await expect(page.locator(":focus")).toHaveCount(1);

  await expectNoHorizontalOverflow(page);
  expect(hydration).toEqual([]);
});

test("홈·START 반응형·테마 스크린샷을 남긴다", async ({ page }) => {
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("home-start-visual");
  await loginAsMember(page, member, "/home");
  const notes: string[] = [];

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const theme of ["light", "dark"] as const) {
      await applyTheme(page, theme);
      await page.goto("/home");
      await shoot(
        page,
        `home-ready-${viewport.name}-${theme}.png`,
      );
      await expectNoHorizontalOverflow(page);

      await page.goto("/start");
      await dismissGuidedQuestIfPresent(page);
      await shoot(
        page,
        `start-ready-${viewport.name}-${theme}.png`,
      );
      await expectNoHorizontalOverflow(page);
      notes.push(
        `captured home+start ready ${viewport.name} ${theme}; Visual Lab composition only`,
      );
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUTPUT_DIR, "review-notes.txt"),
    [
      "Visual Lab 비교는 구성·품질만. 카피·경제 수치는 벤치마크가 아니다.",
      "Canonical art: docs/design/visual-references, docs/design/visual-lab.",
      "PRODUCT COMPLETE / LAUNCH READY 선언 없음.",
      "Unsafe fault injection: OPEN",
      ...notes,
    ].join("\n"),
    "utf8",
  );
  expect(hydration).toEqual([]);
});
