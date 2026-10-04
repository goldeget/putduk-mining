-- Principal lot은 기존 입금 credit과 같은 트랜잭션에서만 생긴다.
-- 둘째 입금은 첫 lot의 effective_at을 바꾸지 않는다.
-- 보너스와 채굴 수익은 lot이 아니다.
-- 부분 원금 회수는 배분이 정해지기 전까지 거절되고 lot을 줄이지 않는다.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table principal_ctx (
  admin_id uuid,
  member_id uuid,
  boundary_id uuid,
  empty_id uuid,
  first_deposit_id uuid,
  second_deposit_id uuid,
  boundary_deposit_id uuid,
  usdt_id uuid,
  first_effective_at timestamptz,
  program_id uuid,
  trial_id uuid,
  conversion_id uuid
);
insert into principal_ctx (admin_id, member_id, boundary_id, empty_id, usdt_id) values (
  '0d470000-0000-4000-8000-0000000000a1',
  '0d470000-0000-4000-8000-000000000101',
  '0d470000-0000-4000-8000-000000000102',
  '0d470000-0000-4000-8000-000000000103',
  '0d470000-0000-4000-8000-00000000d001'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'w1-principal-admin@putduk.test' as email from principal_ctx
  union all select member_id, 'w1-principal-member@putduk.test' from principal_ctx
  union all select boundary_id, 'w1-principal-boundary@putduk.test' from principal_ctx
  union all select empty_id, 'w1-principal-empty@putduk.test' from principal_ctx
) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from principal_ctx;

select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.funding_principal_lots'::regclass), 'principal lots force row security');
select ok((select relrowsecurity and relforcerowsecurity from pg_class
  where oid = 'public.funding_principal_revisions'::regclass), 'principal revisions force row security');
select ok(not has_table_privilege('anon', 'public.funding_principal_lots', 'SELECT')
  and not has_table_privilege('authenticated', 'public.funding_principal_lots', 'SELECT')
  and not has_table_privilege('authenticated', 'public.funding_principal_revisions', 'INSERT'),
  'member and anonymous clients cannot read or append principal lots');
select ok(has_table_privilege('service_role', 'public.funding_principal_lots', 'SELECT')
  and has_table_privilege('service_role', 'public.funding_principal_lots', 'INSERT')
  and not has_table_privilege('service_role', 'public.funding_principal_lots', 'UPDATE')
  and not has_table_privilege('service_role', 'public.funding_principal_lots', 'DELETE')
  and not has_table_privilege('service_role', 'public.funding_principal_revisions', 'UPDATE'),
  'server role can append principal lots and cannot rewrite them');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
  from pg_proc where oid = 'app_private.capture_funding_principal_lot()'::regprocedure)
  and not has_function_privilege('authenticated', 'app_private.read_funding_principal_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.reject_undecided_principal_recovery(uuid,bigint)', 'EXECUTE'),
  'lot capture stays invoker-only and is not a member command');
