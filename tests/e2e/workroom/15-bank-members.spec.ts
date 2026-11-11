import { test, expect } from "@playwright/test";
import { operator, adminLogin, adminOrigin, member, login } from "./helpers";
import { nextTotpCode } from "../authenticated/helpers/admin-totp";

test("administrator publishes receiving account or consultation message and browses signup details without search", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const user = await member();
  const { secret } = await adminLogin(page, await operator());
  await page.goto(`${adminOrigin}/members`);
  await expect(
    page.getByRole("heading", { name: "회원 목록", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: user.loginId, exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: user.loginId, exact: true }).click();
  const detail = page.getByRole("region", { name: "가입 정보", exact: true });
  await expect(detail).toContainText(user.metadata.phone_e164);
  await expect(detail).toContainText(user.metadata.date_of_birth);
  await expect(detail).toContainText(user.email);
  await expect(detail).toContainText("기록 없음");
  const memberContext = await browser.newContext({ baseURL: baseURL! });
  try {
    const memberPage = await memberContext.newPage();
    await login(memberPage, user);
    for (const mode of ["ACCOUNT", "CONTACT"] as const) {
      await page.goto(`${adminOrigin}/deposits/krw`);
      const panel = page.locator("#krw-deposit-instruction");
      await panel.getByLabel("회원에게 표시할 방식").selectOption(mode);
      if (mode === "ACCOUNT") {
        await panel.getByLabel("은행명", { exact: true }).fill("검증은행");
        await panel
          .getByLabel("계좌번호", { exact: true })
          .fill("123-45678901");
        await panel.getByLabel("예금주", { exact: true }).fill("검증회사");
      }
      await panel.getByLabel("상담 안내 문구").fill("1:1 상담 후 계좌 발급");
      await panel
        .getByLabel("변경 사유")
        .fill("폐기형 브라우저 환경 입금 안내 검증");
      await panel.getByRole("checkbox").check();
      await panel
        .getByLabel("인증 앱 코드 (작업 확인)")
        .fill(await nextTotpCode(secret));
      await panel
        .getByRole("button", { name: "작업 확인", exact: true })
        .click();
      await expect(panel.locator('input[name="stepUpToken"]')).not.toHaveValue(
        "",
      );
      await panel
        .getByRole("button", { name: "입금 안내 저장", exact: true })
        .click();
      await expect(
        panel.getByText("입금 안내를 저장했습니다.", { exact: false }),
      ).toBeVisible({ timeout: 30000 });
      await memberPage.goto("/workroom/cash/deposit");
      if (mode === "ACCOUNT") {
        await expect(
          memberPage.locator('[data-krw-instruction="ready"]'),
        ).toContainText("123-45678901");
        await expect(
          memberPage.locator('[data-krw-instruction="ready"]'),
        ).toContainText("검증회사");
      } else {
        await expect(
          memberPage.getByRole("heading", { name: "1:1 상담 후 계좌 발급" }),
        ).toBeVisible();
        await expect(memberPage.getByText("123-45678901")).toHaveCount(0);
      }
    }
  } finally {
    await memberContext.close();
  }
});
