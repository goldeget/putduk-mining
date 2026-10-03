begin;

-- BEGIN TEST-ONLY HISTORICAL HOLD FIXTURE
-- Test-only original receipt fixture. Never installed by a migration.
-- pg_temp plus postgres-only execution isolates it from service/public callers.
-- Call inside the owning test transaction; rollback/session end removes it.
-- It represents a source-less historical hold, NOT VERIFIED MINING_REWARD.
create function pg_temp.seed_historical_held_withdrawal(
  p_owner uuid, p_destination uuid, p_amount bigint, p_key text
)
returns uuid language plpgsql security invoker set search_path = pg_catalog
as $historical_fixture$
declare
  v_destination public.withdrawal_destinations%rowtype;
  v_policy public.withdrawal_policies%rowtype;
  v_wallet uuid;
  v_request uuid;
  v_command_request uuid := gen_random_uuid();
  v_journal uuid;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'HISTORICAL_FIXTURE_OWNER_ONLY';
  end if;
  if p_amount is null or p_amount <= 0 or char_length(p_key) not between 8 and 200 then
    raise exception 'INVALID_HISTORICAL_FIXTURE';
  end if;
  if exists (select 1 from public.withdrawal_requests
    where user_id = p_owner and idempotency_key = p_key) then
    raise exception 'HISTORICAL_FIXTURE_ALREADY_EXISTS';
  end if;
  select * into v_destination from public.withdrawal_destinations
  where id = p_destination and user_id = p_owner and verification_status = 'VERIFIED';
  select * into v_policy from public.withdrawal_policies
  where currency = 'KRW' and destination_type = v_destination.destination_type
    and is_enabled and effective_at <= statement_timestamp()
    and (expires_at is null or expires_at > statement_timestamp())
  order by version desc limit 1;
  select id into v_wallet from public.wallet_accounts
  where user_id = p_owner and currency = 'KRW' and closed_at is null;
  if v_destination.id is null or v_policy.id is null or v_wallet is null
    or app_private.available_krw_balance(v_wallet) < p_amount + v_policy.fee_atomic then
    raise exception 'HISTORICAL_FIXTURE_RECEIPT_UNAVAILABLE';
  end if;

  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, withdrawal_destination_id,
    user_id, currency, amount_atomic, fee_atomic, destination_type,
    destination_snapshot, status, idempotency_key
  ) values (
    v_wallet, v_policy.id, v_destination.id, p_owner, 'KRW', p_amount,
    v_policy.fee_atomic, v_destination.destination_type,
    jsonb_build_object('destination_id', v_destination.id,
      'display', v_destination.display_hint, 'verified_at', v_destination.verified_at),
    'REQUESTED', p_key
  ) returning id into v_request;
  v_journal := app_private.post_withdrawal_hold(
    p_owner, v_request, p_amount + v_policy.fee_atomic, p_key, v_command_request
  );
  update public.withdrawal_requests set status = 'HELD',
    hold_ledger_transaction_id = v_journal, hold_posted_at = statement_timestamp()
  where id = v_request;
  insert into public.outbox_events (
    event_type, schema_version, aggregate_type, aggregate_id, actor_user_id,
    payload, correlation_id, request_id, idempotency_key
  ) values (
    'WITHDRAWAL_REQUESTED.v1', 1, 'withdrawal_request', v_request, p_owner,
    jsonb_build_object('user_id', p_owner, 'amount_atomic', p_amount::text,
      'fee_atomic', v_policy.fee_atomic::text, 'currency', 'KRW',
      'destination_type', v_destination.destination_type,
      'hold_ledger_transaction_id', v_journal, 'welcome_reward', false),
    gen_random_uuid(), v_command_request, p_key || ':event'
  );
  insert into public.transaction_receipts (
    receipt_number, user_id, transaction_type, source_type, source_id,
    amount_atomic, currency, status, requested_at, status_timeline
  ) values (
    'PDK-WD-' || upper(replace(v_request::text, '-', '')), p_owner, 'WITHDRAWAL',
    'withdrawal_request', v_request, p_amount, 'KRW', 'HELD', statement_timestamp(),
    jsonb_build_array(
      jsonb_build_object('status', 'REQUESTED', 'at', statement_timestamp()),
      jsonb_build_object('status', 'HELD', 'at', statement_timestamp()))
  );
  return v_request;
