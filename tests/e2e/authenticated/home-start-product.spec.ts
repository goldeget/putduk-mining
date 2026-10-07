import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { E2E_FORCE_REST_FAILURE_COOKIE } from "@/lib/supabase/server-fetch";

import { createConfirmedMember } from "../fixtures/local-auth";
import { ensureLocalTrialProgram } from "./helpers/eligibility";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
  startTrialFromUi,
} from "./helpers/member-session";
import { seedMemberNotification } from "./helpers/notification-fixtures";
import { expectSettledRoute } from "./helpers/settled-route";
import { awaitPaintedImages } from "./helpers/painted-images";

const HOME_READ_FAULT_TABLES =
  "trial_account_snapshots,mining_active_session_snapshots";

const VIEWPORTS = [
  { height: 844, name: "320", width: 320 },
  { height: 844, name: "360", width: 360 },
  { height: 844, name: "375", width: 375 },
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
  { height: 1080, name: "1920", width: 1920 },
] as const;

const OUTPUT_DIR = path.join("test-results", "home-start-product");

test.beforeAll(async () => {
  // This file must work alone on the repository's empty-economy local reset.
  // The guarded helper uses existing pgTAP trial rules, never operating data.
  await ensureLocalTrialProgram();
});

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
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await awaitPaintedImages(page);
  await page.screenshot({
    animations: "disabled",
    caret: "initial",
    fullPage: true,
    path: path.join(OUTPUT_DIR, fileName),
  });
  const main = page.getByRole("main");
  const { range, step } = await main.evaluate((element) => ({
    range: element.scrollHeight - element.clientHeight,
    step: Math.max(1, Math.floor(element.clientHeight * 0.7)),
  }));
  for (let top = step; range > 16; top += step) {
    const target = Math.min(top, range);
    await main.evaluate(
      (element, position) =>
        element.scrollTo({ top: position, behavior: "instant" }),
      target,
    );
    await expect
      .poll(() =>
        main.evaluate(
          (element, position) => Math.abs(element.scrollTop - position),
          target,
        ),
      )
      .toBeLessThanOrEqual(1);
    await awaitPaintedImages(page);
    await page.screenshot({
      animations: "disabled",
      path: path.join(
        OUTPUT_DIR,
        fileName.replace(
          /\.png$/,
          `-${target === range ? "bottom" : `middle-${Math.ceil(top / step)}`}.png`,
        ),
      ),
      fullPage: true,
    });
    if (target === range) break;
  }
  await main.evaluate((element) =>
    element.scrollTo({ top: 0, behavior: "instant" }),
  );
}

async function expectHomeReadingFlow(page: Page) {
  const main = page.getByRole("main");
  const header = await main.locator("header.product-header").boundingBox();
  const greeting = await main.getByRole("heading", { level: 1 }).boundingBox();
  expect(header).not.toBeNull();
  expect(greeting).not.toBeNull();
  expect(header!.y + header!.height).toBeLessThanOrEqual(greeting!.y + 1);
  const clipped = await main.evaluate((element) => {
    const greeting = element.querySelector("h1");
    if (!greeting) return ["missing greeting"];
    const rect = greeting.getBoundingClientRect();
    const failures: string[] = [];
    for (
      let ancestor = greeting.parentElement;
      ancestor && ancestor !== element;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      if (["hidden", "clip"].includes(style.overflowY)) {
        const bounds = ancestor.getBoundingClientRect();
        if (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)
          failures.push("greeting clipped by ancestor");
      }
    }
    return failures;
  });
  expect(clipped).toEqual([]);
}

