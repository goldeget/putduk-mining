-- 일반 원금 회수는 최근 lot부터, 부분 배분까지 나눈다.
-- hold 원장이 연결되기 전에는 채굴 기준 원금을 줄이지 않는다.
-- release는 그 시각부터 복구하고, 그 이전 시각은 예약된 채로 남는다.
-- 확정 채굴 보상은 만들지 않는다.
-- 특정 입금 취소는 원본 lot만 보고, 부족하면 다른 lot으로 넘기지 않는다.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table newest_ctx (
  admin_id uuid,
  tier_id uuid,
  cross_id uuid,
  target_id uuid,
  policy_id uuid,
  destination_type text,
  tier_wallet_id uuid,
  cross_wallet_id uuid,
  target_wallet_id uuid,
  tier_first_deposit_id uuid,
  tier_second_deposit_id uuid,
  tier_redeposit_id uuid,
  cross_first_deposit_id uuid,
  cross_second_deposit_id uuid,
  cross_third_deposit_id uuid,
  target_first_deposit_id uuid,
  target_second_deposit_id uuid,
  tier_request uuid,
  cross_request uuid,
  target_request uuid,
  short_request uuid,
  tier_hold uuid,
  cross_hold uuid,
  target_hold uuid,
  short_hold uuid,
  tier_release uuid,
  redeposit_request uuid,
  redeposit_hold uuid,
  tier_first_effective_at timestamptz,
  tier_second_effective_at timestamptz,
  target_old_lot uuid,
  target_new_lot uuid
);
insert into newest_ctx (admin_id, tier_id, cross_id, target_id) values (
  '0d490000-0000-4000-8000-0000000000a1',
  '0d490000-0000-4000-8000-000000000101',
  '0d490000-0000-4000-8000-000000000102',
  '0d490000-0000-4000-8000-000000000103'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'newest-admin@putduk.test' as email from newest_ctx
  union all select tier_id, 'newest-tier@putduk.test' from newest_ctx
  union all select cross_id, 'newest-cross@putduk.test' from newest_ctx
  union all select target_id, 'newest-target@putduk.test' from newest_ctx
) as person;
insert into public.user_roles (user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from newest_ctx;
grant select, update on newest_ctx to service_role;

select ok(
  (select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'public.funding_principal_recovery_allocations'::regclass)
  and has_table_privilege('service_role', 'public.funding_principal_recovery_allocations', 'INSERT')
  and not has_table_privilege('service_role', 'public.funding_principal_recovery_allocations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.funding_principal_recovery_allocations', 'SELECT')
  and not has_function_privilege(
    'authenticated', 'app_private.apply_principal_recovery_newest_first(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege(
    'anon', 'app_private.preview_principal_recovery_newest_first(uuid,bigint)', 'EXECUTE')
  and not has_function_privilege(
    'authenticated', 'app_private.apply_principal_recovery_original_lot(uuid,uuid,uuid)', 'EXECUTE'),
  'recovery allocation stays server-only and append-only');
select ok(
  position(
    'order by lot.effective_at desc, lot.recorded_at desc, lot.id desc'
    in pg_get_functiondef(
      'app_private.plan_principal_recovery_newest_first(uuid,bigint,timestamptz)'::regprocedure
    )
  ) > 0,
  'newest-first uses effective_at, recorded_at, then stable lot id');

with inserted as (
  insert into public.withdrawal_policies (
    currency, destination_type, version, is_enabled, minimum_amount_atomic,
    fee_atomic, destination_config, effective_at, approved_by
  )
  select 'KRW', 'KRW_BANK', 190401, true, 1, 0,
    '{}'::jsonb, statement_timestamp() - interval '1 minute', admin_id
  from newest_ctx
  returning id, destination_type
)
update newest_ctx set
  policy_id = inserted.id,
  destination_type = inserted.destination_type
from inserted;
select ok((select policy_id is not null and destination_type = 'KRW_BANK' from newest_ctx),
  'a zero-fee KRW withdrawal policy is available for the existing hold writer');

set local role service_role;
select public.bootstrap_user((select tier_id from newest_ctx));
select public.bootstrap_user((select cross_id from newest_ctx));
select public.bootstrap_user((select target_id from newest_ctx));
reset role;
update newest_ctx set tier_wallet_id = wallet.id
from public.wallet_accounts as wallet
where wallet.user_id = tier_id and wallet.currency = 'KRW' and wallet.closed_at is null;
update newest_ctx set cross_wallet_id = wallet.id
from public.wallet_accounts as wallet
where wallet.user_id = cross_id and wallet.currency = 'KRW' and wallet.closed_at is null;
update newest_ctx set target_wallet_id = wallet.id
from public.wallet_accounts as wallet
where wallet.user_id = target_id and wallet.currency = 'KRW' and wallet.closed_at is null;

set local role service_role;
update newest_ctx set tier_first_deposit_id = public.create_deposit_request(
  tier_id, 'KRW', 1000000, 'newest-tier-request-1');
select public.approve_deposit_request(tier_first_deposit_id, admin_id, 1000000,
  'newest-tier-credit-1', 'fixture older principal bank transfer confirmed', gen_random_uuid())
from newest_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the older tier deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select pg_sleep(0.02);
set local role service_role;
update newest_ctx set tier_second_deposit_id = public.create_deposit_request(
  tier_id, 'KRW', 4000000, 'newest-tier-request-2');
select public.approve_deposit_request(tier_second_deposit_id, admin_id, 4000000,
  'newest-tier-credit-2', 'fixture newer principal bank transfer confirmed', gen_random_uuid())
from newest_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the newer tier deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
update newest_ctx set
  tier_first_effective_at = first_lot.effective_at,
  tier_second_effective_at = second_lot.effective_at
from public.funding_principal_lots as first_lot,
  public.funding_principal_lots as second_lot
where first_lot.user_id = tier_id
  and first_lot.amount_atomic = 1000000
  and second_lot.user_id = tier_id
  and second_lot.amount_atomic = 4000000;

set local role service_role;
select is(
  app_private.read_funding_entitlement_foundation((select tier_id from newest_ctx))->>'tier_code',
  'L5',
  'five million KRW is approved L5 before recovery');
select is(
  app_private.read_funding_principal_foundation((select tier_id from newest_ctx))->>'eligible_principal_micro_krw',
  app_private.funding_principal_micro_krw(5000000)::text,
  'mining eligible principal is the full lot sum before a hold');
select throws_ok(
  $$select app_private.preview_principal_recovery_newest_first(
    (select tier_id from newest_ctx),
    app_private.funding_principal_micro_krw(6000000))$$,
  '55000', 'PRINCIPAL_RECOVERY_EXCEEDS_ELIGIBLE',
  'a preview above the remaining principal allocates nothing');
select is(
  (app_private.preview_principal_recovery_newest_first(
    (select tier_id from newest_ctx),
    app_private.funding_principal_micro_krw(2000000))->>'policy_code'),
  'NEWEST_FIRST',
  'preview names NEWEST_FIRST');
select ok(
  (select count(*)::integer = 0
    from public.funding_principal_recovery_allocations
    where user_id = (select tier_id from newest_ctx))
  and app_private.read_funding_principal_foundation((select tier_id from newest_ctx))->>'eligible_principal_micro_krw'
    = app_private.funding_principal_micro_krw(5000000)::text,
  'preview does not reserve principal');
select throws_ok(
  $$select app_private.apply_principal_recovery_newest_first(
    (select tier_id from newest_ctx), '0d490000-0000-4000-8000-000000000901')$$,
  '55000', 'PRINCIPAL_RECOVERY_HOLD_REQUIRED',
  'allocation without a hold journal is rejected');
reset role;

with created as (
  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, user_id, currency, amount_atomic, fee_atomic,
    destination_type, destination_snapshot, idempotency_key
  )
  select tier_wallet_id, policy_id, tier_id, 'KRW', 2000000, 0,
    destination_type, '{}'::jsonb, 'newest-tier-hold-0001'
  from newest_ctx
  returning id
)
update newest_ctx set tier_request = created.id from created;

