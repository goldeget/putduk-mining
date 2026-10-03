import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";

test.describe("admin Member 360 product states", () => {
  test("authorized empty, invalid lookup, and owned member evidence", async ({
    page,
  }) => {
    const operator = await createConfirmedMember("admin-members-op");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    await page.goto(`${ADMIN_ORIGIN}/members`);
    await expect(
      page.getByRole("heading", { name: "회원 한 사람의 맥락" }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText("조회할 회원을 선택하세요.")).toBeVisible();
    await expect(page.getByLabel("회원 식별자")).toBeVisible();

    await page.getByLabel("회원 식별자").fill("not-a-uuid");
    await page.getByRole("button", { name: "안전 조회" }).click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "올바른 회원 식별자를 입력해 주세요.",
      }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("회원 식별자")).toHaveValue("not-a-uuid");

    const member = await createConfirmedMember("admin-members-target");
    await page.goto(`${ADMIN_ORIGIN}/members?id=${member.userId}`);
    const selectedIdentity = page.locator(".member-identity code");
    await expect(selectedIdentity).toHaveText(member.userId, {
      timeout: 60_000,
    });
    await expect(selectedIdentity).toBeVisible();
    await expect(page.getByText("채굴 · 정산")).toBeVisible();
    // 채굴 건수는 실패를 0으로 위장하지 않는다. SELECT 권한이 있으면 숫자다.
    const miningCard = page.locator(".member-module-grid article").filter({
      hasText: "채굴 · 정산",
    });
    await expect(miningCard.locator("strong")).toHaveText(
      /^(확인 필요|\d[\d,]*)$/,
    );
    await expect(
      page.getByRole("heading", { name: "계정 상태" }),
    ).toBeVisible();
    await expect(page.getByText("입금 기록 없음")).toBeVisible();
    await expect(page.getByText("출금 기록 없음")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByLabel("증거 구역")).toBeVisible();
    await expect(page.getByRole("link", { name: "계정" })).toBeVisible();
  });

  test("unknown member uuid stays non-enumerating", async ({ page }) => {
    const operator = await createConfirmedMember("admin-members-miss");
    await grantAdminRole(operator.userId);
    await completeAdminLoginWithTotp(page, operator.email, operator.password);

    await page.goto(
      `${ADMIN_ORIGIN}/members?id=00000000-0000-4000-8000-000000000099`,
    );
    await expect(
      page.getByRole("heading", { name: "회원을 찾지 못했습니다." }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: "다시 조회" })).toBeVisible();
  });
});
