import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  confirmLocalUsdtDeposit,
  ensureLocalAdmin,
  FIXTURE_ERC20_ADDRESS,
  FIXTURE_LONG_TRC20_ADDRESS,
  FIXTURE_TRC20_ADDRESS,
  readLocalUsdtDepositId,
  seedKrwDepositStatuses,
  withActiveUsdtInstructions,
} from "./helpers/deposit-fixtures";
import {
  dismissGuidedQuestIfPresent,
  loginAsMember,
} from "./helpers/member-session";

const VIEWPORTS = [
  { height: 844, name: "390", width: 390 },
  { height: 1112, name: "834", width: 834 },
  { height: 900, name: "1440", width: 1440 },
] as const;

const OUTPUT_DIR = path.join("test-results", "deposit-product");

const FORBIDDEN_USDT_COPY = [
  "USDT 잔액",
  "USDT 지갑",
  "보유 USDT",
  "자동 환전",
  "실시간 시세",
  "블록체인 자동",
  "자동 코인",
  "안내된 계좌",
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

async function openDeposit(page: Page) {
  await page.goto("/wallet/deposit");
  await dismissGuidedQuestIfPresent(page);
  await expect(
    page.getByRole("heading", { name: "입금하기", level: 1 }),
  ).toBeVisible();
}

test("unsigned visitors keep the deposit return path", async ({ page }) => {
  const hydration = trackHydration(page);
  await page.goto("/wallet/deposit");
  await expect(page).toHaveURL(/\/login\?next=%2Fwallet%2Fdeposit$/);
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/wallet/deposit",
  );
  await expect(page.getByRole("heading", { name: "입금하기" })).toHaveCount(0);
  expect(hydration).toEqual([]);
});

test("rejects invalid KRW input and keeps one idempotent request", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const hydration = trackHydration(page);
  const member = await createConfirmedMember("deposit-krw");
  await loginAsMember(page, member, "/wallet/deposit");
  await openDeposit(page);

  const krwHistory = page.getByRole("region", { name: "최근 원화 입금" });
  await expect(
    krwHistory.getByRole("heading", { name: "아직 원화 입금 요청이 없어요" }),
  ).toBeVisible();
  const submit = page.getByRole("button", { name: "입금 요청하기" });
  await expect(submit).toBeDisabled();

  const amount = page.locator("#deposit-amount");
  await amount.fill("0");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(submit).toBeDisabled();
  await amount.fill("12ab30");
  await expect(amount).toHaveValue("1230");
  await page.getByRole("button", { name: "+10,000" }).click();
  await expect(amount).toHaveValue("10000");
  const mainText = await page.locator("main").innerText();
  expect(mainText).not.toMatch(/최소\s*입금|최대\s*입금/);

  await page.route(/\/api\/v1\/deposits$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "DEPOSIT_REQUEST_FAILED",
          message: "relation deposit_requests does not exist",
        },
      }),
    });
  });
  await submit.click();
  await expect(page.locator("#deposit-request-feedback")).toContainText(
    "입금 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.",
  );
  await expect(page.getByText("deposit_requests")).toHaveCount(0);
  await page.unroute(/\/api\/v1\/deposits$/);

  let releaseRequest: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(/\/api\/v1\/deposits$/, async (route) => {
    if (route.request().method() === "POST") {
      await gate;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "+30,000" }).click();
  const pendingClick = page
    .getByRole("button", { name: "입금 요청하기" })
    .click();
  await expect(
    page.getByRole("button", { name: "입금 요청 접수 중" }),
  ).toBeDisabled();
  releaseRequest?.();
  await pendingClick;
  await expect(page.getByText("입금 요청을 접수했어요.")).toBeVisible({
    timeout: 60_000,
  });
  await page.unroute(/\/api\/v1\/deposits$/);
  await expect(krwHistory.getByText("30,000 KRW")).toBeVisible();
  await expect(krwHistory.getByText("이체 대기")).toBeVisible();

  const idempotent = await page.evaluate(async () => {
    const key = crypto.randomUUID();
    const send = () =>
      fetch("/api/v1/deposits", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ amountAtomic: "22000", currency: "KRW" }),
      }).then(async (response) => ({
        body: (await response.json()) as {
          data?: { requestId?: string };
        },
        status: response.status,
      }));
    const first = await send();
    const second = await send();
    return { first, second };
  });
  expect(idempotent.first.status).toBe(201);
  expect(idempotent.second.status).toBe(201);
  expect(idempotent.first.body.data?.requestId).toBe(
    idempotent.second.body.data?.requestId,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(krwHistory.getByText("22,000 KRW")).toHaveCount(1);

  await amount.fill("");
  await amount.pressSequentially("25000");
  await page.keyboard.press("Enter");
  await expect(krwHistory.getByText("25,000 KRW")).toBeVisible();
  expect(hydration).toEqual([]);
});

