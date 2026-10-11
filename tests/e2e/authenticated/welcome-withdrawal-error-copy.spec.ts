import { expect, test, type Page } from "@playwright/test";

import {
  prepareMemberThroughStart,
  registerFirstKrwDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import {
  dismissGuidedQuestIfPresent,
  expectWelcomeWithdrawalPanel,
} from "./helpers/member-session";

const RAW_MESSAGE =
  "relation withdrawal_requests does not exist; service_role; schema cache error";

const FALLBACK =
  "첫 출금 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.";

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

test.beforeAll(() => {
  requireWithdrawalDataKey();
});

test("알 수 없는 서버 원문은 첫 출금 화면에 보이지 않는다", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const hydration = trackHydration(page);
  await prepareMemberThroughStart(page, "welcome-raw-error");
  await registerFirstKrwDestination(page);
  hydration.length = 0;

  await page.route("**/api/v1/withdrawals/welcome", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "POSTGREST_SCHEMA_CACHE",
          message: RAW_MESSAGE,
        },
      }),
    });
  });

  await page.goto("/wallet/withdraw");
  await dismissGuidedQuestIfPresent(page);
  const panel = await expectWelcomeWithdrawalPanel(page);
  const requestButton = panel.getByRole("button", {
    name: "입금 없이 첫 출금 요청",
    exact: true,
  });
  await expect(requestButton).toBeEnabled({ timeout: 30_000 });
  await requestButton.click();

  await expect(panel.getByRole("status")).toHaveText(FALLBACK);
  const visible = await panel.innerText();
  expect(visible).not.toContain("withdrawal_requests");
  expect(visible).not.toContain("service_role");
  expect(visible).not.toContain("schema cache");
  expect(visible).not.toContain("does not exist");
  expect(await page.locator("body").innerText()).not.toContain(RAW_MESSAGE);
  expect(hydration).toEqual([]);
});
