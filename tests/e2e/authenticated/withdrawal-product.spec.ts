import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  prepareMemberThroughStart,
  prepareSharedOperator,
  registerFirstKrwDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";
import { seedWithdrawalStatusMatrix } from "./helpers/withdrawal-fixtures";
import { captureRedactedWithdrawalEvidence } from "./helpers/withdrawal-evidence";

// The error/recovery case now enters a real reauthentication password. Do not
// persist credential-bearing traces/videos or automatic failure screenshots.
test.use({ trace: "off", video: "off", screenshot: "off" });

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "withdrawal-product");

const FORBIDDEN_COPY = [
  "USDT 잔액",
  "USDT 지갑",
  "보유 USDT",
  "사용자 USDT 잔액",
  "휴대폰 인증",
  "SMS 인증",
  "가상 채굴",
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

async function openWithdraw(page: Page) {
  await page.goto("/wallet/withdraw");
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "출금하기", level: 1 }),
  ).toBeVisible();
}

test.beforeAll(() => {
  requireWithdrawalDataKey();
});

test("비로그인 방문자는 출금 복귀 경로를 유지한다", async ({ page }) => {
  const hydration = trackHydration(page);
  await page.goto("/wallet/withdraw");
  await expect(page).toHaveURL(/\/login\?next=%2Fwallet%2Fwithdraw$/);
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/wallet/withdraw",
  );
  await expect(page.getByRole("heading", { name: "출금하기" })).toHaveCount(0);
  expect(hydration).toEqual([]);
});

test("빈 이력·검증·오류 복구와 KRW 기준 복사를 확인한다", async ({ page }) => {
  test.setTimeout(240_000);
  const hydration = trackHydration(page);
  const { member } = await prepareMemberThroughStart(page, "wd-product-form");
  await registerFirstKrwDestination(page);
  hydration.length = 0;
  await openWithdraw(page);

  const history = page.getByRole("region", { name: "최근 출금 요청" });
  await expect(
    history.getByRole("heading", { name: "아직 출금 요청이 없어요" }),
  ).toBeVisible();

  const mainText = await page.locator("main").innerText();
  for (const phrase of FORBIDDEN_COPY) {
    expect(mainText).not.toContain(phrase);
  }
  expect(mainText).toContain("정산된 KRW 잔액만 출금할 수 있어요.");
  expect(mainText).toContain("사용 가능한 원화에서만 출금할 수 있어요.");
  expect(mainText).toContain("USDT를 따로 보관하지 않습니다.");

  const submit = page.getByRole("button", { name: "출금 요청하기" });
  await expect(submit).toBeDisabled();
  const amount = page.locator("#withdrawal-amount");
  await amount.fill("0");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(submit).toBeDisabled();

  await page.route(/\/api\/v1\/withdrawals\/destinations$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "DESTINATION_REGISTER_FAILED",
          message: 'relation "withdrawal_destinations" does not exist',
        },
      }),
    });
  });
  await page.route(/\/api\/v1\/withdrawals\/hold$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "WITHDRAWAL_REQUEST_FAILED",
          message: "relation withdrawal_requests does not exist",
        },
      }),
    });
  });
  await page.getByRole("button", { name: "최소 금액" }).click();
  await submit.click();
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "출금 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
  );
  await expect(page.getByText("withdrawal_requests")).toHaveCount(0);

  // Uncertain outcome must be reconciled before materially changing the request.
  await page.getByRole("button", { name: "입력 다시하기" }).click();
  await expect(
    page.getByRole("button", { name: "다른 목적지로 변경" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "다른 목적지로 변경" }).click();
  await page.getByRole("button", { name: "최소 금액" }).click();
  await page.locator('select[name="bankCode"]').selectOption("KB");
  await page.locator('input[name="accountHolder"]').fill("홍길동");
  await page.locator('input[name="accountNumber"]').fill("123456789012");
  await page
    .locator('input[name="destinationReauthPassword"]')
    .fill(member.password);
  await page.getByRole("button", { name: "변경 확인", exact: true }).click();
  await expect(
    page.locator('input[name="destinationReauthPassword"]'),
  ).toHaveValue("");
  await expect(page.locator("#withdrawal-request-feedback")).toContainText(
    "출금 목적지를 등록하지 못했어요. 잠시 후 다시 시도해 주세요.",
  );
  await expect(page.getByText("withdrawal_requests")).toHaveCount(0);
  await expect(page.getByText("withdrawal_destinations")).toHaveCount(0);
  const evidencePath = test
    .info()
    .outputPath("registration-error-after-reauth.png");
  await captureRedactedWithdrawalEvidence(page, evidencePath);
  await test.info().attach("withdrawal-registration-error-after-reauth", {
    contentType: "image/png",
    path: evidencePath,
  });
  await page.unroute(/\/api\/v1\/withdrawals\/hold$/);
  await page.unroute(/\/api\/v1\/withdrawals\/destinations$/);
  expect(hydration).toEqual([]);
});