set local role service_role;
update newest_ctx set tier_hold = app_private.post_withdrawal_hold(
  tier_id, tier_request, 2000000, 'newest-tier-hold-0001', gen_random_uuid());
update public.withdrawal_requests as request
set
  status = 'HELD',
  hold_ledger_transaction_id = ctx.tier_hold,
  hold_posted_at = transaction.posted_at
from newest_ctx as ctx
join public.ledger_transactions as transaction on transaction.id = ctx.tier_hold
where request.id = ctx.tier_request;
select is(
  app_private.funding_principal_mining_eligible_micro(
    (select tier_id from newest_ctx), statement_timestamp()),
  app_private.funding_principal_micro_krw(5000000),
  'the hold journal alone does not reduce mining eligible principal');
select lives_ok(
  $$select app_private.apply_principal_recovery_newest_first(
    (select tier_id from newest_ctx), (select tier_hold from newest_ctx))$$,
  'newest-first allocation follows the existing hold journal');
select is(
  (app_private.apply_principal_recovery_newest_first(
    (select tier_id from newest_ctx), (select tier_hold from newest_ctx))->>'replayed'),
  'true',
  'the same hold allocates only once');
select is(
  app_private.read_funding_principal_foundation((select tier_id from newest_ctx))->>'eligible_principal_micro_krw',
  app_private.funding_principal_micro_krw(3000000)::text,
  'two million is reserved from mining eligible principal after the hold allocation');