end;
$historical_fixture$;
revoke all on function pg_temp.seed_historical_held_withdrawal(uuid, uuid, bigint, text)
  from public, anon, authenticated, service_role;
-- END TEST-ONLY HISTORICAL HOLD FIXTURE


create extension if not exists pgtap with schema extensions;

select plan(35);

-- The closure retains the historical postgres-owned fixture function. Only
-- application/service execution is retired; modern held commands stay reviewed.
select ok(
  to_regprocedure('public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)') is not null,
  'historical seven-argument function is retained rather than dropped'
);
select ok(
  (select pg_get_userbyid(proowner) = 'postgres' and not prosecdef
   from pg_proc
   where oid = 'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)'::regprocedure),
  'historical owner and invoker boundary are retained'
);
select ok(
  not exists (
    select 1 from pg_proc as procedure
    cross join lateral aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) as acl
    where procedure.oid = 'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)'::regprocedure
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no inherited execute grant on the retired signature'
);
select ok(
  not has_function_privilege('anon', 'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)', 'EXECUTE'),
  'anon cannot execute the retired signature'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)', 'EXECUTE'),
  'authenticated cannot execute the retired signature'
);
select ok(
  not has_function_privilege('service_role', 'public.create_withdrawal_request(uuid,uuid,uuid,bigint,text,jsonb,text)', 'EXECUTE'),
  'service_role cannot execute the retired signature'
);
select ok(
  has_function_privilege('service_role', 'public.request_krw_withdrawal(uuid,uuid,bigint,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.request_krw_withdrawal(uuid,uuid,bigint,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.request_krw_withdrawal(uuid,uuid,bigint,text)', 'EXECUTE'),
  'modern four-argument KRW service boundary stays intact'
);
select ok(
  has_function_privilege('service_role', 'public.request_usdt_withdrawal(uuid,uuid,bigint,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.request_usdt_withdrawal(uuid,uuid,bigint,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.request_usdt_withdrawal(uuid,uuid,bigint,text)', 'EXECUTE'),
  'modern four-argument manual-USDT service boundary stays intact'
);
select ok(
  has_function_privilege('service_role', 'public.create_welcome_reward_withdrawal_request(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.create_welcome_reward_withdrawal_request(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.create_welcome_reward_withdrawal_request(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE'),
  'qualified START service boundary stays intact'
);

create temporary table legacy_closure_ctx (
  owner_id uuid not null,
  other_id uuid not null,
  operator_id uuid not null,
  wallet_id uuid,
  deposit_id uuid,
  legacy_policy_id uuid,
  legacy_id uuid,
  bank_destination_id uuid,
  usdt_destination_id uuid,
  bank_id uuid,
  usdt_id uuid
) on commit drop;

insert into legacy_closure_ctx(owner_id, other_id, operator_id) values (
  '1e150001-0000-4000-8000-000000000001',
  '1e150001-0000-4000-8000-000000000002',
  '1e150001-0000-4000-8000-000000000003'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select id, 'authenticated', 'authenticated', email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select owner_id as id, 'legacy-closure-owner@putduk.test' as email from legacy_closure_ctx
  union all select other_id, 'legacy-closure-other@putduk.test' from legacy_closure_ctx
  union all select operator_id, 'legacy-closure-admin@putduk.test' from legacy_closure_ctx
) as users;
insert into public.user_roles(user_id, role, granted_by)
select operator_id, 'ADMIN', operator_id from legacy_closure_ctx;
select public.bootstrap_user((select owner_id from legacy_closure_ctx));
select public.bootstrap_user((select other_id from legacy_closure_ctx));
update legacy_closure_ctx set wallet_id = account.id
from public.wallet_accounts as account
where account.user_id = legacy_closure_ctx.owner_id and account.currency = 'KRW';
update legacy_closure_ctx set deposit_id = public.create_deposit_request(
  owner_id, 'KRW', 50000, 'legacy-closure-deposit-0001'
);
select public.approve_deposit_request(
  deposit_id, operator_id, 50000, 'legacy-closure-credit-0001',
  'repository-local closure fixture deposit', '1e150001-0000-4000-8000-000000000004'
) from legacy_closure_ctx;

