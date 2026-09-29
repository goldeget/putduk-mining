import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  completeAdminLoginWithTotp,
  grantAdminRole,
  ADMIN_ORIGIN,
} from "./helpers/admin-totp";
import { openAdminQueue, withdrawalCard } from "./helpers/admin-money-ui";
import { readLatestWithdrawal } from "./helpers/eligibility";
import {
  prepareMemberThroughStart,
  registerFirstKrwDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import { requestWelcomeWithdrawalFromUi } from "./helpers/member-session";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "admin-withdrawals-product");

const FORBIDDEN_COPY = [
  "USDT 지갑",
  "보유 USDT",
  "회원 USDT 잔액이 있습니다",
  "휴대폰 인증",
  "coming soon",
  "TODO",
];

const QUEUES = [
  {
    path: "/withdrawals/krw-bank",
    title: "계좌 출금 대기열",
    emptyTitle: "대기 중인 계좌 출금 없음",
    shotPrefix: "krw",
  },
  {
    path: "/withdrawals/usdt",
    title: "USDT 출금 대기열",
    emptyTitle: "대기 중인 USDT 출금 없음",
    shotPrefix: "usdt",
  },
] as const;

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

async function applyTheme(page: Page, theme: "dark" | "light") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
  await page.evaluate((selected) => {
    localStorage.setItem("putduk-theme", selected);
    document.documentElement.dataset.theme = selected;
    document.documentElement.style.colorScheme = selected;
  }, theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
  expect(overflow).toBe(false);
}

async function shoot(page: Page, name: string) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUTPUT_DIR, name),
    fullPage: true,
  });
}

async function expectForbiddenCopyAbsent(page: Page) {
  const body = await page.locator("main").innerText();
  for (const phrase of FORBIDDEN_COPY) {
    expect(body).not.toContain(phrase);
  }
}

test.describe("admin withdrawals product evidence", () => {
  test.beforeAll(() => {
    requireWithdrawalDataKey();
  });

  test("unauthenticated visits are sent to login", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${ADMIN_ORIGIN}/withdrawals/krw-bank`);
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`${ADMIN_ORIGIN}/withdrawals/usdt`);
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test("empty queues, themes, focus, reduced motion, and timing evidence", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const admin = await createConfirmedMember("wd-product-empty-admin");
    await grantAdminRole(admin.userId);
    const context = await browser.newContext();
    const page = await context.newPage();
    const hydration = trackHydration(page);
    await completeAdminLoginWithTotp(page, admin.email, admin.password);

    for (const queue of QUEUES) {
      await openAdminQueue(page, queue.path);
      await expect(
        page.getByRole("heading", { name: queue.title, level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: queue.emptyTitle, level: 2 }),
      ).toBeVisible();
      await expect(page.getByText("퍼뜩").first()).toBeVisible();
      await expectForbiddenCopyAbsent(page);
      if (queue.path === "/withdrawals/usdt") {
        await expect(page.getByText(/KRW 잔액/)).toBeVisible();
        await expect(page.getByText(/회원 USDT 잔액은 없습니다/)).toBeVisible();
      }

      await page.getByRole("heading", { name: queue.title, level: 1 }).click();
      await page.keyboard.press("Tab");
      const keyboardFocus = await page.evaluate(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement)) {
          return { tag: null, outline: "none" };
        }
        return {
          tag: el.tagName,
          outline: getComputedStyle(el).outlineStyle,
        };
      });
      expect(["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT"]).toContain(
        keyboardFocus.tag,
      );
      expect(keyboardFocus.outline).not.toBe("none");

      for (const viewport of VIEWPORTS) {
        for (const theme of ["dark", "light"] as const) {
          await page.setViewportSize({
            height: viewport.height,
            width: viewport.width,
          });
          await applyTheme(page, theme);
          await expect(
            page.getByRole("heading", { name: queue.title, level: 1 }),
          ).toBeVisible();
          await expectNoHorizontalOverflow(page);
          await shoot(
            page,
            `${queue.shotPrefix}-empty-${viewport.name}-${theme}.png`,
          );
        }
      }

      await page.setViewportSize({ height: 844, width: 390 });
      await page.evaluate(() => {
        localStorage.removeItem("putduk-theme");
        delete document.documentElement.dataset.theme;
        document.documentElement.style.colorScheme = "";
      });
      await page.emulateMedia({
        colorScheme: "light",
        reducedMotion: "reduce",
      });
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-theme",
        "dark",
      );
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-theme",
        "light",
      );

      const infiniteInMain = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return ["missing-main"];
        return main.getAnimations({ subtree: true }).flatMap((animation) => {
          const effect = animation.effect;
          if (!(effect instanceof KeyframeEffect)) return [];
          const iterations = effect.getTiming().iterations;
          if (iterations === Infinity && animation.playState === "running") {
            return [
              effect.target instanceof Element
                ? effect.target.tagName
                : "unknown",
            ];
          }
          return [];
        });
      });
      expect(infiniteInMain).toEqual([]);

      const sample = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0] as
          PerformanceNavigationTiming | undefined;
        const resources = performance.getEntriesByType("resource");
        const scriptTransfer = resources
          .map((entry) => entry as PerformanceResourceTiming)
          .filter((entry) => entry.name.includes(".js"))
          .reduce((sum, entry) => sum + entry.transferSize, 0);
        return {
          domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
          loadEventMs: navigation?.loadEventEnd ?? null,
          mode: "next-dev-or-start",
          path: location.pathname,
          resourceCount: resources.length,
          scriptTransfer,
          transferSize: navigation?.transferSize ?? null,
        };
      });
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(
        path.join(OUTPUT_DIR, `${queue.shotPrefix}-route-timing.json`),
        `${JSON.stringify(sample, null, 2)}\n`,
      );
    }

    expect(hydration).toEqual([]);
    await context.close();
  });

  test("held KRW queue shows operator forms without inventing money transitions", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const hydration = trackHydration(page);
    const { member } = await prepareMemberThroughStart(page, "wd-product-held");
    await registerFirstKrwDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "KRW_BANK");
    await expect(page.getByText("보류").first()).toBeVisible();

    const held = await readLatestWithdrawal(member.userId);
    expect(held?.status).toBe("HELD");
    expect(held?.destination_type).toBe("KRW_BANK");
    const withdrawalId = held!.id;

    const admin = await createConfirmedMember("wd-product-held-admin");
    await grantAdminRole(admin.userId);
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await completeAdminLoginWithTotp(adminPage, admin.email, admin.password);
    await openAdminQueue(adminPage, "/withdrawals/krw-bank");

    const card = withdrawalCard(adminPage, withdrawalId);
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("heading", { name: "보유(홀드)" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "계좌 송금 기록" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "거절 · 보류 해제" }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "취소 · 보류 해제" }),
    ).toBeVisible();

    const sendButton = card.getByRole("button", { name: "계좌 송금 기록" });
    await sendButton.focus();
    await adminPage.keyboard.press("Shift+Tab");
    await adminPage.keyboard.press("Tab");
    await expect(sendButton).toBeFocused();
    const focusStyle = await sendButton.evaluate(
      (node) => getComputedStyle(node).outlineStyle,
    );
    expect(focusStyle).not.toBe("none");

    await expectForbiddenCopyAbsent(adminPage);
    await shoot(adminPage, "krw-held-1440-dark.png");

    // 금액·원장 전이는 이 스펙에서 수행하지 않음. 고장 주입은 OPEN.
    expect(hydration).toEqual([]);
    await adminContext.close();
  });
});
