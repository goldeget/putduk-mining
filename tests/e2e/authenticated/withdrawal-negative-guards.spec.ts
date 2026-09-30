import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  countExternalSends,
  createLocalServiceRoleClient,
  readLatestWithdrawal,
  WELCOME_CAP_KRW,
} from "./helpers/eligibility";
import {
  prepareMemberThroughStart,
  prepareSharedOperator,
  readConversionAmount,
  registerFirstKrwDestination,
  requireWithdrawalDataKey,
} from "./helpers/journey";
import {
  loginAsMember,
  registerDestinationViaProductionApi,
  requestWelcomeWithdrawalFromUi,
} from "./helpers/member-session";
import {
  finalizeWithdrawalLedger,
  recordKrwExternalSend,
  releaseWithdrawalHold,
} from "./helpers/operator-commands";

test.describe("welcome withdrawal negative guards", () => {
  test.beforeAll(() => {
    requireWithdrawalDataKey();
  });

  test("double click and idempotency replay keep a single welcome hold", async ({
    page,
  }) => {
    const { member } = await prepareMemberThroughStart(page, "ws05-dbl");
    await registerFirstKrwDestination(page);
    await page.goto("/wallet/withdraw");

    const button = page.getByRole("button", {
      name: /입금 없이 첫 출금 요청/,
    });
    await button.waitFor({ state: "visible" });
    // 첫 클릭 직후 버튼이 disabled 되어도 이중 제출을 보내 서버 멱등을 검증한다.
    await button.evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });
    // 이중 클릭 후 refresh되면 성공 문구 대신 '이미 접수된…'이 올 수 있어 완료 버튼으로 확인한다.
    await page
      .getByRole("button", { name: "첫 출금 접수 완료" })
      .waitFor({ timeout: 60_000 });

    const client = createLocalServiceRoleClient();
    const { count } = await client
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", member.userId)
      .not("welcome_reward_conversion_id", "is", null);
    expect(count).toBe(1);

    const conversion = await readConversionAmount(member.userId);
    const held = await readLatestWithdrawal(member.userId);
    const destinationId = held
      ? (
          await client
            .from("withdrawal_requests")
            .select("withdrawal_destination_id, withdrawal_policy_id")
            .eq("id", held.id)
            .single()
        ).data
      : null;

    const idempotencyKey = `ws05-welcome-replay-${member.userId}`;
    const replayBody = {
      conversionId: conversion.id,
      destinationId: destinationId?.withdrawal_destination_id,
      policyId: destinationId?.withdrawal_policy_id,
    };
    const first = await page.request.post("/api/v1/withdrawals/welcome", {
      headers: { "Idempotency-Key": idempotencyKey },
      data: replayBody,
    });
    const second = await page.request.post("/api/v1/withdrawals/welcome", {
      headers: { "Idempotency-Key": idempotencyKey },
      data: replayBody,
    });
    // Already exists or returns the same held request — never a second hold.
    expect([200, 201, 409]).toContain(first.status());
    expect([200, 201, 409]).toContain(second.status());

    const { count: afterReplay } = await client
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", member.userId)
      .not("welcome_reward_conversion_id", "is", null);
    expect(afterReplay).toBe(1);
  });

  test("concurrent welcome requests and held double-spend are denied", async ({
    page,
  }) => {
    const { member } = await prepareMemberThroughStart(page, "ws05-race");
    await registerFirstKrwDestination(page);
    await page.goto("/wallet/withdraw");

    const conversion = await readConversionAmount(member.userId);
    const client = createLocalServiceRoleClient();
    const { data: destination } = await client
      .from("withdrawal_destinations")
      .select("id")
      .eq("user_id", member.userId)
      .eq("destination_type", "KRW_BANK")
      .is("replaced_at", null)
      .maybeSingle();
    const { data: policy } = await client
      .from("withdrawal_policies")
      .select("id")
      .eq("destination_type", "KRW_BANK")
      .eq("allows_welcome_reward", true)
      .eq("is_enabled", true)
      .order("effective_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const [a, b] = await Promise.all([
      page.request.post("/api/v1/withdrawals/welcome", {
        headers: { "Idempotency-Key": `ws05-race-a-${member.userId}` },
        data: {
          conversionId: conversion.id,
          destinationId: destination?.id,
          policyId: policy?.id,
        },
      }),
      page.request.post("/api/v1/withdrawals/welcome", {
        headers: { "Idempotency-Key": `ws05-race-b-${member.userId}` },
        data: {
          conversionId: conversion.id,
          destinationId: destination?.id,
          policyId: policy?.id,
        },
      }),
    ]);
    const statuses = [a.status(), b.status()].sort();
    expect(
      statuses.filter((status) => status === 201 || status === 200).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      statuses.some(
        (status) => status === 409 || status === 201 || status === 200,
      ),
    ).toBe(true);

    const { count } = await client
      .from("withdrawal_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", member.userId)
      .not("welcome_reward_conversion_id", "is", null);
    expect(count).toBe(1);

    const held = await readLatestWithdrawal(member.userId);
    const { data: generalPolicy } = await client
      .from("withdrawal_policies")
      .select("id,version")
      .eq("destination_type", "KRW_BANK")
      .eq("is_enabled", true)
      .order("version", { ascending: false })
      .limit(1)
      .single();
    const prepared = await page.request.post("/api/v1/withdrawals/intents", {
      data: {
        method: "KRW_BANK",
        amountKrw: String(WELCOME_CAP_KRW),
        policyId: generalPolicy!.id,
        policyVersion: generalPolicy!.version,
        destinationId: destination?.id,
        destination: null,
      },
    });
    expect(prepared.status()).toBe(201);
    const logicalKey = (await prepared.json()).data.record.key;
    const spend = await page.request.post("/api/v1/withdrawals/hold", {
      headers: { "Idempotency-Key": logicalKey },
      data: {
        method: "KRW_BANK",
        destinationId: destination?.id,
        amountKrw: String(WELCOME_CAP_KRW),
      },
    });
    expect(spend.status()).toBe(409);
    expect((await spend.json()).error.code).toBe(
      "INSUFFICIENT_AVAILABLE_BALANCE",
    );
    expect(held?.status).toBe("HELD");
  });

  test("replacement cooldown blocks withdraw until protection ends", async ({
    page,
  }) => {
    const { member } = await prepareMemberThroughStart(page, "ws05-cool");
    await registerFirstKrwDestination(page);
    await registerDestinationViaProductionApi(page, {
      method: "KRW_BANK",
      accountHolder: "퍼뜩변경",
      accountNumber: "110987654321",
      bankCode: "SHINHAN",
    });

    await page.goto("/wallet/withdraw");
    // 보호 안내가 요약·상세 두 곳에 있을 수 있다.
    await expect(
      page.getByText(/보호 대기 시간이|보호 시간이/).first(),
    ).toBeVisible();

    const conversion = await readConversionAmount(member.userId);
    const client = createLocalServiceRoleClient();
    const { data: destination } = await client
      .from("withdrawal_destinations")
      .select("id, protection_until")
      .eq("user_id", member.userId)
      .eq("destination_type", "KRW_BANK")
      .is("replaced_at", null)
      .maybeSingle();
    expect(new Date(destination!.protection_until).getTime()).toBeGreaterThan(
      Date.now() - 1000,
    );

    const { data: policy } = await client
      .from("withdrawal_policies")
      .select("id")
      .eq("destination_type", "KRW_BANK")
      .eq("allows_welcome_reward", true)
      .eq("is_enabled", true)
      .order("effective_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const blocked = await page.request.post("/api/v1/withdrawals/welcome", {
      headers: { "Idempotency-Key": `ws05-cool-${member.userId}` },
      data: {
        conversionId: conversion.id,
        destinationId: destination?.id,
        policyId: policy?.id,
      },
    });
    expect(blocked.status()).toBe(409);
  });

  test("REJECTED once and CANCELLED once; no release after EXTERNAL_SENT", async ({
    page,
  }) => {
    const operator = await prepareSharedOperator();

    const rejected = await prepareMemberThroughStart(page, "ws05-rej");
    await registerFirstKrwDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "KRW_BANK");
    const rejectedHold = await readLatestWithdrawal(rejected.member.userId);
    await releaseWithdrawalHold({
      actorId: operator.userId,
      withdrawalId: rejectedHold!.id,
      reason: "WS-05 rejected once evidence",
      disposition: "REJECTED",
      idempotencyKey: `ws05-reject-${rejectedHold!.id}`,
    });
    await expect(
      releaseWithdrawalHold({
        actorId: operator.userId,
        withdrawalId: rejectedHold!.id,
        reason: "WS-05 rejected once evidence",
        disposition: "REJECTED",
        idempotencyKey: `ws05-reject-${rejectedHold!.id}`,
      }),
    ).resolves.toBeTruthy();
    const afterReject = await readLatestWithdrawal(rejected.member.userId);
    expect(afterReject?.status).toBe("REJECTED");

    const cancelled = await prepareMemberThroughStart(page, "ws05-can");
    await registerFirstKrwDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "KRW_BANK");
    const cancelledHold = await readLatestWithdrawal(cancelled.member.userId);
    await releaseWithdrawalHold({
      actorId: operator.userId,
      withdrawalId: cancelledHold!.id,
      reason: "WS-05 cancelled once evidence",
      disposition: "CANCELLED",
      idempotencyKey: `ws05-cancel-${cancelledHold!.id}`,
    });
    const afterCancel = await readLatestWithdrawal(cancelled.member.userId);
    expect(afterCancel?.status).toBe("CANCELLED");

    const sent = await prepareMemberThroughStart(page, "ws05-sent");
    await registerFirstKrwDestination(page);
    await requestWelcomeWithdrawalFromUi(page, "KRW_BANK");
    const sentHold = await readLatestWithdrawal(sent.member.userId);
    await recordKrwExternalSend({
      actorId: operator.userId,
      withdrawalId: sentHold!.id,
      bankReference: `WS05-SENT-${sentHold!.id.slice(0, 8)}`,
      actualKrwAmount: WELCOME_CAP_KRW,
    });
    await expect(
      releaseWithdrawalHold({
        actorId: operator.userId,
        withdrawalId: sentHold!.id,
        reason: "must not release after external send",
        disposition: "CANCELLED",
        idempotencyKey: `ws05-norelease-${sentHold!.id}`,
      }),
    ).rejects.toThrow(/EXTERNAL_SEND|FORBIDDEN|RELEASE/i);

    const finalizeKey = `ws05-fin-sent-${sentHold!.id}`;
    await finalizeWithdrawalLedger({
      actorId: operator.userId,
      withdrawalId: sentHold!.id,
      idempotencyKey: finalizeKey,
    });
    await finalizeWithdrawalLedger({
      actorId: operator.userId,
      withdrawalId: sentHold!.id,
      idempotencyKey: finalizeKey,
    });
    expect(await countExternalSends(sentHold!.id)).toBe(1);
  });

  test("two users cannot observe each other withdrawal rows", async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const preparedA = await prepareMemberThroughStart(pageA, "ws05-iso-a");
    await registerFirstKrwDestination(pageA);
    await requestWelcomeWithdrawalFromUi(pageA, "KRW_BANK");
    const holdA = await readLatestWithdrawal(preparedA.member.userId);

    const memberB = await createConfirmedMember("ws05-iso-b");
    await loginAsMember(pageB, memberB, "/wallet");
    await pageB.goto("/wallet/withdraw");
    await expect(pageB.getByText(holdA!.id)).toHaveCount(0);

    const leak = await pageB.request.get("/api/v1/wallet/summary");
    if (leak.ok()) {
      const body = await leak.text();
      expect(body).not.toContain(holdA!.id);
      expect(body).not.toContain(preparedA.member.userId);
    }

    const client = createLocalServiceRoleClient();
    const { data: visibleToB, error } = await client
      .from("withdrawal_requests")
      .select("id")
      .eq("id", holdA!.id)
      .eq("user_id", memberB.userId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(visibleToB).toBeNull();

    await contextA.close();
    await contextB.close();
  });
});