test("shows the KRW request status matrix from canonical approval", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const hydration = trackHydration(page);
  const operator = await createConfirmedMember("deposit-krw-op");
  const member = await createConfirmedMember("deposit-krw-status");
  seedKrwDepositStatuses({
    operatorId: operator.userId,
    userId: member.userId,
  });
  await loginAsMember(page, member, "/wallet/deposit");
  await openDeposit(page);

  const krwHistory = page.getByRole("region", { name: "최근 원화 입금" });
  for (const label of [
    "요청 접수",
    "이체 대기",
    "입금 확인 중",
    "반영 완료",
    "확인 필요",
    "취소",
  ]) {
    await expect(krwHistory.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(krwHistory.getByText("14,000 KRW")).toBeVisible();
  await expect(krwHistory.getByText("11,000 KRW")).toBeVisible();
  expect(hydration).toEqual([]);
});

test("keeps USDT submission closed when no instruction is active", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const hydration = trackHydration(page);
  const operator = await createConfirmedMember("deposit-usdt-empty-op");
  const member = await createConfirmedMember("deposit-usdt-empty");
  ensureLocalAdmin(operator.userId);
  await withActiveUsdtInstructions(operator.userId, [], async () => {
    await loginAsMember(page, member, "/wallet/deposit");
    await openDeposit(page);
    await expect(page.getByText("입금 안내를 준비하고 있어요.")).toBeVisible();
    await expect(page.getByLabel("네트워크")).toBeDisabled();
    await expect(page.locator("#usdt-deposit-tx")).toBeDisabled();
    await expect(page.locator("#usdt-deposit-amount")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "입금 내역 접수" }),
    ).toBeDisabled();
  });
  expect(hydration).toEqual([]);
});

test("binds each active network to its own deposit address", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const hydration = trackHydration(page);
  const operator = await createConfirmedMember("deposit-usdt-bind-op");
  const member = await createConfirmedMember("deposit-usdt-bind");
  ensureLocalAdmin(operator.userId);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await withActiveUsdtInstructions(
    operator.userId,
    [
      { address: FIXTURE_ERC20_ADDRESS, network: "ERC20" },
      { address: FIXTURE_TRC20_ADDRESS, network: "TRC20" },
    ],
    async () => {
      await loginAsMember(page, member, "/wallet/deposit");
      await openDeposit(page);
      const network = page.getByLabel("네트워크");
      await expect(network).toHaveValue("ERC20");
      await expect(page.getByText(FIXTURE_ERC20_ADDRESS)).toBeVisible();
      await expect(page.getByText(FIXTURE_TRC20_ADDRESS)).toHaveCount(0);
      await network.selectOption("TRC20");
      await expect(page.getByText(FIXTURE_TRC20_ADDRESS)).toBeVisible();
      await expect(page.getByText(FIXTURE_ERC20_ADDRESS)).toHaveCount(0);
      const copy = page.getByRole("button", { name: "입금 주소 복사" });
      await copy.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("입금 주소를 복사했어요.")).toBeVisible();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe(FIXTURE_TRC20_ADDRESS);
    },
  );
  expect(hydration).toEqual([]);
});

