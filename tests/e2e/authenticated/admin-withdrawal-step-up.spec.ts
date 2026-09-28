import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
  nextTotpCode,
} from "./helpers/admin-totp";
import {
  confirmOperatorStepUp,
  expireOpenStepUpGrants,
  formWithSubmit,
  issueCommandFamilyToken,
  openAdminQueue,
  readConsumedStepUpFamilies,
  setStepUpToken,
  withdrawalCard,
} from "./helpers/admin-money-ui";
import {
  countExternalSends,
  readLatestWithdrawal,
  WELCOME_CAP_KRW,
} from "./helpers/eligibility";
import {
  prepareMemberThroughStart,
  registerFirstKrwDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import { requestWelcomeWithdrawalFromUi } from "./helpers/member-session";

test.describe("WITHDRAWAL_OPERATOR form step-up", () => {
  test.beforeAll(() => {
    requireWithdrawalDataKey();
  });

  test("binds a single-use withdrawal token and rejects the wrong family, reuse, and expiry", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { member } = await prepareMemberThroughStart(page, "ws06-step");
    await registerFirstKrwDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "KRW_BANK");
    const held = await readLatestWithdrawal(member.userId);
    expect(held?.status).toBe("HELD");
    const withdrawalId = held!.id;

    const admin = await createConfirmedMember("ws06-step-admin");
    await grantAdminRole(admin.userId);
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const secret = await completeAdminLoginWithTotp(
      adminPage,
      admin.email,
      admin.password,
    );

    await adminPage.goto(
      `${ADMIN_ORIGIN}/mfa?returnTo=${encodeURIComponent("/withdrawals/krw-bank")}`,
    );
    await adminPage
      .locator('input[inputmode="numeric"]')
      .fill(await nextTotpCode(secret));
    await adminPage.getByRole("button", { name: "인증 완료" }).click();
    await adminPage.waitForURL((url) => !url.pathname.includes("/mfa"), {
      timeout: 60_000,
    });

    await openAdminQueue(adminPage, "/withdrawals/krw-bank");
    const card = withdrawalCard(adminPage, withdrawalId);
    const sendForm = formWithSubmit(card, "계좌 송금 기록");
    await sendForm
      .getByLabel("은행 이체 참조(증빙)")
      .fill(`WS06STEP${withdrawalId.slice(0, 8)}`);
    await sendForm.getByLabel("실제 보낸 원화").fill(String(WELCOME_CAP_KRW));
    await sendForm.getByRole("checkbox", { name: /계좌로 실제 송금/ }).check();

    await sendForm.getByRole("button", { name: "계좌 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    expect(await countExternalSends(withdrawalId)).toBe(0);

    const wrongFamily = await issueCommandFamilyToken(
      adminPage,
      "DEPOSIT_CONFIRM",
    );
    expect(wrongFamily.status).toBe(200);
    expect(wrongFamily.token && wrongFamily.token.length >= 16).toBe(true);
    await setStepUpToken(sendForm, wrongFamily.token!);
    await sendForm.getByRole("button", { name: "계좌 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    expect(await countExternalSends(withdrawalId)).toBe(0);

    await confirmOperatorStepUp(sendForm, secret);
    await expireOpenStepUpGrants(admin.userId);
    await sendForm.getByRole("button", { name: "계좌 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    expect(await countExternalSends(withdrawalId)).toBe(0);

    await confirmOperatorStepUp(sendForm, secret);
    await sendForm.getByRole("button", { name: "계좌 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "계좌 송금을 기록했습니다",
    );
    expect(await countExternalSends(withdrawalId)).toBe(1);
    expect(await readConsumedStepUpFamilies(admin.userId)).toContain(
      "WITHDRAWAL_OPERATOR",
    );

    await sendForm.getByRole("button", { name: "계좌 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    expect(await countExternalSends(withdrawalId)).toBe(1);
    await adminContext.close();
  });
});
