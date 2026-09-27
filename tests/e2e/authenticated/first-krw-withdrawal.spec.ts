import { expect, test } from "@playwright/test";

import {
  countExternalSends,
  readLatestWithdrawal,
  readWalletAvailableKrw,
  WELCOME_CAP_KRW,
} from "./helpers/eligibility";
import {
  prepareMemberThroughStart,
  readConversionAmount,
  registerFirstKrwDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import { requestWelcomeWithdrawalFromUi } from "./helpers/member-session";
import {
  finalizeWithdrawalLedger,
  recordKrwExternalSend,
} from "./helpers/operator-commands";

test.describe("first KRW_BANK welcome withdrawal", () => {
  test.beforeAll(() => {
    requireWithdrawalDataKey();
  });

  test("START → convert → hold → external bank evidence → finalize → wallet history", async ({
    page,
  }) => {
    const { member, operator } = await prepareMemberThroughStart(
      page,
      "ws05-krw",
    );

    const conversion = await readConversionAmount(member.userId);
    expect(conversion.status).toBe("CONVERTED");
    expect(conversion.funding_required).toBe(false);
    expect(Number(conversion.converted_amount_atomic)).toBeLessThanOrEqual(
      WELCOME_CAP_KRW,
    );
    expect(Number(conversion.converted_amount_atomic)).toBe(WELCOME_CAP_KRW);

    await registerFirstKrwDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "KRW_BANK");

    await expect(page.getByText("보류").first()).toBeVisible();
    await expect(page.getByText(/가상 채굴/)).toHaveCount(0);

    const held = await readLatestWithdrawal(member.userId);
    expect(held?.status).toBe("HELD");
    expect(held?.destination_type).toBe("KRW_BANK");
    expect(Number(held?.amount_atomic)).toBe(WELCOME_CAP_KRW);
    expect(Number(held?.fee_atomic)).toBe(0);
    expect(held?.welcome_reward_conversion_id).toBe(conversion.id);
    expect(held?.hold_ledger_transaction_id).toBeTruthy();

    const whileHeld = await readWalletAvailableKrw(member.userId);
    expect(Number(whileHeld?.available_balance_atomic)).toBe(0);

    // Production RPC path. Browser admin session/step-up UI is still Agent A.
    await recordKrwExternalSend({
      actorId: operator.userId,
      withdrawalId: held!.id,
      bankReference: `WS05-KRW-${held!.id.slice(0, 8)}`,
      actualKrwAmount: WELCOME_CAP_KRW,
    });
    expect(await countExternalSends(held!.id)).toBe(1);

    const finalizeKey = `ws05-finalize-krw-${held!.id}`;
    const ledgerTx = await finalizeWithdrawalLedger({
      actorId: operator.userId,
      withdrawalId: held!.id,
      idempotencyKey: finalizeKey,
    });
    const ledgerRetry = await finalizeWithdrawalLedger({
      actorId: operator.userId,
      withdrawalId: held!.id,
      idempotencyKey: finalizeKey,
    });
    expect(ledgerRetry).toBe(ledgerTx);
    expect(await countExternalSends(held!.id)).toBe(1);

    const finalized = await readLatestWithdrawal(member.userId);
    expect(["LEDGER_FINALIZED", "COMPLETED"]).toContain(finalized?.status);

    await page.goto("/wallet");
    await expect(page.getByText("PUTDUK START 전환").first()).toBeVisible();
    await expect(
      page.getByText(/환영 보상 첫 출금|출금/).first(),
    ).toBeVisible();
    // 로딩 카피·브랜드 잠금과 구분 — 내비 '채굴' 링크가 보여야 한다.
    await expect(
      page.getByRole("link", { name: "채굴", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/가상 채굴/)).toHaveCount(0);

    const after = await readWalletAvailableKrw(member.userId);
    expect(Number(after?.available_balance_atomic)).toBe(0);
    expect(Number(after?.balance_atomic)).toBe(0);
  });
});