select is(
  app_private.read_funding_entitlement_foundation((select tier_id from newest_ctx))->>'tier_code',
  'L4',
  'the remaining three million KRW is approved L4');
select ok(
  (select count(*)::integer = 1
      and bool_and(allocation.policy_code = 'NEWEST_FIRST')
      and bool_and(allocation.allocation_micro_krw = app_private.funding_principal_micro_krw(2000000))
      and bool_and(lot.amount_atomic = 4000000)
      and bool_and(lot.amount_micro_krw = 4000000::bigint * 1000000)
    from public.funding_principal_recovery_allocations as allocation
    join public.funding_principal_lots as lot on lot.id = allocation.lot_id
    where allocation.user_id = (select tier_id from newest_ctx))
  and not exists (
    select 1
    from public.funding_principal_recovery_allocations as allocation
    join public.funding_principal_lots as lot on lot.id = allocation.lot_id
    where allocation.user_id = (select tier_id from newest_ctx)
      and lot.amount_atomic = 1000000
  )
  and (select lot.effective_at = ctx.tier_first_effective_at
    from newest_ctx as ctx
    join public.funding_principal_lots as lot
      on lot.user_id = ctx.tier_id and lot.amount_atomic = 1000000),
  'only the newer lot is partially reserved and the older effective time stays');
select is(
  (select count(*)::integer
    from public.money_source_movements
    where user_id = (select tier_id from newest_ctx)
      and source_bucket in ('MINING_REWARD', 'BONUS')),
  0,
  'ordinary principal recovery does not claw back verified mining reward or bonus');
select ok(
  not exists (
    select 1
    from public.funding_principal_recovery_allocations as allocation
    join public.funding_principal_lots as lot on lot.id = allocation.lot_id
    join public.money_source_movements as movement
      on movement.id = lot.money_source_movement_id
    where allocation.user_id = (select tier_id from newest_ctx)
      and movement.source_bucket is distinct from 'PRINCIPAL'
  ),
  'a recovery allocation never attaches to a non-principal lot');
reset role;
select throws_ok(
  $$update public.funding_principal_recovery_allocations set ordinal = ordinal$$,
  '55000', 'funding_principal_recovery_allocations is append-only',
  'an allocation row cannot be rewritten');
