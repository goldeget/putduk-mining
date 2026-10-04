import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { E2E_FORCE_REST_FAILURE_COOKIE } from "@/lib/supabase/server-fetch";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
  startTrialFromUi,
} from "./helpers/member-session";
import { seedMemberNotification } from "./helpers/notification-fixtures";
import { expectSettledRoute } from "./helpers/settled-route";

const HOME_READ_FAULT_TABLES =
  "trial_account_snapshots,mining_active_session_snapshots";

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
    page.getByRole("heading", { name: "오늘의 채굴 상태를 확인해요." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /첫 채굴 시작/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("사용 가능 KRW")).toBeVisible();
  await expect(page.getByText("체험 값은 포함되지 않습니다.")).toBeVisible();
  await expect(
    page.getByText("새 알림이 없어요", { exact: false }),
  ).toBeVisible();

  await page.goto("/start");
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "첫 채굴, 분명한 시작." }),
  ).toBeVisible();
  await expect(page.getByText("체험과 실제 잔액")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "첫 채굴 시작" }),
  ).toBeVisible();
  await expect(
    page.getByText("환영 보상 첫 출금에 입금은 필요 없어요"),
  ).toBeVisible();

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

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "채굴이 진행 중이에요",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "앱을 닫아도 채굴은 계속돼요. 다시 접속하면 결과를 확인할 수 있어요.",
    ),
  ).toBeVisible();
  await expect(page.getByText("진행 중").first()).toBeVisible();

  await page.goto("/home");
  // hidden id="S:*"가 같은 진행 문구를 복제한다. 정착된 홈 안에서만 하나여야 한다.
  const home = await expectSettledRoute(page, "/home");
  const activeStatus = home.getByText("PUTDUK START 진행 중");
  await expect(activeStatus).toHaveCount(1);
  await expect(activeStatus).toBeVisible();
  await expect(
    page.getByRole("link", { name: /START 계속하기/ }),
  ).toBeVisible();
  expect(hydration).toEqual([]);
});

test("홈·START 오류 복구와 키보드·축소 모션을 확인한다", async ({ page }) => {
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("home-start-recovery");
  await loginAsMember(page, member, "/home");

  // 홈은 서버 컴포넌트가 identity.supabase로 읽는다. 브라우저 page.route는 먹지 않는다.
  // APP_ENV=test에서만 동작하는 SSR fetch 고장 쿠키로 기존 부분 실패 UI를 증명한다.
  await page.context().addCookies([
    {
      name: E2E_FORCE_REST_FAILURE_COOKIE,
      value: HOME_READ_FAULT_TABLES,
      url: `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "3000"}`,
    },
  ]);

  await page.goto("/home");
  await expect(
    page.getByRole("heading", {
      name: "일부 정보를 불러오지 못했어요",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /다시 확인/ }).first(),
  ).toBeVisible();

  // 인증 세션은 유지하고 SSR 고장 쿠키만 제거한 뒤 복구 버튼을 검증한다.
  await page.context().clearCookies({
    name: E2E_FORCE_REST_FAILURE_COOKIE,
  });
  await page
    .getByRole("button", { name: /다시 확인/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "오늘의 채굴 상태를 확인해요." }),
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
      await shoot(page, `home-ready-${viewport.name}-${theme}.png`);
      await expectNoHorizontalOverflow(page);

      await page.goto("/start");
      await dismissGuidedQuestIfPresent(page);
      await shoot(page, `start-ready-${viewport.name}-${theme}.png`);
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

test("홈은 더 새로운 만료 알림을 limit 전에 빼고 본인 유효 알림만 보여 준다", async ({
  page,
}) => {
  test.setTimeout(420_000);
  const hydration = trackHydration(page);
  const owner = await createConfirmedMember("home-notif-owner");
  const other = await createConfirmedMember("home-notif-other");
  const now = Date.now();
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  const olderActive = seedMemberNotification({
    body: "이전 시각이어도 아직 유효한 안내예요.",
    category: "wallet",
    createdAt: at(-6 * 60 * 60 * 1000),
    route: "/wallet/deposit",
    title: "홈에 남을 유효 알림",
    userId: owner.userId,
  });
  const olderRead = seedMemberNotification({
    body: "이미 확인한 안내예요.",
    category: "mining",
    createdAt: at(-8 * 60 * 60 * 1000),
    readAt: at(-7 * 60 * 60 * 1000),
    route: "/mining",
    title: "읽은 유효 알림",
    userId: owner.userId,
  });

  const expiredTitles = [
    "만료된 최신 알림 1",
    "만료된 최신 알림 2",
    "만료된 최신 알림 3",
  ];
  expiredTitles.forEach((title, index) => {
    seedMemberNotification({
      body: "만료되어 홈 최근 알림에 있으면 안 돼요.",
      category: "service",
      createdAt: at(-(40 - index * 10) * 60 * 1000),
      expiresAt: at(-2 * 60 * 1000),
      title,
      userId: owner.userId,
    });
  });

  const expiredEvent = seedMemberNotification({
    body: "만료된 이벤트 링크는 홈에 나오면 안 돼요.",
    category: "events",
    createdAt: at(-15 * 60 * 1000),
    expiresAt: at(-60 * 1000),
    route: "/login",
    title: "만료된 이벤트 알림",
    userId: owner.userId,
  });
  const foreign = seedMemberNotification({
    body: "다른 회원의 알림은 홈에 나오면 안 돼요.",
    category: "service",
    createdAt: at(-30 * 1000),
    title: "다른 회원의 홈 알림",
    userId: other.userId,
  });

  await loginAsMember(page, owner, "/home");

  await expect(
    page.getByRole("heading", { name: "오늘의 채굴 상태를 확인해요." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "최근 알림" })).toBeVisible();
  await expect(page.getByRole("link", { name: "전체 보기" })).toHaveAttribute(
    "href",
    "/notifications",
  );
  await expect(page.getByText(olderActive.title)).toBeVisible();
  await expect(page.getByText(olderRead.title)).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(olderActive.title) }),
  ).toHaveAttribute("href", "/wallet/deposit");
  await expect(
    page.getByRole("link", { name: new RegExp(olderRead.title) }),
  ).toHaveAttribute("href", "/mining");

  for (const title of [...expiredTitles, expiredEvent.title, foreign.title]) {
    await expect(page.getByText(title)).toHaveCount(0);
  }
  await expect(
    page.getByText("새 알림이 없어요", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^로그인$/ })).toHaveCount(0);
  expect(hydration).toEqual([]);
});