async function applyTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await waitForHydratedControls(page);
  await page
    .getByRole("combobox", { name: "화면 테마" })
    .first()
    .selectOption(theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-preference",
    theme,
  );
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
    page.getByRole("heading", {
      level: 1,
      name: /안녕하세요,.*님|더 큰 가치를 만드는 여정이 계속됩니다\./,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "PUTDUK START 체험", exact: true })
      .getByRole("link", { name: /첫 채굴 시작/ }),
  ).toBeVisible();
  await expect(page.getByText("사용 가능 KRW")).toBeVisible();
  await expect(page.getByText("체험 값은 포함되지 않습니다.")).toBeVisible();
  await expect(
    page.getByText("새 알림이 없어요", { exact: false }),
  ).toBeVisible();

  await page
    .getByRole("group", { name: "PUTDUK START 체험", exact: true })
    .getByRole("link", { name: /첫 채굴 시작/ })
    .click();
  await expect(page).toHaveURL(/\/start$/);
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
  const startCard = home.getByRole("group", {
    name: "PUTDUK START 체험",
    exact: true,
  });
  const activeStatus = startCard.getByText(/^진행 중/);
  await expect(activeStatus).toHaveCount(1);
  await expect(activeStatus).toBeVisible();
  await expect(
    startCard.getByRole("link", { name: /START 계속하기/ }),
  ).toBeVisible();
  await startCard.getByRole("link", { name: /START 계속하기/ }).click();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "채굴이 진행 중이에요",
      exact: true,
    }),
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
  const failedStart = page.getByRole("group", {
    name: "PUTDUK START 체험",
    exact: true,
  });
  await expect(
    failedStart.getByRole("link", { name: /START 상태 확인/ }),
  ).toBeVisible();
  await expect(
    failedStart.getByRole("link", { name: /첫 채굴 시작|START 계속하기/ }),
  ).toHaveCount(0);

  // 인증 세션은 유지하고 SSR 고장 쿠키만 제거한 뒤 복구 버튼을 검증한다.
  await page.context().clearCookies({
    name: E2E_FORCE_REST_FAILURE_COOKIE,
  });
  await page
    .getByRole("button", { name: /다시 확인/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /안녕하세요,.*님|더 큰 가치를 만드는 여정이 계속됩니다\./,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByRole("group", { name: "PUTDUK START 체험", exact: true })
      .getByRole("link", { name: /첫 채굴 시작/ }),
  ).toBeVisible();

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
  test.setTimeout(360_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("home-start-visual");
  const runtimeFailures: { type: string; detail: string }[] = [];
  page.on("pageerror", (error) =>
    runtimeFailures.push({ type: "pageerror", detail: error.name }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      runtimeFailures.push({
        type: "console",
        detail: "browser console error",
      });
  });
  page.on("requestfailed", (request) => {
    const error = request.failure()?.errorText ?? "request failed";
    if (!error.includes("ERR_ABORTED"))
      runtimeFailures.push({
        type: "network",
        detail: new URL(request.url()).pathname,
      });
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      runtimeFailures.push({
        type: "http",
        detail: `${response.status()} ${new URL(response.url()).pathname}`,
      });
  });
  await loginAsMember(page, member, "/home");
  const notes: string[] = [];
  let submitted = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/ai/chat"
    )
      submitted++;
  });

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const theme of ["light", "dark"] as const) {
      await applyTheme(page, theme);
      await page.goto("/home");
      await dismissGuidedQuestIfPresent(page);
      await expect(page.locator(`[data-scene-theme="${theme}"]`)).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() =>
            [...document.images]
              .filter((image) => image.getBoundingClientRect().width > 0)
              .every((image) => image.complete && image.naturalWidth > 0),
          ),
        )
        .toBe(true);
      await shoot(page, `home-ready-${viewport.name}-${theme}.png`);
      await expectNoHorizontalOverflow(page);
      await expectHomeReadingFlow(page);
      if (viewport.width >= 980) {
        await expect(page.locator(".product-sidebar")).toHaveCount(0);
        const navigation = page.getByRole("navigation", {
          name: "홈 주요 메뉴",
          exact: true,
        });
        await expect(navigation).toBeVisible();
        const artwork = page.locator(`[data-scene-theme="${theme}"] img`);
        expect(
          await artwork.evaluate((image: HTMLImageElement) => image.currentSrc),
        ).toContain(
          theme === "light"
            ? "/semiconductor-wafer-light-desktop/"
            : "/semiconductor-tower-desktop/",
        );
        await expect(navigation.getByRole("link")).toHaveCount(6);
        await expect(
          navigation.getByRole("link", { name: "홈", exact: true }),
        ).toHaveAttribute("aria-current", "page");
        await expect(
          navigation.getByRole("link", { name: "이벤트", exact: true }),
        ).toHaveAttribute("href", "/events");
        await expect(
          navigation.getByRole("link", { name: "PUTDUK AI", exact: true }),
        ).toHaveAttribute("href", "/ai");
      }
      if (viewport.width === 1440) {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await shoot(page, `home-ready-${viewport.name}-${theme}-text-200.png`);
        await expectNoHorizontalOverflow(page);
        await expectHomeReadingFlow(page);
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });
        await page
          .getByRole("link", { name: "내 계정 보기", exact: true })
          .click();
        await expect(page).toHaveURL(/\/menu\/account$/);
        await expect(
          page.getByRole("heading", { name: "내 정보", exact: true }),
        ).toBeVisible();
        await page.goto("/home");
      }
      if (viewport.width === 390) {
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "200%";
        });
        await shoot(page, `home-ready-${viewport.name}-${theme}-text-200.png`);
        await expectNoHorizontalOverflow(page);
        await expectHomeReadingFlow(page);
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "";
        });
        if (theme === "light") {
          const quick = page.getByRole("navigation", {
            name: "바로 가기",
            exact: true,
          });
          await expect(quick.getByRole("link")).toHaveCount(4);
          await quick
            .getByRole("link", { name: "거래 내역", exact: true })
            .click();
          await expect(page).toHaveURL(/\/wallet\?view=history$/);
          await expect(
            page.getByRole("radio", { name: "거래내역", exact: true }),
          ).toBeChecked();
          await expect(
            page.getByRole("heading", { name: "최근 거래 내역", exact: true }),
          ).toBeVisible();
          await page.goto("/menu");
          await page
            .getByRole("link")
            .filter({ has: page.locator("strong", { hasText: "퍼뜩 AI" }) })
            .click();
          await expect(page.locator("[data-ai-page]:visible")).toHaveCount(1);
          expect(submitted).toBe(0);
        } else {
          const launcher = page.getByRole("button", {
            name: "AI 도움",
            exact: true,
          });
          await launcher.click();
          const dialog = page.getByRole("dialog", {
            name: "퍼뜩 AI",
            exact: true,
          });
          await expect(dialog).toBeVisible();
          await expect(
            dialog.getByRole("textbox", { name: "질문 입력", exact: true }),
          ).toBeInViewport({ ratio: 1 });
          expect(submitted).toBe(0);
          await page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
          await expect(launcher).toBeFocused();
        }
        expect(submitted).toBe(0);
      }

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
  writeFileSync(
    path.join(OUTPUT_DIR, "runtime-health.json"),
    JSON.stringify(
      {
        runtimeFailures,
        submittedAiRequests: submitted,
        hydrationErrors: hydration.length,
      },
      null,
      2,
    ) + "\n",
  );
  expect(runtimeFailures).toEqual([]);
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
    page.getByRole("heading", {
      level: 1,
      name: /안녕하세요,.*님|더 큰 가치를 만드는 여정이 계속됩니다\./,
    }),
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
