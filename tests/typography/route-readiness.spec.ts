import { expect, test } from "@playwright/test";
import { waitForRouteBody } from "./route-readiness";

test("main and a loading shell never count as a ready route", async ({
  page,
}) => {
  await page.setContent(
    '<main><h1>불러오는 중</h1><div data-ui-state="loading" aria-busy="true"></div></main>',
  );
  await expect(waitForRouteBody(page, "/wallet", 250)).rejects.toThrow();
});

test("waits for route content after the shell has appeared", async ({
  page,
}) => {
  await page.setContent("<main><p>불러오는 중</p></main>");
  await page.evaluate(() =>
    window.setTimeout(() => {
      document.querySelector("main")!.innerHTML =
        '<div data-ui-ready="/wallet" data-ui-state="loaded"><h1>내 자산</h1><p>서버에서 확인한 잔액</p></div>';
    }, 100),
  );
  expect(await waitForRouteBody(page, "/wallet", 2_000)).toBe("loaded");
});

test("a different route's marker does not satisfy readiness", async ({
  page,
}) => {
  await page.setContent(
    '<main><div data-ui-ready="/home" data-ui-state="loaded"><h1>홈</h1></div></main>',
  );
  await expect(waitForRouteBody(page, "/wallet", 250)).rejects.toThrow();
});

test("reports genuine empty, error and partial separately", async ({
  page,
}) => {
  for (const state of [
    "empty",
    "error",
    "partial",
    "unknown",
    "offline",
  ] as const) {
    await page.setContent(
      `<main><div data-ui-ready="/kyc" data-ui-state="${state}"><h1>본인 확인 검토</h1><p>${state}</p></div></main>`,
    );
    expect(await waitForRouteBody(page, "/kyc")).toBe(state);
  }
});

test("a ready marker around a skeleton is rejected", async ({ page }) => {
  await page.setContent(
    '<main><div data-ui-ready="/kyc" data-ui-state="loaded"><h1>본인 확인 검토</h1><div aria-busy="true" data-ui-state="loading"></div></div></main>',
  );
  await expect(waitForRouteBody(page, "/kyc")).rejects.toThrow();
});