insert into public.withdrawal_policies (
  currency, destination_type, version, is_enabled, minimum_amount_atomic,
  fee_atomic, destination_config, effective_at, approved_by, allows_welcome_reward
)
select 'KRW', destination_type, version, true, 1000, 0, '{}'::jsonb,
  statement_timestamp() - interval '1 hour', operator_id, false
from legacy_closure_ctx
cross join (values ('BANK_ACCOUNT', 915000), ('KRW_BANK', 915001), ('USDT_ADDRESS', 915002)) as policies(destination_type, version);
update legacy_closure_ctx set legacy_policy_id = policy.id
from public.withdrawal_policies as policy
where policy.version = 915000 and policy.destination_type = 'BANK_ACCOUNT';

-- This postgres-owner-only historical fixture stays unmodified. It is not an
-- application command, source completeness or permission to create production rows.
update legacy_closure_ctx set legacy_id = public.create_withdrawal_request(
  owner_id, wallet_id, legacy_policy_id, 5000, 'BANK_ACCOUNT',
  '{"display":"***1234","encrypted":{"alg":"A256GCM","v":1}}'::jsonb,
  'legacy-closure-historical-0001'
);
select ok(
  (select request.status = 'REQUESTED' and request.hold_ledger_transaction_id is null
   from public.withdrawal_requests as request
   where request.id = (select legacy_id from legacy_closure_ctx)),
  'postgres historical fixture remains readable without rewriting its status or hold'
);

insert into public.withdrawal_destinations (
  user_id, destination_type, encrypted_value, value_fingerprint, display_hint,
  verification_status, verified_at, protection_until
)
select owner_id, destination_type, decode(repeat('ab', 32), 'hex'), fingerprint, hint,
  'VERIFIED', statement_timestamp() - interval '2 days', statement_timestamp() - interval '1 day'
from legacy_closure_ctx
cross join (values
  ('KRW_BANK', repeat('a', 64), '국민 **1234'),
  ('USDT_ADDRESS', repeat('b', 64), 'TRC20 **1234')
) as destinations(destination_type, fingerprint, hint);
update legacy_closure_ctx set bank_destination_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = legacy_closure_ctx.owner_id and destination.destination_type = 'KRW_BANK';
update legacy_closure_ctx set usdt_destination_id = destination.id
from public.withdrawal_destinations as destination
where destination.user_id = legacy_closure_ctx.owner_id and destination.destination_type = 'USDT_ADDRESS';
grant select, update on legacy_closure_ctx to service_role;

set local role service_role;
select throws_ok(
  $$select public.create_withdrawal_request(
    owner_id, wallet_id, legacy_policy_id, 10000, 'BANK_ACCOUNT',
    '{"display":"***1234","encrypted":{"alg":"A256GCM","v":1}}'::jsonb,
    'legacy-closure-service-denied-0001'
  ) from legacy_closure_ctx$$,
  '42501', 'permission denied for function create_withdrawal_request',
  'funded service caller cannot create a source-free legacy request'
);

select throws_ok($general_source$select public.request_krw_withdrawal(
  owner_id, bank_destination_id, 10000, 'legacy-closure-modern-bank-0001') from legacy_closure_ctx$general_source$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'fresh general request cannot consume unverified total KRW');