select ok(not exists (select 1 from public.outbox_events
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    and (status <> 'PENDING' or available_at <> 'infinity'::timestamptz
      or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED')),
  'this foundation does not enable the policy consumer');

grant select, update on principal_ctx to service_role;
set local role service_role;
select public.bootstrap_user((select empty_id from principal_ctx));
select is(
  app_private.read_funding_principal_foundation((select empty_id from principal_ctx))->>'funding_status',
  'FUNDING_BELOW_MINIMUM',
  'a member with no recognized principal is below the minimum');
select is(
  app_private.read_funding_principal_foundation((select empty_id from principal_ctx))->>'eligible_principal_micro_krw',
  '0',
  'known zero principal stays an exact integer string');
select is(
  app_private.read_funding_principal_foundation((select empty_id from principal_ctx))->>'minimum_principal_micro_krw',
  (100000::bigint * 1000000)::text,
  'minimum status uses 100000 KRW as micro-KRW from the published policy');

update principal_ctx set first_deposit_id = public.create_deposit_request(
  member_id, 'KRW', 99999, 'w1-principal-krw-request-1');
select public.approve_deposit_request(first_deposit_id, admin_id, 99999,
  'w1-principal-krw-credit-1', 'fixture bank transfer confirmed', gen_random_uuid()) from principal_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'first KRW approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;

update principal_ctx set first_effective_at = lot.effective_at
from public.funding_principal_lots as lot
where lot.user_id = member_id;
select is((select count(*)::integer from public.funding_principal_lots
  where user_id = (select member_id from principal_ctx)), 1, 'the first approved KRW deposit creates one lot');
select ok((select lot.origin_code = 'KRW_DEPOSIT'
    and lot.amount_atomic = 99999
    and lot.amount_micro_krw = 99999::bigint * 1000000
    and lot.effective_at = movement.effective_at
    and lot.effective_at = journal.posted_at
    and revision.direction = 'INCREASE'
    and revision.delta_micro_krw = lot.amount_micro_krw
    and revision.effective_at = lot.effective_at
  from principal_ctx as ctx
  join public.funding_principal_lots as lot on lot.user_id = ctx.member_id
  join public.money_source_movements as movement on movement.id = lot.money_source_movement_id
  join public.ledger_transactions as journal on journal.id = lot.ledger_transaction_id
  join public.funding_principal_revisions as revision on revision.lot_id = lot.id),
  'the lot and increase revision keep the original journal effective time');
set local role service_role;
select is(
  app_private.read_funding_principal_foundation((select member_id from principal_ctx))->>'funding_status',
  'FUNDING_BELOW_MINIMUM',
  '99999 KRW remains below the real-mining minimum');
select is(
  app_private.read_funding_principal_foundation((select member_id from principal_ctx))->>'eligible_principal_micro_krw',
  (99999::bigint * 1000000)::text,
  'below-minimum principal is exact micro-KRW');
select public.approve_deposit_request(first_deposit_id, admin_id, 99999,
  'w1-principal-krw-credit-1', 'fixture bank transfer confirmed', gen_random_uuid()) from principal_ctx;
reset role;
select is((select count(*)::integer from public.funding_principal_lots
  where user_id = (select member_id from principal_ctx)), 1, 'approval retry does not create a second lot');
select ok((select lot.effective_at = ctx.first_effective_at
  from principal_ctx as ctx
  join public.funding_principal_lots as lot on lot.user_id = ctx.member_id),
  'approval retry keeps the first lot effective time');

set local role service_role;
update principal_ctx set second_deposit_id = public.create_deposit_request(
  member_id, 'KRW', 5000000000, 'w1-principal-krw-request-2');
select public.approve_deposit_request(second_deposit_id, admin_id, 5000000000,
  'w1-principal-krw-credit-2', 'fixture large bank transfer confirmed', gen_random_uuid()) from principal_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'a principal above five billion KRW still completes the original receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select is((select count(*)::integer from public.funding_principal_lots
  where user_id = (select member_id from principal_ctx)), 2, 'the second deposit creates its own lot');
select ok((select lot.effective_at = ctx.first_effective_at and lot.amount_atomic = 99999
  from principal_ctx as ctx
  join public.funding_principal_lots as lot on lot.user_id = ctx.member_id
  where lot.amount_atomic = 99999),
  'the second deposit does not reset the first lot effective time');
select ok((select lot.amount_atomic = 5000000000
    and lot.amount_micro_krw = 5000000000::bigint * 1000000
    and lot.effective_at = journal.posted_at
  from public.funding_principal_lots as lot
  join public.ledger_transactions as journal on journal.id = lot.ledger_transaction_id
  where lot.user_id = (select member_id from principal_ctx) and lot.amount_atomic = 5000000000),
  'five billion KRW is stored as exact bigint micro-KRW');
set local role service_role;
select is(
  app_private.read_funding_principal_foundation((select member_id from principal_ctx))->>'funding_status',
  'FUNDING_MINIMUM_MET',
  'crossing the minimum records status only and does not name a tier');
select is(
  app_private.read_funding_principal_foundation((select member_id from principal_ctx))->>'eligible_principal_micro_krw',
  ((99999 + 5000000000)::bigint * 1000000)::text,
  'eligible principal adds the lots without using a fractional balance');

insert into public.usdt_manual_deposits (
  id, user_id, network, tx_hash, sent_usdt_amount, deposit_address_snapshot, network_snapshot, idempotency_key
)
select usdt_id, member_id, 'TRC20', repeat('7', 64), 10.000001,
  'local-w1-principal-address', 'TRC20', 'w1-principal-usdt-request-1' from principal_ctx;
select public.confirm_usdt_manual_deposit(usdt_id, 7000, admin_id,
  'fixture USDT transfer confirmed', 'w1-principal-usdt-credit-1') from principal_ctx;
select lives_ok($$set constraints usdt_manual_deposits_money_source_complete immediate$$,
  'USDT confirmation still completes the original KRW principal receipt');
