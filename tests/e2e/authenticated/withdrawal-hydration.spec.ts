import { expect, test } from "@playwright/test";

import {
  prepareMemberThroughStart,
  registerFirstKrwDestination,
} from "./helpers/journey";

test("출금 화면은 hydration mismatch를 남기지 않는다", async ({ page }) => {
  const hydration: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("hydration")) {
      hydration.push(text);
    }
  });

  await prepareMemberThroughStart(page, "withdraw-hydration");
  await registerFirstKrwDestination(page);
  hydration.length = 0;

  await page.goto("/wallet/withdraw");
  await expect(
    page.getByRole("button", { name: "다른 목적지로 변경" }),
  ).toBeVisible();
  expect(hydration).toEqual([]);
});
