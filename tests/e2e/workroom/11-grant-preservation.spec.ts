import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import {
  adminCommand,
  adminLogin,
  adminOrigin,
  member,
  operator,
  sql,
} from "./helpers";
test("admin practice point credits and debits leave historical financial and identity rows byte-for-byte unchanged", async ({
  page,
}) => {
  const user = await member();
  await adminLogin(page, await operator());
  await page.goto(`${adminOrigin}/workroom?tab=users`);
  await expect(
    page.getByRole("heading", { name: "체험 포인트 지급·차감" }),
  ).toBeVisible();
  // Global legacy financial rows are already protected by the native pre/post202 snapshot.
  // This independently verifies signed point adjustments over real HTTP, including newly bootstrapped wallets.
  const preserved = [
    "auth.users",
    "public.user_profiles",
    "public.wallet_accounts",
    "public.wallet_ledger",
    "public.deposit_requests",
    "public.bank_deposits",
    "public.crypto_deposits",
    "public.crypto_transactions",
    "public.withdrawal_requests",
    "public.crypto_withdrawals",
    "public.usdt_deposit_instructions",
    "public.usdt_deposit_instruction_events",
    "public.usdt_manual_deposits",
    "public.withdrawal_destination_history",
    "public.withdrawal_external_sends",
  ];
  const snapshot = () =>
    sql(
      `select md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),'')) from (${preserved.map((table) => `select '${table}' as source,to_jsonb(r) as row from ${table} r`).join(" union all ")})t;`,
    );
  const before = snapshot();
  await page.getByLabel("대상 회원").selectOption(user.userId);
  await page.getByLabel("조정 구분").selectOption("CREDIT");
  await page.getByLabel("포인트 (P)").fill("1234");
  await page
    .getByLabel("지급 사유")
    .fill("Disposable noncash point credit acceptance");
  await page.getByRole("button", { name: "변경 내용 검토" }).click();
  await expect(
    page.getByRole("heading", { name: "변경 내용을 확인해주세요." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "확인하고 저장" }).click();
  await expect(page.getByText("변경 내용이 서버에 기록됐어요.")).toBeVisible();
  const debit = {
    userId: user.userId,
    amount: 234,
    direction: "DEBIT",
    reason: "Disposable noncash point debit acceptance",
  };
  const debitKey = randomUUID();
  const debited = await adminCommand(page, "POINT_ADJUST", debit, debitKey);
  expect(debited.status()).toBe(200);
  const debitReceipt = await debited.json();
  expect(debitReceipt.data.amount).toBe(-234);
  expect(
    await adminCommand(page, "POINT_ADJUST", debit, debitKey).then((res) =>
      res.json(),
    ),
  ).toEqual(debitReceipt);
  expect(snapshot()).toBe(before);
  expect(
    sql(
      `select balance from app_private.workroom_accounts where user_id='${user.userId}';`,
    ),
  ).toBe("101000");
  expect(
    sql(
      `select string_agg(amount::text,',' order by amount) from app_private.workroom_ledger where user_id='${user.userId}' and kind='ADJUSTMENT';`,
    ),
  ).toBe("-234,1234");
});