select throws_ok($$
  insert into public.funding_principal_revisions(
    user_id, lot_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    direction, delta_micro_krw, eligible_principal_micro_krw_after, effective_at)
  select lot.user_id, lot.id, lot.money_source_movement_id, lot.ledger_transaction_id,
    lot.source_event_id, 'DECREASE', 1, lot.amount_micro_krw, lot.effective_at
  from public.funding_principal_lots as lot
  where lot.user_id = (select tier_id from newest_ctx) and lot.amount_atomic = 1000000
$$, '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'a decrease without a hold allocation is still rejected');

set local role service_role;
select throws_ok(
  $$select app_private.reject_undecided_principal_recovery(
    (select tier_id from newest_ctx), 1)$$,
  '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'a call without a successful hold still does not reserve principal');
select pg_sleep(0.02);
update newest_ctx set tier_release = public.release_withdrawal_hold(
  tier_request, admin_id, '원금 회수 보류를 취소한다', 'newest-tier-release-0001', 'CANCELLED');
select lives_ok(
  $$select app_private.record_principal_recovery_release(
    (select tier_id from newest_ctx), (select tier_release from newest_ctx))$$,
  'release restores the reservation only after the existing release journal');
select is(
  app_private.read_funding_principal_foundation((select tier_id from newest_ctx))->>'eligible_principal_micro_krw',
  app_private.funding_principal_micro_krw(5000000)::text,
  'after release the full principal is mining eligible again');
select is(
  app_private.funding_principal_mining_eligible_micro(
    (select tier_id from newest_ctx),
    (select transaction.posted_at
      from public.ledger_transactions as transaction
      where transaction.id = (select tier_hold from newest_ctx))
  ),
  app_private.funding_principal_micro_krw(3000000),
  'the held interval stays excluded and is not mined backward');
select is(
  app_private.read_funding_entitlement_foundation((select tier_id from newest_ctx))->>'tier_code',
  'L5',
  'tier follows the restored principal');
select is(
  (select count(*)::integer
    from public.money_source_movements
    where user_id = (select tier_id from newest_ctx)
      and source_bucket = 'MINING_REWARD'),
  0,
  'release does not create a mining reward');
select is(
  (select count(*)::integer from public.funding_principal_lots
    where user_id = (select tier_id from newest_ctx)),
  2,
  'release does not create a replacement lot');
reset role;

set local role service_role;
update newest_ctx set tier_redeposit_id = public.create_deposit_request(
  tier_id, 'KRW', 4000000, 'newest-tier-request-3');
select public.approve_deposit_request(tier_redeposit_id, admin_id, 4000000,
  'newest-tier-credit-3', 'fixture redeposited principal bank transfer confirmed', gen_random_uuid())
from newest_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the redeposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;

with created as (
  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, user_id, currency, amount_atomic, fee_atomic,
    destination_type, destination_snapshot, idempotency_key
  )
  select tier_wallet_id, policy_id, tier_id, 'KRW', 4000000, 0,
    destination_type, '{}'::jsonb, 'newest-tier-hold-0002'
  from newest_ctx
  returning id
)
update newest_ctx set redeposit_request = created.id from created;
set local role service_role;
update newest_ctx set redeposit_hold = app_private.post_withdrawal_hold(
  tier_id, redeposit_request, 4000000, 'newest-tier-hold-0002', gen_random_uuid());
update public.withdrawal_requests as request
set
  status = 'HELD',
  hold_ledger_transaction_id = ctx.redeposit_hold,
  hold_posted_at = transaction.posted_at
from newest_ctx as ctx
join public.ledger_transactions as transaction on transaction.id = ctx.redeposit_hold
where request.id = ctx.redeposit_request;
select lives_ok(
  $$select app_private.apply_principal_recovery_newest_first(
    (select tier_id from newest_ctx), (select redeposit_hold from newest_ctx))$$,
  'a redeposit is a new lot and is consumed before the older same amount');
select ok(
  (select lot.money_source_movement_id is not null
      and allocation.allocation_micro_krw = app_private.funding_principal_micro_krw(4000000)
      and lot.effective_at > ctx.tier_second_effective_at
    from newest_ctx as ctx
    join public.funding_principal_recovery_allocations as allocation
      on allocation.hold_ledger_transaction_id = ctx.redeposit_hold
    join public.funding_principal_lots as lot on lot.id = allocation.lot_id)
  and (select count(*)::integer = 1
    from public.funding_principal_recovery_allocations
    where hold_ledger_transaction_id = (select redeposit_hold from newest_ctx))
  and (select second_lot.effective_at = ctx.tier_second_effective_at
    from newest_ctx as ctx
    join public.funding_principal_lots as second_lot
      on second_lot.user_id = ctx.tier_id and second_lot.amount_atomic = 4000000
     and second_lot.effective_at = ctx.tier_second_effective_at),
  'the redeposit effective time is new and the earlier lot age stays');
reset role;

set local role service_role;
update newest_ctx set cross_first_deposit_id = public.create_deposit_request(
  cross_id, 'KRW', 1000000, 'newest-cross-request-1');
select public.approve_deposit_request(cross_first_deposit_id, admin_id, 1000000,
  'newest-cross-credit-1', 'fixture oldest cross-lot bank transfer confirmed', gen_random_uuid())
from newest_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the oldest cross-lot deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select pg_sleep(0.02);
set local role service_role;
update newest_ctx set cross_second_deposit_id = public.create_deposit_request(
  cross_id, 'KRW', 400000, 'newest-cross-request-2');
select public.approve_deposit_request(cross_second_deposit_id, admin_id, 400000,
  'newest-cross-credit-2', 'fixture middle cross-lot bank transfer confirmed', gen_random_uuid())
from newest_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the middle cross-lot deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select pg_sleep(0.02);
set local role service_role;
update newest_ctx set cross_third_deposit_id = public.create_deposit_request(
  cross_id, 'KRW', 800000, 'newest-cross-request-3');
select public.approve_deposit_request(cross_third_deposit_id, admin_id, 800000,
  'newest-cross-credit-3', 'fixture newest cross-lot bank transfer confirmed', gen_random_uuid())
from newest_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the newest cross-lot deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;

with created as (
  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, user_id, currency, amount_atomic, fee_atomic,
    destination_type, destination_snapshot, idempotency_key
  )
  select cross_wallet_id, policy_id, cross_id, 'KRW', 1200000, 0,
    destination_type, '{}'::jsonb, 'newest-cross-hold-0001'
  from newest_ctx
  returning id
)
update newest_ctx set cross_request = created.id from created;

