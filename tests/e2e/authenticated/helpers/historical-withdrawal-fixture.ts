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
-- Only link the exact existing logical request. This is not a new source grant.
create function pg_temp.seed_bound_historical_held_withdrawal(
  p_owner uuid, p_destination uuid, p_amount bigint, p_key text
) returns uuid language plpgsql security invoker set search_path = pg_catalog
as $bound_historical_fixture$
declare
  v_logical public.withdrawal_logical_requests%rowtype;
  v_request public.withdrawal_requests%rowtype;
  v_id uuid;
begin
  if current_user <> 'postgres' then
    raise exception 'HISTORICAL_FIXTURE_OWNER_ONLY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('putduk-funding-recovery:' || p_owner::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('withdrawal-logical:' || p_owner::text, 0));
  select * into v_logical from public.withdrawal_logical_requests
    where user_id = p_owner and idempotency_key = p_key for update;
  if v_logical.idempotency_key is null or v_logical.user_id is distinct from p_owner
    or v_logical.idempotency_key is distinct from p_key
    or v_logical.destination_id is distinct from p_destination
    or v_logical.amount_krw is distinct from p_amount
    or v_logical.state is distinct from 'DESTINATION_REGISTERED'
    or v_logical.withdrawal_id is not null
    or not exists (select 1 from public.withdrawal_destinations d
      where d.id = p_destination and d.user_id = p_owner
        and d.destination_type = v_logical.method) then
    raise exception 'HISTORICAL_FIXTURE_LOGICAL_BINDING_REQUIRED';
  end if;
  v_id := pg_temp.seed_historical_held_withdrawal(p_owner, p_destination, p_amount, p_key);
  select * into v_request from public.withdrawal_requests where id = v_id;
  if v_request.user_id is distinct from p_owner
    or v_request.idempotency_key is distinct from p_key
    or v_request.destination_type is distinct from v_logical.method
    or v_request.withdrawal_destination_id is distinct from p_destination
    or v_request.amount_atomic is distinct from p_amount
    or v_request.status is distinct from 'HELD' or v_request.hold_posted_at is null then
    raise exception 'HISTORICAL_FIXTURE_RECEIPT_BINDING_REQUIRED';
  end if;
  update public.withdrawal_logical_requests
    set withdrawal_id = v_id, state = 'OUTCOME_UNCERTAIN', updated_at = v_request.hold_posted_at
    where user_id = p_owner and idempotency_key = p_key
      and method = v_request.destination_type and destination_id = p_destination
      and amount_krw = p_amount and withdrawal_id is null;
  if not found or not exists (select 1 from public.withdrawal_logical_requests l
    where l.user_id = p_owner and l.idempotency_key = p_key
      and l.method = v_request.destination_type and l.destination_id = p_destination
      and l.amount_krw = p_amount and l.withdrawal_id = v_id
      and l.state = 'OUTCOME_UNCERTAIN' and l.updated_at = v_request.hold_posted_at) then
    raise exception 'HISTORICAL_FIXTURE_LOGICAL_READBACK_REQUIRED';
  end if;
  return v_id;
end;
$bound_historical_fixture$;
revoke all on function pg_temp.seed_bound_historical_held_withdrawal(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
select pg_temp.seed_bound_historical_held_withdrawal(
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
