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
  createLocalServiceRoleClient,
  readLatestWithdrawal,
  WELCOME_CAP_KRW,
} from "./helpers/eligibility";
import {
  prepareMemberThroughStart,
  registerFirstUsdtDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import { requestWelcomeWithdrawalFromUi } from "./helpers/member-session";

/**
 * 운영자가 폼에 직접 적는 증빙 수량이다.
 * 환율, 카탈로그, 회원 USDT 잔액이 아니다.
 */
const OPERATOR_ENTERED_USDT = "4.25";

test.describe("admin browser USDT withdrawal", () => {
  test.beforeAll(() => {
    requireWithdrawalDataKey();
  });

  test("operator form records one manual USDT send against KRW and finalizes once", async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const { member } = await prepareMemberThroughStart(page, "ws06-usdt");
    await registerFirstUsdtDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "USDT_ADDRESS");
    await expect(page.getByText("보류").first()).toBeVisible();
    await expect(page.getByText(/USDT 잔액|내 USDT/)).toHaveCount(0);

    const held = await readLatestWithdrawal(member.userId);
    expect(held?.status).toBe("HELD");
    expect(held?.destination_type).toBe("USDT_ADDRESS");
    expect(Number(held?.amount_atomic)).toBe(WELCOME_CAP_KRW);
    const withdrawalId = held!.id;
    const txHash = `ws06${withdrawalId.replaceAll("-", "").slice(0, 40)}`;

    const client = createLocalServiceRoleClient();
    const { count: usdtAccounts } = await client
      .from("wallet_balance_snapshots")
      .select("wallet_account_id", { count: "exact", head: true })
      .eq("user_id", member.userId)
      .eq("currency", "USDT");
    expect(usdtAccounts ?? 0).toBe(0);

    const admin = await createConfirmedMember("ws06-usdt-admin");
    await grantAdminRole(admin.userId);
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const secret = await completeAdminLoginWithTotp(
      adminPage,
      admin.email,
      admin.password,
    );

    await openAdminQueue(adminPage, "/withdrawals/usdt");
    const card = withdrawalCard(adminPage, withdrawalId);
    await expect(card).toBeVisible();
    const sendForm = formWithSubmit(card, "USDT 외부 송금 기록");
    await sendForm.getByLabel("네트워크").fill("TRC20");
    await sendForm.getByLabel("거래 해시").fill(txHash);
    await sendForm.getByLabel("실제 보낸 USDT").fill(OPERATOR_ENTERED_USDT);
    await sendForm
      .locator('textarea[name="conversionEvidence"]')
      .fill("수동 송금 증빙. 시세 API를 쓰지 않았다.");
    await sendForm
      .getByRole("checkbox", { name: /KRW 잔액 기준 출금/ })
      .check();

    await confirmOperatorStepUp(sendForm, secret);
    await sendForm.getByRole("button", { name: "USDT 외부 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "USDT 외부 송금을 기록했습니다",
    );
    expect(await countExternalSends(withdrawalId)).toBe(1);

    await sendForm.getByLabel("거래 해시").fill(`${txHash}b`);
    await sendForm.getByRole("button", { name: "USDT 외부 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    expect(await countExternalSends(withdrawalId)).toBe(1);

    await confirmOperatorStepUp(sendForm, secret);
    await sendForm.getByRole("button", { name: "USDT 외부 송금 기록" }).click();
    await expect(sendForm.getByRole("status")).toContainText(
      "외부 송금은 이미 기록되어 있습니다",
    );
    const sends = await readExternalSends(withdrawalId);
    expect(sends).toHaveLength(1);
    expect(sends[0]?.network).toBe("TRC20");
    expect(sends[0]?.tx_hash).toBe(txHash);
    expect(String(sends[0]?.actual_usdt_amount)).toContain(
      OPERATOR_ENTERED_USDT,
    );
    expect(sends[0]?.conversion_evidence).toMatchObject({
      note: "수동 송금 증빙. 시세 API를 쓰지 않았다.",
    });

    await adminPage.reload();
    const recorded = withdrawalCard(adminPage, withdrawalId);
    await expect(
      recorded.getByRole("button", { name: "USDT 외부 송금 기록" }),
    ).toHaveCount(0);
    await expect(
      recorded.getByRole("button", { name: "거절 · 보류 해제" }),
    ).toHaveCount(0);
    const finalizeForm = formWithSubmit(recorded, "원장 확정 (재시도)");
    await finalizeForm
      .getByRole("checkbox", { name: /원장만 확정합니다/ })
      .check();
    await finalizeForm
      .getByRole("button", { name: "원장 확정 (재시도)" })
      .click();
    await expect(finalizeForm.getByRole("status")).toContainText(
      "인증 앱으로 다시 확인",
    );
    const beforeFinalize = await readWithdrawalLedger(withdrawalId);
    expect(beforeFinalize.status).toBe("EXTERNAL_SENT_RECORDED");
    expect(beforeFinalize.finalizeId).toBeNull();
    expect(beforeFinalize.withdrawalLedgerCount).toBe(1);

    await confirmOperatorStepUp(finalizeForm, secret);
    await finalizeForm
      .getByRole("button", { name: "원장 확정 (재시도)" })
      .click();
    await expect(finalizeForm.getByRole("status")).toContainText(
      "USDT 출금 원장을 확정했습니다",
    );
    const finalized = await readWithdrawalLedger(withdrawalId);
    expect(finalized.status).toBe("COMPLETED");
    expect(finalized.withdrawalLedgerCount).toBe(2);

    await confirmOperatorStepUp(finalizeForm, secret);
    await finalizeForm
      .getByRole("button", { name: "원장 확정 (재시도)" })
      .click();
    await expect(finalizeForm.getByRole("status")).toContainText(
      "출금 원장은 이미 확정되어 있습니다",
    );
    const retried = await readWithdrawalLedger(withdrawalId);
    expect(retried.finalizeId).toBe(finalized.finalizeId);
    expect(retried.withdrawalLedgerCount).toBe(2);
    expect(await countExternalSends(withdrawalId)).toBe(1);

    const { count: usdtAfter } = await client
      .from("wallet_balance_snapshots")
      .select("wallet_account_id", { count: "exact", head: true })
      .eq("user_id", member.userId)
      .eq("currency", "USDT");
    expect(usdtAfter ?? 0).toBe(0);

    await adminContext.close();
    await page.goto("/wallet/withdraw");
    await expect(page.getByText("출금 처리가 완료됐어요.")).toBeVisible();
    await expect(page.getByText(/USDT 잔액|내 USDT/)).toHaveCount(0);
    await expect(page.getByText(/가상 채굴/)).toHaveCount(0);
  });
});