set local role service_role;
update newest_ctx set cross_hold = app_private.post_withdrawal_hold(
  cross_id, cross_request, 1200000, 'newest-cross-hold-0001', gen_random_uuid());
update public.withdrawal_requests as request
set
  status = 'HELD',
  hold_ledger_transaction_id = ctx.cross_hold,
  hold_posted_at = transaction.posted_at
from newest_ctx as ctx
join public.ledger_transactions as transaction on transaction.id = ctx.cross_hold
where request.id = ctx.cross_request;
select lives_ok(
  $$select app_private.apply_principal_recovery_newest_first(
    (select cross_id from newest_ctx), (select cross_hold from newest_ctx))$$,
  'a recovery that spans two lots still uses the existing hold journal');
select ok(
  (select array_agg(allocation.allocation_micro_krw order by allocation.ordinal)
      = array[
        app_private.funding_principal_micro_krw(800000),
        app_private.funding_principal_micro_krw(400000)
      ]::bigint[]
    from public.funding_principal_recovery_allocations as allocation
    where allocation.hold_ledger_transaction_id = (select cross_hold from newest_ctx))
  and not exists (
    select 1
    from public.funding_principal_recovery_allocations as allocation
    join public.funding_principal_lots as lot on lot.id = allocation.lot_id
    where allocation.hold_ledger_transaction_id = (select cross_hold from newest_ctx)
      and lot.amount_atomic = 1000000
  )
  and app_private.read_funding_principal_foundation((select cross_id from newest_ctx))->>'eligible_principal_micro_krw'
    = app_private.funding_principal_micro_krw(1000000)::text,
  'the newest lot is consumed before the next lot, and the oldest lot remains');
select ok(
  (select event.available_at = 'infinity'::timestamptz
      and event.last_error_code = 'PRINCIPAL_RECOVERY_CONSUMER_NOT_ENABLED'
      and event.status = 'PENDING'
    from public.outbox_events as event
    where event.event_type = 'PRINCIPAL_RECOVERY_HELD.v1'
      and event.aggregate_id = (select cross_hold from newest_ctx)),
  'the recovery event is parked and is not a mining reward consumer');
reset role;

set local role service_role;
update newest_ctx set target_first_deposit_id = public.create_deposit_request(
  target_id, 'KRW', 1000000, 'newest-target-request-1');
select public.approve_deposit_request(target_first_deposit_id, admin_id, 1000000,
  'newest-target-credit-1', 'fixture original lot bank transfer confirmed', gen_random_uuid())
from newest_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the original lot deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select pg_sleep(0.02);
set local role service_role;
update newest_ctx set target_second_deposit_id = public.create_deposit_request(
  target_id, 'KRW', 4000000, 'newest-target-request-2');
select public.approve_deposit_request(target_second_deposit_id, admin_id, 4000000,
  'newest-target-credit-2', 'fixture newer untouched lot bank transfer confirmed', gen_random_uuid())
