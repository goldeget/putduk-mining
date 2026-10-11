import { expect, test } from "@playwright/test";

import {
  countExternalSends,
  createLocalServiceRoleClient,
  readLatestWithdrawal,
  WELCOME_CAP_KRW,
} from "./helpers/eligibility";
import {
  prepareMemberThroughStart,
  readConversionAmount,
  registerFirstUsdtDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import { requestWelcomeWithdrawalFromUi } from "./helpers/member-session";
import {
  finalizeWithdrawalLedger,
  recordUsdtExternalSend,
} from "./helpers/operator-commands";

test.describe("first USDT_ADDRESS welcome withdrawal", () => {
  test.beforeAll(() => {
    requireWithdrawalDataKey();
  });

  test("START → convert → USDT hold → manual send evidence → finalize without USDT balance", async ({
    page,
  }) => {
    const { member, operator } = await prepareMemberThroughStart(
      page,
      "ws05-usdt",
    );

    const conversion = await readConversionAmount(member.userId);
    expect(Number(conversion.converted_amount_atomic)).toBe(WELCOME_CAP_KRW);

    await registerFirstUsdtDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "USDT_ADDRESS");

    await expect(page.getByText("보류").first()).toBeVisible();
    await expect(page.getByText(/USDT 잔액|내 USDT/)).toHaveCount(0);
    await expect(page.getByText(/가상 채굴/)).toHaveCount(0);

    const held = await readLatestWithdrawal(member.userId);
    expect(held?.status).toBe("HELD");
    expect(held?.destination_type).toBe("USDT_ADDRESS");
    expect(Number(held?.amount_atomic)).toBe(WELCOME_CAP_KRW);

    const client = createLocalServiceRoleClient();
    const { count: usdtAccounts } = await client
      .from("wallet_balance_snapshots")
      .select("wallet_account_id", { count: "exact", head: true })
      .eq("user_id", member.userId)
      .eq("currency", "USDT");
    expect(usdtAccounts ?? 0).toBe(0);

    const sendKey = `ws05-usdt-send-${held!.id}`;
    const sentAt = new Date().toISOString();
    const txHash = `0xws05manual${held!.id.replaceAll("-", "").slice(0, 40)}`;
    const sendId = await recordUsdtExternalSend({
      actorId: operator.userId,
      withdrawalId: held!.id,
      network: "TRC20",
      txHash,
      // Operator-entered evidence only — not an exchange API quote.
      actualUsdtAmount: "3.85",
      conversionEvidence: {
        source: "manual_operator_record",
        krw_atomic: String(WELCOME_CAP_KRW),
      },
      idempotencyKey: sendKey,
      sentAt,
    });
    expect(await countExternalSends(held!.id)).toBe(1);

    const replayId = await recordUsdtExternalSend({
      actorId: operator.userId,
      withdrawalId: held!.id,
      network: "TRC20",
      txHash,
      actualUsdtAmount: "3.85",
      conversionEvidence: {
        source: "manual_operator_record",
        krw_atomic: String(WELCOME_CAP_KRW),
      },
      idempotencyKey: `${sendKey}-second`,
      sentAt,
    });
    expect(replayId).toBe(sendId);
    expect(await countExternalSends(held!.id)).toBe(1);

    // A new command key can recover the identical transfer, but it cannot
    // replace the original blockchain reference with another transfer's facts.
    await expect(
      recordUsdtExternalSend({
        actorId: operator.userId,
        withdrawalId: held!.id,
        network: "TRC20",
        txHash: `${txHash}b`,
        actualUsdtAmount: "3.85",
        conversionEvidence: {
          source: "manual_operator_record",
          krw_atomic: String(WELCOME_CAP_KRW),
        },
        idempotencyKey: `${sendKey}-changed-payload`,
        sentAt,
      }),
    ).rejects.toThrow("EXTERNAL_SEND_PAYLOAD_MISMATCH");
    expect(await countExternalSends(held!.id)).toBe(1);

    const { data: sendRow } = await client
      .from("withdrawal_external_sends")
      .select("network, tx_hash, actual_usdt_amount, conversion_evidence")
      .eq("withdrawal_id", held!.id)
      .maybeSingle();
    expect(sendRow?.network).toBe("TRC20");
    expect(sendRow?.tx_hash).toBe(txHash);
    expect(String(sendRow?.actual_usdt_amount)).toContain("3.85");
    expect(sendRow?.conversion_evidence).toMatchObject({
      source: "manual_operator_record",
    });

    const finalizeKey = `ws05-finalize-usdt-${held!.id}`;
    await finalizeWithdrawalLedger({
      actorId: operator.userId,
      withdrawalId: held!.id,
      idempotencyKey: finalizeKey,
    });
    await finalizeWithdrawalLedger({
      actorId: operator.userId,
      withdrawalId: held!.id,
      idempotencyKey: finalizeKey,
    });
    expect(await countExternalSends(held!.id)).toBe(1);

    await page.goto("/wallet");
    await expect(page.getByText("PUTDUK START 전환").first()).toBeVisible();
    await expect(page.getByText(/USDT 잔액/)).toHaveCount(0);
  });
});
