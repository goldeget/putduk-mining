import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createConfirmedMember } from "../fixtures/local-auth";
import {
  ADMIN_ORIGIN,
  completeAdminLoginWithTotp,
  grantAdminRole,
} from "./helpers/admin-totp";
import { createLocalServiceRoleClient } from "./helpers/eligibility";

test("real admin session prepares a USDT draft without approval or a money write", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const operator = await createConfirmedMember("assistant-read-operator");
  const member = await createConfirmedMember("assistant-read-target");
  await grantAdminRole(operator.userId);
  await completeAdminLoginWithTotp(page, operator.email, operator.password);
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