from newest_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the newer untouched lot deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
update newest_ctx set
  target_old_lot = old_lot.id,
  target_new_lot = new_lot.id
from public.funding_principal_lots as old_lot,
  public.funding_principal_lots as new_lot
where old_lot.user_id = target_id and old_lot.amount_atomic = 1000000
  and new_lot.user_id = target_id and new_lot.amount_atomic = 4000000;

with created as (
  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, user_id, currency, amount_atomic, fee_atomic,
    destination_type, destination_snapshot, idempotency_key
  )
  select target_wallet_id, policy_id, target_id, 'KRW', 500000, 0,
    destination_type, '{}'::jsonb, 'newest-target-hold-0001'
  from newest_ctx
  returning id
)
update newest_ctx set target_request = created.id from created;
with created as (
  insert into public.withdrawal_requests (
    wallet_account_id, withdrawal_policy_id, user_id, currency, amount_atomic, fee_atomic,
    destination_type, destination_snapshot, idempotency_key
  )
  select target_wallet_id, policy_id, target_id, 'KRW', 1500000, 0,
    destination_type, '{}'::jsonb, 'newest-target-hold-0002'
  from newest_ctx
  returning id
)
update newest_ctx set short_request = created.id from created;

set local role service_role;
update newest_ctx set target_hold = app_private.post_withdrawal_hold(
  target_id, target_request, 500000, 'newest-target-hold-0001', gen_random_uuid());
update public.withdrawal_requests as request
set
  status = 'HELD',
  hold_ledger_transaction_id = ctx.target_hold,
  hold_posted_at = transaction.posted_at
from newest_ctx as ctx
join public.ledger_transactions as transaction on transaction.id = ctx.target_hold
where request.id = ctx.target_request;
update newest_ctx set short_hold = app_private.post_withdrawal_hold(
  target_id, short_request, 1500000, 'newest-target-hold-0002', gen_random_uuid());
update public.withdrawal_requests as request
set
  status = 'HELD',
  hold_ledger_transaction_id = ctx.short_hold,
  hold_posted_at = transaction.posted_at
from newest_ctx as ctx
join public.ledger_transactions as transaction on transaction.id = ctx.short_hold
where request.id = ctx.short_request;
select lives_ok(
  $$select app_private.apply_principal_recovery_original_lot(
    (select target_id from newest_ctx),
    (select target_hold from newest_ctx),
    (select target_old_lot from newest_ctx))$$,
  'a targeted reversal reserves the original lot');
select ok(
  (select count(*)::integer = 1
      and bool_and(allocation.policy_code = 'ORIGINAL_LOT_TARGETED')
      and bool_and(allocation.lot_id = ctx.target_old_lot)
      and bool_and(allocation.allocation_micro_krw = app_private.funding_principal_micro_krw(500000))
    from newest_ctx as ctx
    join public.funding_principal_recovery_allocations as allocation
      on allocation.hold_ledger_transaction_id = ctx.target_hold)
  and not exists (
    select 1
    from public.funding_principal_recovery_allocations as allocation
    where allocation.lot_id = (select target_new_lot from newest_ctx)
  ),
  'original-lot reversal does not substitute the newer lot');
select throws_ok(
  $$select app_private.apply_principal_recovery_newest_first(
    (select target_id from newest_ctx), (select target_hold from newest_ctx))$$,
  '55000', 'PRINCIPAL_RECOVERY_POLICY_MIXED',
  'a newest-first pass cannot reuse an original-lot hold');
select throws_ok(
  $$select app_private.apply_principal_recovery_original_lot(
    (select target_id from newest_ctx),
    (select short_hold from newest_ctx),
    (select target_old_lot from newest_ctx))$$,
  '55000', 'PRINCIPAL_RECOVERY_ORIGINAL_LOT_SHORT',
  'a short original lot is not filled from another lot');
select ok(
  (select count(*)::integer = 0
    from public.funding_principal_recovery_allocations
    where hold_ledger_transaction_id = (select short_hold from newest_ctx))
  and app_private.funding_principal_mining_eligible_micro(
    (select target_id from newest_ctx), statement_timestamp())
    = app_private.funding_principal_micro_krw(4500000),
  'the rejected original-lot attempt leaves the newer lot and the successful reservation');
reset role;

select * from finish();
rollback;