reset role;
-- Historical receipt fixture only; never a verified mining/source producer.
update legacy_closure_ctx set bank_id = pg_temp.seed_historical_held_withdrawal(
  owner_id, bank_destination_id, 10000, 'legacy-closure-modern-bank-0001'
);
set local role service_role;
select throws_ok($general_source$select public.request_usdt_withdrawal(
  owner_id, usdt_destination_id, 10000, 'legacy-closure-modern-usdt-0001') from legacy_closure_ctx$general_source$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'fresh general request cannot consume unverified total KRW');

reset role;
-- Historical receipt fixture only; never a verified mining/source producer.
update legacy_closure_ctx set usdt_id = pg_temp.seed_historical_held_withdrawal(
  owner_id, usdt_destination_id, 10000, 'legacy-closure-modern-usdt-0001'
);
set local role service_role;
select ok(
  (select status = 'HELD' and currency = 'KRW' and destination_type = 'KRW_BANK'
    and amount_atomic = 10000 and fee_atomic = 0 and hold_ledger_transaction_id is not null
   from public.withdrawal_requests where id = (select bank_id from legacy_closure_ctx)),
  'explicit historical KRW receipt has its original balanced hold'
);
select ok(
  (select status = 'HELD' and currency = 'KRW' and destination_type = 'USDT_ADDRESS'
    and amount_atomic = 10000 and fee_atomic = 0 and hold_ledger_transaction_id is not null
   from public.withdrawal_requests where id = (select usdt_id from legacy_closure_ctx)),
  'explicit historical manual-USDT receipt holds KRW, never a USDT wallet'
);
select is(
  public.request_krw_withdrawal((select owner_id from legacy_closure_ctx),
    (select bank_destination_id from legacy_closure_ctx), 10000, 'legacy-closure-modern-bank-0001'),
  (select bank_id from legacy_closure_ctx),
  'modern same-key retry returns the original held request'
);
select is(
  (select count(*)::integer from public.withdrawal_requests
   where user_id = (select owner_id from legacy_closure_ctx)
     and idempotency_key in ('legacy-closure-modern-bank-0001', 'legacy-closure-modern-usdt-0001')),
  2, 'modern retry does not duplicate either request'
);
select ok(
  (select count(*) = 2 and bool_and(entry_count = 2 and debit = 10000 and credit = 10000)
   from (
     select transaction_id, count(*) as entry_count,
       sum(amount_atomic) filter (where side = 'DEBIT') as debit,
       sum(amount_atomic) filter (where side = 'CREDIT') as credit
     from public.ledger_entries where transaction_id in (
       select hold_ledger_transaction_id from public.withdrawal_requests
       where id in ((select bank_id from legacy_closure_ctx), (select usdt_id from legacy_closure_ctx))
     ) group by transaction_id
   ) as holds),
  'both modern holds post exactly two balanced entries once'
);
select is(
  (select sum(case when direction = 'CREDIT' then amount_atomic else -amount_atomic end)::bigint
   from public.wallet_ledger where wallet_account_id = (select wallet_id from legacy_closure_ctx)),
  50000::bigint, 'modern hold does not prematurely debit the wallet projection'
);
select is(
  (select count(*)::integer from public.wallet_ledger
   where wallet_account_id = (select wallet_id from legacy_closure_ctx)),
  1, 'denied legacy caller and modern holds add no wallet movement'
);
select is(
  app_private.available_krw_balance((select wallet_id from legacy_closure_ctx)),
  25000::bigint, 'modern availability retains both HELD reservations and historical REQUESTED amount'
);
select throws_ok(
  $$select public.request_krw_withdrawal(owner_id, bank_destination_id, 26000,
    'legacy-closure-modern-insufficient-0001') from legacy_closure_ctx$$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'unconnected general command cannot consume the remaining principal'
);
select is(
  (select count(*)::integer from public.outbox_events
   where event_type = 'WITHDRAWAL_REQUESTED.v1'
     and aggregate_id in ((select bank_id from legacy_closure_ctx), (select usdt_id from legacy_closure_ctx))),
  2, 'modern request outbox receipts remain one per held request'
);
select is(
  (select count(*)::integer from public.transaction_receipts
   where source_type = 'withdrawal_request'
     and source_id in ((select bank_id from legacy_closure_ctx), (select usdt_id from legacy_closure_ctx))),
  2, 'modern transaction receipts remain one per held request'
);
select is(
  (select coverage from public.money_source_summaries
   where user_id = (select owner_id from legacy_closure_ctx)),
  'UNRESOLVED', 'entrypoint closure does not fabricate source completeness for any hold'
);
select is(
  (select count(*)::integer from public.withdrawal_requests
   where idempotency_key = 'legacy-closure-service-denied-0001'),
  0, 'retired service attempt has no request row'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.create_withdrawal_request(
    '1e150001-0000-4000-8000-000000000001'::uuid,
    '1e150001-0000-4000-8000-000000000005'::uuid,
    '1e150001-0000-4000-8000-000000000006'::uuid,
    10000, 'BANK_ACCOUNT', '{"display":"***1234","encrypted":{"v":1}}'::jsonb,
    'legacy-closure-anon-denied-0001')$$,
  '42501', 'permission denied for function create_withdrawal_request',
  'anon is denied at execution of the retired signature'
);
select throws_ok(
  $$select public.request_krw_withdrawal(null::uuid, null::uuid, 10000, 'legacy-closure-anon-bank-0001')$$,
  '42501', 'permission denied for function request_krw_withdrawal',
  'anon still cannot execute modern KRW money commands'
);
select throws_ok(
  $$select public.request_usdt_withdrawal(null::uuid, null::uuid, 10000, 'legacy-closure-anon-usdt-0001')$$,
  '42501', 'permission denied for function request_usdt_withdrawal',
  'anon still cannot execute modern manual-USDT money commands'
);
reset role;