set constraints usdt_manual_deposits_money_source_complete deferred;
reset role;
select ok((select lot.origin_code = 'USDT_KRW_DEPOSIT' and lot.amount_atomic = 7000
    and lot.amount_micro_krw = 7000::bigint * 1000000
  from public.funding_principal_lots as lot
  where lot.user_id = (select member_id from principal_ctx) and lot.origin_code = 'USDT_KRW_DEPOSIT'),
  'confirmed USDT leaves a separate KRW principal lot');
select ok((select lot.effective_at = ctx.first_effective_at
  from principal_ctx as ctx
  join public.funding_principal_lots as lot on lot.user_id = ctx.member_id and lot.amount_atomic = 99999),
  'USDT principal credit does not reset the earlier lot');

with program as (
  insert into public.trial_programs(name, version, is_enabled, duration_seconds,
    quota_bps, target_reward_krw, first_result_target_seconds, first_world_id,
    completion_copy, effective_at)
  select 'w1-principal-fixture', 1, false, 86400, 10000, 5000, 60,
    world.id, '체험을 마쳤어요', statement_timestamp() - interval '2 hours'
  from public.asset_worlds as world where world.code = 'KOREA' returning id
)
update principal_ctx set program_id = program.id from program;
with trial as (
  insert into public.trial_accounts(user_id, trial_program_id, trial_program_version,
    world_id, status, started_at, expires_at, last_settled_at, quota_consumed_bps,
    reward_atomic, target_reward_krw)
  select ctx.member_id, ctx.program_id, 1, program.first_world_id, 'COMPLETED',
    statement_timestamp() - interval '1 hour', statement_timestamp(), statement_timestamp(), 10000, 5000, 5000
  from principal_ctx as ctx join public.trial_programs as program on program.id = ctx.program_id returning id
)
update principal_ctx set trial_id = trial.id from trial;
insert into public.trial_completions(trial_account_id, user_id, reason,
  final_quota_bps, final_reward_atomic, completed_at)
select trial_id, member_id, 'QUOTA', 10000, 5000, statement_timestamp() from principal_ctx;
insert into public.kyc_cases(user_id, status, risk_level, decided_at, reviewed_by)
select member_id, 'APPROVED', 'LOW', statement_timestamp(), admin_id from principal_ctx;
set local role service_role;
with converted as (
  select * from public.convert_trial_welcome_reward((select member_id from principal_ctx),
    'w1-principal-welcome-1', gen_random_uuid(), 1, 'w1-principal-risk-1')
)
update principal_ctx set conversion_id = converted.conversion_id from converted;
select lives_ok($$set constraints trial_reward_conversions_money_source_complete immediate$$,
  'welcome conversion still completes without becoming principal');
set constraints trial_reward_conversions_money_source_complete deferred;
reset role;
select ok((select count(*) = 3 from public.funding_principal_lots
    where user_id = (select member_id from principal_ctx))
  and exists (
    select 1 from public.money_source_movements
    where user_id = (select member_id from principal_ctx)
      and source_bucket = 'BONUS' and origin_code = 'WELCOME_REWARD'
  )
  and not exists (
    select 1 from public.funding_principal_lots as lot
    join public.money_source_movements as movement on movement.id = lot.money_source_movement_id
    where lot.user_id = (select member_id from principal_ctx)
      and movement.source_bucket <> 'PRINCIPAL'
  ),
  'welcome bonus is a source credit and not a principal lot');
set local role service_role;
select is(
  app_private.read_funding_principal_foundation((select member_id from principal_ctx))->>'eligible_principal_micro_krw',
  ((99999 + 5000000000 + 7000)::bigint * 1000000)::text,
  'welcome bonus does not increase eligible principal');