test("submits manual USDT through the server and hides other members", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const hydration = trackHydration(page);
  const operator = await createConfirmedMember("deposit-usdt-submit-op");
  const member = await createConfirmedMember("deposit-usdt-submit");
  const other = await createConfirmedMember("deposit-usdt-other");
  ensureLocalAdmin(operator.userId);
  const txHash = `localdeposit${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`.replace(/[^a-z0-9]/g, "");
  const bodies: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/deposits/usdt"
    ) {
      bodies.push(request.postData() ?? "");
    }
  });

  await withActiveUsdtInstructions(
    operator.userId,
    [{ address: FIXTURE_TRC20_ADDRESS, network: "TRC20" }],
    async () => {
      await loginAsMember(page, member, "/wallet/deposit");
      await openDeposit(page);
      const mainText = await page.locator("main").innerText();
      for (const phrase of FORBIDDEN_USDT_COPY) {
        expect(mainText).not.toContain(phrase);
      }
      expect(mainText).toContain("보낸 USDT");

      await page.locator("#usdt-deposit-tx").fill(txHash);
      await page.locator("#usdt-deposit-amount").fill("1.2.3");
      await expect(
        page.getByRole("button", { name: "입금 내역 접수" }),
      ).toBeDisabled();
      await page.locator("#usdt-deposit-amount").fill("0");
      await expect(
        page.getByRole("button", { name: "입금 내역 접수" }),
      ).toBeDisabled();

      await page.locator("#usdt-deposit-amount").fill("7.654321");
      await page.getByRole("button", { name: "입금 내역 접수" }).click();
      const usdtHistory = page.getByRole("region", { name: "최근 USDT 입금" });
      const submittedRow = usdtHistory.getByText("7.654321 USDT 송금");
      const submitFeedback = page.locator("#usdt-deposit-feedback");
      await expect(submittedRow.or(submitFeedback)).toBeVisible({
        timeout: 60_000,
      });
      if (await submitFeedback.isVisible()) {
        const feedbackText = (await submitFeedback.innerText()).trim();
        if (!feedbackText.includes("입금 내역을 접수했어요")) {
          throw new Error(`USDT_SUBMIT_UI:${feedbackText}`);
        }
      }
      await expect(submittedRow).toBeVisible({ timeout: 60_000 });
      await expect(
        usdtHistory.getByText("접수", { exact: true }),
      ).toBeVisible();
      expect(bodies).toHaveLength(1);
      const submitted = JSON.parse(bodies[0] ?? "{}") as Record<string, string>;
      expect(Object.keys(submitted).sort()).toEqual([
        "network",
        "sentUsdtAmount",
        "txHash",
      ]);
      expect(submitted.network).toBe("TRC20");
      expect(JSON.stringify(submitted)).not.toContain(FIXTURE_TRC20_ADDRESS);

      const duplicate = await page.evaluate(async (hash) => {
        const send = (key: string, amount: string) =>
          fetch("/api/v1/deposits/usdt", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              "Idempotency-Key": key,
            },
            body: JSON.stringify({
              network: "TRC20",
              sentUsdtAmount: amount,
              txHash: hash,
            }),
          }).then(async (response) => ({
            body: (await response.json()) as {
              data?: { depositId?: string };
            },
            status: response.status,
          }));
        const key = crypto.randomUUID();
        const first = await send(key, "7.654321");
        const second = await send(key, "7.654321");
        const otherHash = await send(crypto.randomUUID(), "8.1");
        return { first, otherHash, second };
      }, txHash);
      expect(duplicate.first.status).toBe(201);
      expect(duplicate.second.status).toBe(201);
      expect(duplicate.first.body.data?.depositId).toBe(
        duplicate.second.body.data?.depositId,
      );
      expect(duplicate.otherHash.status).toBe(201);
      expect(duplicate.otherHash.body.data?.depositId).toBe(
        duplicate.first.body.data?.depositId,
      );

      const depositId = readLocalUsdtDepositId({
        network: "TRC20",
        txHash,
        userId: member.userId,
      });
      confirmLocalUsdtDeposit({
        actorId: operator.userId,
        depositId,
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(usdtHistory.getByText("KRW 반영 완료")).toBeVisible();
      await expect(usdtHistory.getByText("7.654321 USDT 송금")).toHaveCount(1);
      await expect(usdtHistory.getByText("8.1 USDT 송금")).toHaveCount(0);

      const browser = page.context().browser();
      if (!browser) {
        throw new Error("DEPOSIT_BROWSER_MISSING");
      }
      const otherContext = await browser.newContext();
      try {
        const otherPage = await otherContext.newPage();
        await loginAsMember(otherPage, other, "/wallet/deposit");
        await openDeposit(otherPage);
        await expect(otherPage.getByText("7.654321")).toHaveCount(0);
        await expect(otherPage.getByText(txHash)).toHaveCount(0);
        await expect(
          otherPage.getByRole("heading", {
            name: "아직 USDT 입금 내역이 없어요",
          }),
        ).toBeVisible();
      } finally {
        await otherContext.close();
      }
    },
  );
  expect(hydration).toEqual([]);
});

test("covers deposit layout, theme, focus, and reduced motion", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const hydration = trackHydration(page);
  const operator = await createConfirmedMember("deposit-layout-op");
  const member = await createConfirmedMember("deposit-layout");
  ensureLocalAdmin(operator.userId);
  await withActiveUsdtInstructions(
    operator.userId,
    [{ address: FIXTURE_LONG_TRC20_ADDRESS, network: "TRC20" }],
    async () => {
      await loginAsMember(page, member, "/wallet/deposit");
      await openDeposit(page);
      await expect(page.getByText(FIXTURE_LONG_TRC20_ADDRESS)).toBeVisible();

      const amount = page.locator("#deposit-amount");
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
            page.getByRole("heading", { name: "입금하기", level: 1 }),
          ).toBeVisible();
          await expect(
            page.getByText(FIXTURE_LONG_TRC20_ADDRESS),
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
          await shoot(page, `deposit-${viewport.name}-${theme}.png`);
        }
      }

      await page.setViewportSize({ height: 844, width: 390 });
      await page.getByLabel("화면 테마").selectOption("system");
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-theme",
        "dark",
      );
      await expect(page.locator("html")).not.toHaveAttribute(
        "data-theme",
        "light",
      );
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
        .locator("#deposit-amount")
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
        const resources = performance
          .getEntriesByType("resource")
          .map((entry) => {
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
    },
  );
  expect(hydration).toEqual([]);
});