select set_config('request.jwt.claim.sub', '1e150001-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.create_withdrawal_request(
    '1e150001-0000-4000-8000-000000000001'::uuid,
    '1e150001-0000-4000-8000-000000000005'::uuid,
    '1e150001-0000-4000-8000-000000000006'::uuid,
    10000, 'BANK_ACCOUNT', '{"display":"***1234","encrypted":{"v":1}}'::jsonb,
    'legacy-closure-member-denied-0001')$$,
  '42501', 'permission denied for function create_withdrawal_request',
  'authenticated member is denied at execution of the retired signature'
);
select throws_ok(
  $$select public.request_krw_withdrawal(null::uuid, null::uuid, 10000, 'legacy-closure-member-bank-0001')$$,
  '42501', 'permission denied for function request_krw_withdrawal',
  'member cannot bypass the server with the modern KRW command'
);
select throws_ok(
  $$select public.request_usdt_withdrawal(null::uuid, null::uuid, 10000, 'legacy-closure-member-usdt-0001')$$,
  '42501', 'permission denied for function request_usdt_withdrawal',
  'member cannot bypass the server with the modern manual-USDT command'
);
select is(
  (select count(*)::integer from public.withdrawal_requests
   where idempotency_key = 'legacy-closure-historical-0001'),
  1, 'existing owner-only history reader still sees the original historical request'
);
select set_config('request.jwt.claim.sub', '1e150001-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.withdrawal_requests
   where idempotency_key = 'legacy-closure-historical-0001'),
  0, 'another member cannot read that historical request through RLS'
);
reset role;
select is(
  public.create_withdrawal_request((select owner_id from legacy_closure_ctx),
    (select wallet_id from legacy_closure_ctx), (select legacy_policy_id from legacy_closure_ctx),
    5000, 'BANK_ACCOUNT', '{"display":"***1234","encrypted":{"alg":"A256GCM","v":1}}'::jsonb,
    'legacy-closure-historical-0001'),
  (select legacy_id from legacy_closure_ctx),
  'postgres-only historical fixture replay retains the original request identity'
);

set constraints all immediate;
select * from finish();
rollback;
