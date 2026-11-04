import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { member, operator, adminLogin, adminCommand, sql } from "./helpers";
test("admin practice grant and replay leave historical financial and identity rows byte-for-byte unchanged", async ({
  page,
}) => {
  const user = await member();
  await adminLogin(page, await operator());
  // Global legacy financial rows are already protected by the native pre/post202 snapshot.
  // This is an independent real HTTP grant preservation check, including newly bootstrapped wallets.
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
  const key = randomUUID();
  const input = {
    userId: user.userId,
    amount: 1234,
    reason: "Disposable noncash grant acceptance",
  };
  const granted = await adminCommand(page, "GRANT", input, key);
  expect(granted.status()).toBe(200);
  const original = await granted.json();
  const replay = await adminCommand(page, "GRANT", input, key);
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(original);
  expect(snapshot()).toBe(before);
  expect(
    sql(
      `select balance from app_private.workroom_accounts where user_id='${user.userId}';`,
    ),
  ).toBe("101234");
});
