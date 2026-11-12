import { test, expect } from "@playwright/test";
import {
  operator,
  adminLogin,
  adminOrigin,
  member,
  login,
  sql,
  started,
  command,
} from "./helpers";
import { nextTotpCode } from "../authenticated/helpers/admin-totp";

test("administrator publishes receiving account or consultation message and browses signup details without search", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const user = await member();
  sql(
    `insert into public.member_registration_context(user_id,signup_ip,ip_source,referral_code,workroom_acknowledged) values('${user.userId}',null,'NONE','DISPOSABLE-ACCEPTANCE',true);`,
  );
  const { secret } = await adminLogin(page, await operator());
  await page.goto(`${adminOrigin}/members`);
  await expect(
    page.getByRole("heading", { name: "회원 목록", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: user.loginId, exact: true }),
  ).toBeVisible();
  const directory = page.getByRole("region", {
    name: "가입 회원 목록",
    exact: true,
  });
  await expect(directory).toContainText(
    user.metadata.phone_e164.replace(/^\+82/, "0"),
  );
  await expect(directory).toContainText("900115");
  await expect(
    directory.getByRole("columnheader", {
      name: "뒷자리 첫 숫자",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: user.loginId, exact: true }).click();
  const detail = page.getByRole("region", { name: "가입 정보", exact: true });
  await expect(detail).toContainText(
    user.metadata.phone_e164.replace(/^\+82/, "0"),
  );
  await expect(detail).toContainText(user.metadata.date_of_birth);
  await expect(detail).toContainText("남성");
  await expect(detail).toContainText(user.email);
  await expect(detail).toContainText("기록 없음");
  await expect(
    page.getByRole("heading", { name: "워크룸 이용", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("일부 운영 증거를 불러오지 못했습니다.", { exact: false }),
  ).toHaveCount(0);
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
    await memberPage
      .getByLabel("입금 요청 금액", { exact: false })
      .fill("1000");
    const submitted = memberPage.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/deposits") &&
        response.request().method() === "POST",
    );
    await memberPage
      .getByRole("button", { name: "입금 요청하기", exact: true })
      .click();
    expect((await submitted).status()).toBe(201);
    await page.goto(`${adminOrigin}/deposits/krw`);
    const owner = page.locator(`[data-request-member-id="${user.userId}"]`);
    await expect(owner).toContainText(user.metadata.legal_name);
    await expect(owner).toContainText(user.loginId);
  } finally {
    await memberContext.close();
  }
});

test("member completes an unrecorded birth digit once and administrator sees the supplied value", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(180000);
  const user = await member();
  sql(
    `update public.user_identity_profiles set birth_sex_digit=null where user_id='${user.userId}';`,
  );
  await login(page, user);
  const round = await started(page);
  if (!round.state.active) throw new Error("ROUND_NOT_STARTED");
  expect(
    (await command(page, "FINISH", { id: round.state.active.id })).status(),
  ).toBe(200);
  await expect(
    page.getByRole("link", {
      name: "내 정보에서 한 자리 등록하기 →",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/menu/account");
  const form = page.locator("#birth-digit-completion");
  await form.getByLabel("뒷자리 첫 숫자", { exact: true }).fill("2");
  await form.getByRole("button", { name: "숫자 등록", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(
    sql(
      `select birth_sex_digit from public.user_identity_profiles where user_id='${user.userId}';`,
    ),
  ).toBe("2");
  expect(
    sql(
      `select count(*) from public.audit_logs where target_id='${user.userId}' and action='MEMBER_BIRTH_DIGIT_COMPLETED';`,
    ),
  ).toBe("1");
  const context = await browser.newContext({ baseURL: baseURL! });
  try {
    const admin = await context.newPage();
    await adminLogin(admin, await operator());
    await admin.goto(`${adminOrigin}/members`);
    const row = admin.getByRole("row").filter({
      has: admin.getByRole("link", { name: user.loginId, exact: true }),
    });
    await expect(row.locator('[data-label="뒷자리 첫 숫자"]')).toHaveText("2");
    await expect(row.locator('[data-label="성별"]')).toHaveText("여성");
    await expect(row.locator('[data-label="연락처"]')).toHaveText(
      user.metadata.phone_e164.replace(/^\+82/, "0"),
    );
    await admin.getByRole("link", { name: user.loginId, exact: true }).click();
    await expect(
      admin.getByRole("region", { name: "가입 정보", exact: true }),
    ).toContainText("여성");
    const activity = admin.getByRole("region", {
      name: "모의 참여·포인트 거래 내역",
      exact: true,
    });
    for (const text of [
      "달러환율",
      "1,000",
      "참여 차감",
      "종료 반환",
      "가입 포인트",
    ])
      await expect(activity).toContainText(text);
  } finally {
    await context.close();
  }
});
