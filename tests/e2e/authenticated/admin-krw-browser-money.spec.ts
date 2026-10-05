import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import {
  confirmOperatorStepUp,
  formWithSubmit,
  openAdminQueue,
  readExternalSends,
  readWithdrawalLedger,
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
import { expectSettledRoute } from "./helpers/settled-route";

test.describe("admin browser KRW withdrawal", () => {
  test.beforeAll(() => {
    requireWithdrawalDataKey();
  });

  test("operator form records one bank send, retries ledger finalize, and the member sees completion", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { member } = await prepareMemberThroughStart(page, "ws06-krw");
    await registerFirstKrwDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "KRW_BANK");
    await expect(page.getByText("보류").first()).toBeVisible();

    const held = await readLatestWithdrawal(member.userId);
    expect(held?.status).toBe("HELD");
    expect(held?.destination_type).toBe("KRW_BANK");
    const withdrawalId = held!.id;
    const bankReference = `WS06KRW${withdrawalId.slice(0, 8)}`;

    const admin = await createConfirmedMember("ws06-krw-admin");
    await grantAdminRole(admin.userId);
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const secret = await completeAdminLoginWithTotp(
      adminPage,
      admin.email,
      admin.password,
    );

    await openAdminQueue(adminPage, "/withdrawals/krw-bank");
    const card = withdrawalCard(adminPage, withdrawalId);
    await expect(card).toBeVisible();
    const sendForm = formWithSubmit(card, "계좌 송금 기록");
    await sendForm.getByLabel("은행 이체 참조(증빙)").fill(bankReference);
    await sendForm.getByLabel("실제 보낸 원화").fill(String(WELCOME_CAP_KRW));
    await sendForm.getByRole("checkbox", { name: /계좌로 실제 송금/ }).check();

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

    await sendForm.getByRole("button", { name: "계좌 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    expect(await countExternalSends(withdrawalId)).toBe(1);

    await sendForm
      .getByLabel("은행 이체 참조(증빙)")
      .fill(`WS06RETRY${withdrawalId.slice(0, 8)}`);
    await confirmOperatorStepUp(sendForm, secret);
    await sendForm.getByRole("button", { name: "계좌 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "외부 송금은 이미 기록되어 있습니다",
    );
    const sends = await readExternalSends(withdrawalId);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.bank_reference).toBe(bankReference);

    await adminPage.reload();
    const recorded = withdrawalCard(adminPage, withdrawalId);
    await expect(
      recorded.getByRole("button", { name: "계좌 송금 기록" }),
    ).toHaveCount(0);
    await expect(
      recorded.getByRole("button", { name: "거절 · 보류 해제" }),
    ).toHaveCount(0);
    await expect(
      recorded.getByRole("button", { name: "취소 · 보류 해제" }),
    ).toHaveCount(0);
    const finalizeForm = formWithSubmit(recorded, "원장 확정");
    await finalizeForm
      .getByRole("checkbox", { name: /원장만 확정합니다/ })
      .check();
    await finalizeForm.getByRole("button", { name: "원장 확정" }).click();
    await expect(finalizeForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    const beforeFinalize = await readWithdrawalLedger(withdrawalId);
    expect(beforeFinalize.status).toBe("EXTERNAL_SENT_RECORDED");
    expect(beforeFinalize.finalizeId).toBeNull();
    expect(beforeFinalize.withdrawalLedgerCount).toBe(1);
    expect(await countExternalSends(withdrawalId)).toBe(1);

    await confirmOperatorStepUp(finalizeForm, secret);
    await finalizeForm.getByRole("button", { name: "원장 확정" }).click();
    await expect(finalizeForm.getByRole("status")).toContainText(
      "출금 원장을 확정했습니다",
    );
    const finalized = await readWithdrawalLedger(withdrawalId);
    expect(finalized.status).toBe("COMPLETED");
    expect(finalized.finalizeId).toBeTruthy();
    expect(finalized.withdrawalLedgerCount).toBe(2);

    await confirmOperatorStepUp(finalizeForm, secret);
    await finalizeForm.getByRole("button", { name: "원장 확정" }).click();
    await expect(finalizeForm.getByRole("status")).toContainText(
      "출금 원장은 이미 확정되어 있습니다",
    );
    const retried = await readWithdrawalLedger(withdrawalId);
    expect(retried.finalizeId).toBe(finalized.finalizeId);
    expect(retried.withdrawalLedgerCount).toBe(2);
    expect(await countExternalSends(withdrawalId)).toBe(1);

    await adminPage.reload();
    await expect(withdrawalCard(adminPage, withdrawalId)).toHaveCount(0);
    await adminContext.close();

    await page.goto("/wallet/withdraw");
    // hidden id="S:*"가 같은 완료 문구를 복제한다. 정착된 출금 화면에서 보이는 문구는 하나여야 한다.
    const withdraw = await expectSettledRoute(page, "/wallet/withdraw");
    const completed = withdraw
      .getByText("출금 처리가 완료됐어요.")
      .filter({ visible: true });
    await expect(completed).toHaveCount(1);
    await expect(completed).toBeVisible();
    await expect(page.getByText(/가상 채굴/)).toHaveCount(0);
  });
});
