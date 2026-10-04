import { readFileSync } from "node:fs";

import { execLocalAdminSql } from "./local-db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTGRES_BIGINT_MAX = 9223372036854775807n;
const fixtureUrl = new URL(
  "../../../../supabase/test-fixtures/historical-held-withdrawal.sql",
  import.meta.url,
);
const configUrl = new URL("../../../../supabase/config.toml", import.meta.url);

function assertOwner(ownerId: string) {
  if (!UUID.test(ownerId)) throw new Error("HISTORICAL_FIXTURE_OWNER_INVALID");
}

/** Test-only historical receipt; never a verified earned credit or new withdrawal. */
export function seedHistoricalHeldWithdrawal(input: {
  ownerId: string;
  destinationId: string;
  amountKrw: string;
  key: string;
}) {
  assertOwner(input.ownerId);
  if (!UUID.test(input.destinationId))
    throw new Error("HISTORICAL_FIXTURE_DESTINATION_INVALID");
  if (
    !/^[1-9][0-9]{0,18}$/.test(input.amountKrw) ||
    BigInt(input.amountKrw) > POSTGRES_BIGINT_MAX
  )
    throw new Error("HISTORICAL_FIXTURE_AMOUNT_INVALID");
  if (
    input.key.length < 8 ||
    input.key.length > 200 ||
    input.key.trim() !== input.key ||
    /[\r\n\0]/.test(input.key)
  )
    throw new Error("HISTORICAL_FIXTURE_KEY_INVALID");
  const projectId = readFileSync(configUrl, "utf8").match(
    /^project_id\s*=\s*"([^"]+)"/m,
  )?.[1];
  if (!projectId || !/^putduk-mining(?:-[a-z0-9-]+)?$/.test(projectId))
    throw new Error("HISTORICAL_FIXTURE_PROJECT_REJECTED");
  // The definition and invocation must share the postgres owner connection.
  // psql quoted variables keep even apostrophes in a key out of SQL syntax.
  const output = execLocalAdminSql(
    `\\set QUIET on
begin;
${readFileSync(fixtureUrl, "utf8")}
select pg_temp.seed_historical_held_withdrawal(
  :'owner'::uuid, :'destination'::uuid, :'amount'::bigint, :'key');
commit;`,
    {
      owner: input.ownerId,
      destination: input.destinationId,
      amount: input.amountKrw,
      key: input.key,
    },
  ).trim();
  if (!UUID.test(output)) throw new Error("HISTORICAL_FIXTURE_RESULT_INVALID");
  return output;
}

/** Exact aggregate money evidence, before/after a rejected general command. */
export function readWithdrawalMoneySnapshot(ownerId: string) {
  assertOwner(ownerId);
  return JSON.parse(
    execLocalAdminSql(
      `select json_build_object(
        'requests',(select count(*)::text from public.withdrawal_requests where user_id=:'owner'::uuid),
        'journals',(select count(*)::text from public.ledger_transactions where member_user_id=:'owner'::uuid),
        'walletEntries',(select count(*)::text from public.wallet_ledger where user_id=:'owner'::uuid),
        'sourceMovements',(select count(*)::text from public.money_source_movements where user_id=:'owner'::uuid),
        'withdrawalEvents',(select count(*)::text from public.outbox_events where actor_user_id=:'owner'::uuid and aggregate_type='withdrawal_request'),
        'receipts',(select count(*)::text from public.transaction_receipts where user_id=:'owner'::uuid and source_type='withdrawal_request'),
        'availableKrw',(select app_private.available_krw_balance(id)::text from public.wallet_accounts where user_id=:'owner'::uuid and currency='KRW' and closed_at is null),
        'walletTotal',(select coalesce(sum(case when direction='CREDIT' then amount_atomic else -amount_atomic end),0)::text from public.wallet_ledger where user_id=:'owner'::uuid))`,
      { owner: ownerId },
    ),
  ) as Record<string, string | null>;
}
