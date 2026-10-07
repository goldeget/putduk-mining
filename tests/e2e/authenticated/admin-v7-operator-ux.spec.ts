import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  createConfirmedMember,
  createLocalServiceRoleClient,
} from "../fixtures/local-auth";
import { assertTypographyClean } from "../../typography/helpers";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";

test("operator guide and Today search preserve readable, audited operation", async ({
  page,
}, info) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const name = `운영조회${suffix}`;
  const phone = `+8210${String(BigInt(`0x${suffix}`) % 100000000n).padStart(8, "0")}`;
  const member = await createConfirmedMember("v7-today-target", {
    legalName: name,
    phoneE164: phone,
  });
  const db = createLocalServiceRoleClient();
  const identity = await db
    .from("user_identity_profiles")
    .select("login_id")
    .eq("user_id", member.userId)
    .single();
  expect(identity.error).toBeNull();
  const operator = await createConfirmedMember("v7-today-operator");
  await grantAdminRole(operator.userId);
  await completeAdminLoginWithTotp(page, operator.email, operator.password);
  await page.goto(`${ADMIN_ORIGIN}/`);
  await expect(page.getByTestId("admin-today")).toBeVisible();

  for (const query of [name, String(identity.data!.login_id), phone]) {
    await page.getByLabel("이름·아이디·전화번호").fill(query);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/members/search") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "안전 조회" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const payload = await response.json();
    expect(
      payload.data.members.map((row: { userId: string }) => row.userId),
    ).toEqual([member.userId]);
    const results = page.getByRole("list", { name: "회원 검색 결과" });
    await expect(results.getByRole("link")).toHaveCount(1);
    expect(await results.innerText()).not.toContain(phone);
    expect(await results.innerText()).not.toContain(name);
  }

  const guide = page.locator("summary").filter({ hasText: "이 화면 안내" });
  const panel = page.getByRole("region", { name: "운영 화면 사용 안내" });
  const evidence = [];
  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
    for (const { scheme, preference } of [
      { scheme: "dark", preference: "dark" },
      { scheme: "light", preference: "light" },
      { scheme: "dark", preference: "system" },
      { scheme: "light", preference: "system" },
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await page.getByLabel("화면 테마").selectOption(preference);
      for (const scale of [100, 125, 150, 200]) {
        const label = `admin-v7-${width}-${preference}-${scheme}-${scale}`;
        await page.evaluate(async (value) => {
          document.documentElement.style.fontSize = `${(16 * value) / 100}px`;
          await document.fonts.ready;
        }, scale);
        await guide.focus();
        await guide.press("Enter");
        await expect(panel).toBeVisible();
        await expect(panel).toContainText("최신 상태는 본문의 조회 시각");
        await assertTypographyClean(page, label, info);
        const geometry = await panel.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: window.innerWidth,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
        await info.attach(label, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
        await expect(guide).toBeFocused();
        evidence.push({ width, preference, scheme, scale, geometry });
      }
    }
  }
  // At 200% text size, menus below the first screenshot must remain reachable
  // with the keyboard, including the internally scrolling desktop rail.
  const navigationEvidence = [];
  for (const width of [390, 834, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });
    const toggle = page.getByRole("button", { name: "운영 메뉴" });
    const collapsible = await toggle.isVisible();
    if (collapsible) await toggle.click();
    const navigation = page.getByRole("navigation", { name: "운영자 주 메뉴" });
    const links = navigation.getByRole("link");
    await expect(links).toHaveCount(12);
    await links.first().focus();
    for (let index = 0; index < 12; index++) {
      if (index > 0) await page.keyboard.press("Tab");
      await expect(links.nth(index)).toBeFocused();
      await expect(links.nth(index)).toBeInViewport();
    }
    if (collapsible) {
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    navigationEvidence.push({ width, scale: 200, reachableLinks: 12 });
  }
  await info.attach("admin-v7-navigation-keyboard", {
    body: JSON.stringify(navigationEvidence),
    contentType: "application/json",
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await guide.click();
  await panel.getByRole("button", { name: "닫기" }).click();
  await expect(guide).toBeFocused();
  await guide.click();
  await page.getByRole("heading", { name: "회원 바로 찾기" }).click();
  await expect(panel).toBeHidden();
  await info.attach("admin-v7-layout-matrix", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});