test("출금 요청 상태 매트릭스 라벨을 표시한다", async ({ page }) => {
  test.setTimeout(180_000);
  const hydration = trackHydration(page);
  const operator = await prepareSharedOperator();
  const member = await createConfirmedMember("wd-product-status");
  seedWithdrawalStatusMatrix({
    operatorId: operator.userId,
    userId: member.userId,
  });
  await loginAsMember(page, member, "/wallet/withdraw");
  await openWithdraw(page);

  const history = page.getByRole("region", { name: "최근 출금 요청" });
  for (const label of [
    "접수 완료",
    "보류",
    "확인 중",
    "송금 중",
    "송금 기록",
    "완료",
    "확인 필요",
    "취소",
  ]) {
    await expect(history.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(history.getByText("1,600 KRW")).toBeVisible();
  await expect(history.getByText("1,100 KRW")).toBeVisible();
  expect(hydration).toEqual([]);
});

test("레이아웃·테마·포커스·모션 감소를 확인한다", async ({ page }) => {
  test.setTimeout(360_000);
  const hydration = trackHydration(page);
  await prepareMemberThroughStart(page, "wd-product-layout");
  await registerFirstKrwDestination(page);
  hydration.length = 0;
  await openWithdraw(page);

  await expect(
    page.getByRole("button", { name: "다른 목적지로 변경" }),
  ).toBeVisible();

  const amount = page.locator("#withdrawal-amount");
  await amount.focus();
  const focusShadow = await amount.evaluate(
    (node) => getComputedStyle(node).boxShadow,
  );
  expect(focusShadow).not.toBe("none");

  for (const viewport of VIEWPORTS) {
    for (const theme of ["dark", "light"] as const) {
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });
      await applyTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "출금하기", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "다른 목적지로 변경" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (viewport.width < 980) {
        const navigation = page.locator(
          ".product-workspace > .product-navigation",
        );
        await expect(navigation).toBeVisible();
        await expect(
          navigation.getByRole("link", { name: "자산" }),
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
      await shoot(page, `withdraw-${viewport.name}-${theme}.png`);
    }
  }

  await page.setViewportSize({ height: 844, width: 390 });
  await page.getByLabel("화면 테마").selectOption("system");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: "reduce",
  });
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

  const transition = await page
    .locator("#withdrawal-amount")
    .evaluate((node) => getComputedStyle(node).transitionDuration);
  for (const part of transition.split(",")) {
    const value = part.trim();
    const milliseconds = value.endsWith("ms")
      ? Number(value.slice(0, -2))
      : Number(value.replace(/s$/, "")) * 1000;
    expect(milliseconds).toBeLessThanOrEqual(0.02);
  }
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
    const resources = performance.getEntriesByType("resource").map((entry) => {
      const resource = entry as PerformanceResourceTiming;
      return {
        encodedBodySize: resource.encodedBodySize,
        name: resource.name.split("/").slice(-1)[0]?.slice(0, 80) ?? "",
        transferSize: resource.transferSize,
      };
    });
    const scriptTransfer = resources
      .filter((entry) => entry.name.endsWith(".js"))
      .reduce((sum, entry) => sum + entry.transferSize, 0);
    return {
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      mode: "next-dev-or-start",
      resourceCount: resources.length,
      scriptTransfer,
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
