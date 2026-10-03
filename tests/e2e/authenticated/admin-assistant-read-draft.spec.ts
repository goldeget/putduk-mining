import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { createLocalServiceRoleClient } from "./helpers/eligibility";
import { confirmOperatorStepUp } from "./helpers/admin-money-ui";

test("real admin session prepares a USDT draft without approval or a money write", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const operator = await createConfirmedMember("assistant-read-operator");
  const member = await createConfirmedMember("assistant-read-target");
  await grantAdminRole(operator.userId);
  const secret = await completeAdminLoginWithTotp(
    page,
    operator.email,
    operator.password,
  );
  const db = createLocalServiceRoleClient();
  const depositId = randomUUID();
  const { error: fixtureError } = await db.from("usdt_manual_deposits").insert({
    id: depositId,
    user_id: member.userId,
    network: "TRC20",
    tx_hash: randomUUID().replaceAll("-", "").repeat(2),
    sent_usdt_amount: "10.000001",
    deposit_address_snapshot: "TLOCALASSISTANTFIXTUREDEPOSIT000001",
    network_snapshot: "TRC20",
    idempotency_key: `assistant-read-${depositId}`,
    created_at: "2026-08-01T00:00:00Z",
  });
  expect(fixtureError).toBeNull();
  const url = `${ADMIN_ORIGIN}/api/v1/admin/assistant/prepare`;
  const headers = { origin: ADMIN_ORIGIN };
  const pending = { task: "usdt-deposit-pending" };
  const deniedOrigin = await page.request.post(url, { data: pending });
  expect(deniedOrigin.status()).toBe(403);
  expect((await deniedOrigin.json()).error.code).toBe("ORIGIN_DENIED");

  const before = await db
    .from("usdt_manual_deposits")
    .select("created_at", { count: "exact" })
    .eq("status", "SUBMITTED")
    .order("created_at", { ascending: true })
    .limit(1);
  expect(before.error).toBeNull();
  const snapshot = await page.request.post(url, { headers, data: pending });
  expect(snapshot.status()).toBe(200);
  expect(snapshot.headers()["cache-control"]).toBe("private, no-store");
  const snapshotData = (await snapshot.json()).data;
  expect(snapshotData.count).toBe(before.count);
  expect(Date.parse(snapshotData.oldestAt)).toBe(
    Date.parse(before.data![0]!.created_at),
  );

  const body = {
    task: "usdt-deposit-draft",
    depositId,
    creditedKrw: "50000",
    reason: "운영 도우미 초안만 검토하는 로컬 시험입니다.",
  };
  const prepared = await page.request.post(url, { headers, data: body });
  expect(prepared.status()).toBe(200);
  const draft = (await prepared.json()).data;
  expect(draft.canExecute).toBe(false);
  expect(draft.command).toBe("confirm_usdt_manual_deposit");
  expect(draft.input).toEqual({
    depositId,
    creditedKrw: "50000",
    reason: body.reason,
  });
  expect(Date.parse(draft.expiresAt) - Date.parse(draft.preparedAt)).toBe(
    300_000,
  );
  expect(JSON.stringify(draft)).not.toMatch(
    /stepUpToken|idempotencyKey|user_id|tx_hash|deposit_address|actor/,
  );
  const injected = await page.request.post(url, {
    headers,
    data: { ...body, confirmation: "CONFIRM_USDT_DEPOSIT" },
  });
  expect(injected.status()).toBe(400);

  await page.goto(`${ADMIN_ORIGIN}/assistant`);
  await expect(page.locator('[data-ui-ready="/assistant"]')).toHaveAttribute(
    "data-ui-state",
    "loaded",
  );
  await page
    .getByRole("button", { name: "입금 대기 확인", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "USDT 입금 대기 조회 결과" }),
  ).toContainText("확인 대기");
  await page.getByLabel("입금 신청", { exact: true }).selectOption(depositId);
  await page.getByLabel("반영할 원화 금액", { exact: true }).fill("50000");
  await page.getByLabel("확인 사유", { exact: true }).fill(body.reason);
  await page.getByRole("button", { name: "초안 준비", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "원화 50,000원" }),
  ).toBeVisible();
  // Editing a draft invalidates the old preview before it can be applied.
  await page.getByLabel("반영할 원화 금액", { exact: true }).fill("40000");
  await expect(
    page.getByRole("heading", { name: "원화 50,000원" }),
  ).toHaveCount(0);
  await page.getByLabel("반영할 원화 금액", { exact: true }).fill("50000");
  await page.getByRole("button", { name: "초안 준비", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "원화 50,000원" }),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  for (const width of [320, 390, 834, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["system", "light", "dark"]) {
      await page.getByLabel("화면 테마").selectOption(theme);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`assistant-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await page
    .getByRole("link", { name: "입금 내역에서 검토", exact: true })
    .click();
  const card = page.locator(`#usdt-deposit-${depositId}`);
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "초안 불러오기", exact: true })
    .click();
  const form = card.locator("form");
  await expect(form.getByLabel("반영할 원화 금액")).toHaveValue("50000");
  await expect(form.getByLabel("확인 사유")).toHaveValue(body.reason);
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  await expect(form.locator('input[name="stepUpToken"]')).toHaveValue("");
  await form.getByRole("checkbox").check();
  await confirmOperatorStepUp(form, secret);
  await expect(form.locator('input[name="stepUpToken"]')).toHaveValue(
    /^.{16,}$/,
  );
  await form.getByLabel("반영할 원화 금액").fill("40000");
  await expect(form.getByRole("checkbox")).not.toBeChecked();
  await expect(form.locator('input[name="stepUpToken"]')).toHaveValue("");
  await form.getByRole("checkbox").check();
  await form
    .getByRole("button", { name: "입금 확인 · 원화 반영", exact: true })
    .click();
  await expect(form.getByRole("status")).toContainText("인증 앱으로 다시 확인");
  const deposit = await db
    .from("usdt_manual_deposits")
    .select("status,credited_krw,ledger_transaction_id,wallet_ledger_id")
    .eq("id", depositId)
    .single();
  expect(deposit.error).toBeNull();
  expect(deposit.data).toEqual({
    status: "SUBMITTED",
    credited_krw: null,
    ledger_transaction_id: null,
    wallet_ledger_id: null,
  });
  for (const table of ["ledger_transactions", "wallet_ledger"] as const) {
    const receipts = await db
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("reference_type", "usdt_manual_deposit")
      .eq("reference_id", depositId);
    expect(receipts.error).toBeNull();
    expect(receipts.count).toBe(0);
  }

  // Revocation is scoped to this newly-created test operator, not shared users.
  const revoked = await db
    .from("user_roles")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", operator.userId)
    .eq("role", "ADMIN")
    .is("revoked_at", null);
  expect(revoked.error).toBeNull();
  const deniedRole = await page.request.post(url, { headers, data: pending });
  expect(deniedRole.status()).toBe(403);
  expect((await deniedRole.json()).error.code).toBe("ROLE_REQUIRED");
});