select throws_ok($$select app_private.reject_undecided_principal_recovery(
  (select member_id from principal_ctx), 1)$$,
  '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'a partial principal recovery is rejected because lot allocation is undecided');
select throws_ok($$select app_private.reject_undecided_principal_recovery(
  (select member_id from principal_ctx), (99999 + 5000000000 + 7000)::bigint * 1000000)$$,
  '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'a full amount does not bypass the undecided lot allocation');
select throws_ok($$select public.request_krw_withdrawal(
  (select member_id from principal_ctx),
  '0d470000-0000-4000-8000-000000000099',
  1,
  'w1-principal-recovery-closed')$$,
  '55000', 'WITHDRAWAL_VERIFIED_SOURCE_LIFECYCLE_UNAVAILABLE',
  'general withdrawal stays closed and does not spend principal');
reset role;
select ok((select count(*) = 3 and bool_and(lot.effective_at is not null)
    and bool_and(lot.amount_micro_krw = lot.amount_atomic * 1000000)
  from public.funding_principal_lots as lot
  where lot.user_id = (select member_id from principal_ctx))
  and not exists (
    select 1 from public.funding_principal_revisions
    where user_id = (select member_id from principal_ctx) and direction = 'DECREASE'
  ),
  'rejected recovery does not silently reduce any lot');

set local role service_role;
select throws_ok($$
  insert into public.funding_principal_revisions(
    user_id, lot_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    direction, delta_micro_krw, eligible_principal_micro_krw_after, effective_at)
  select lot.user_id, lot.id, lot.money_source_movement_id, lot.ledger_transaction_id,
    lot.source_event_id, 'DECREASE', 1, lot.amount_micro_krw, lot.effective_at
  from public.funding_principal_lots as lot
  where lot.user_id = (select member_id from principal_ctx) and lot.amount_atomic = 99999
$$, '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'a decrease revision cannot choose a lot while allocation is undecided');
select throws_ok($$
  insert into public.funding_principal_lots(
    user_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    origin_code, amount_atomic, amount_micro_krw, effective_at)
  select user_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    'MINING_REWARD', amount_atomic, amount_micro_krw, effective_at
  from public.funding_principal_lots
  where user_id = (select member_id from principal_ctx) and amount_atomic = 7000
$$, '55000', 'FUNDING_PRINCIPAL_ORIGIN_REJECTED',
  'mining reward cannot be inserted as a principal lot');
select throws_ok($$update public.funding_principal_lots set amount_atomic = 1$$,
  '42501', null, 'service role cannot rewrite a principal lot');
reset role;
select throws_ok($$update public.funding_principal_lots set effective_at = statement_timestamp()$$,
  '55000', 'funding_principal_lots is append-only',
  'owner-level changes also cannot reset lot age');

set local role service_role;
update principal_ctx set boundary_deposit_id = public.create_deposit_request(
  boundary_id, 'KRW', 100000, 'w1-principal-boundary-request');
select public.approve_deposit_request(boundary_deposit_id, admin_id, 100000,
  'w1-principal-boundary-credit', 'fixture minimum bank transfer confirmed', gen_random_uuid())
from principal_ctx;
select is(
  app_private.read_funding_principal_foundation((select boundary_id from principal_ctx))->>'funding_status',
  'FUNDING_MINIMUM_MET',
  'exactly 100000 KRW meets the minimum without activating a tier');
select is(
  app_private.read_funding_principal_foundation((select boundary_id from principal_ctx))->>'lot_count',
  '1',
  'the minimum boundary is still one independent lot');
reset role;

insert into public.ledger_transactions (
  category, currency, idempotency_key, reference_type, reference_id,
  member_user_id, request_id, correlation_id, description, created_by
)
select 'ADMIN_ADJUSTMENT', 'KRW', 'w1-principal-admin-adjustment',
  'principal_fixture', gen_random_uuid(), member_id, gen_random_uuid(), gen_random_uuid(),
  'balanced fixture that is not principal', admin_id from principal_ctx;
insert into public.ledger_entries (transaction_id, account_id, sequence, side, amount_atomic)
select journal.id, account.id, leg.sequence, leg.side, 1000
from public.ledger_transactions as journal
cross join principal_ctx as ctx
cross join (values (0::smallint, 'DEBIT'::public.ledger_side, true), (1::smallint, 'CREDIT'::public.ledger_side, false))
  as leg(sequence, side, member_account)
join public.ledger_accounts as account on account.code = case when leg.member_account
  then 'USER:' || upper(ctx.member_id::text) || ':KRW:LIABILITY'
  else 'PUTDUK:OPERATING_CASH:KRW' end
where journal.idempotency_key = 'w1-principal-admin-adjustment';
select lives_ok($$set constraints ledger_entries_balanced_at_commit,
  ledger_transactions_balanced_at_commit immediate$$,
  'a general admin adjustment remains a balanced journal');
set constraints ledger_entries_balanced_at_commit, ledger_transactions_balanced_at_commit deferred;
select is((select count(*)::integer from public.funding_principal_lots
  where user_id = (select member_id from principal_ctx)), 3,
  'a general admin adjustment does not create a principal lot');
set local role service_role;
select is(
  app_private.read_funding_principal_foundation((select member_id from principal_ctx))->>'funding_status',
  'FUNDING_PRINCIPAL_UNRESOLVED',
  'unclassified money stays unresolved instead of a zero principal');
select ok(
  app_private.read_funding_principal_foundation((select member_id from principal_ctx))->>'eligible_principal_micro_krw' is null,
  'unresolved principal is not reported as zero');
reset role;

select * from finish();
rollback;
