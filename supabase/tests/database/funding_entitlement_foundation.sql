-- 자격 기초 조회만 증명한다.
-- 100000 KRW 미만은 등급이 없다.
-- 등급과 base/retention은 발행된 policy와 같다.
-- retention은 확정 잔액이 아니다.
-- 보너스와 채굴 수익은 원금이 아니다.
-- 둘째 lot은 첫 lot의 effective_at을 바꾸지 않는다.
-- 부분 원금 회수 배분은 계속 거절된다.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table entitlement_ctx (
  admin_id uuid,
  zero_id uuid,
  below_id uuid,
  band_id uuid,
  edge_id uuid,
  elite_id uuid,
  below_deposit_id uuid,
  band_first_deposit_id uuid,
  band_second_deposit_id uuid,
  edge_deposit_id uuid,
  elite_deposit_id uuid,
  band_first_effective_at timestamptz,
  program_id uuid,
  trial_id uuid,
  conversion_id uuid
);
insert into entitlement_ctx (admin_id, zero_id, below_id, band_id, edge_id, elite_id) values (
  '0e2e0000-0000-4000-8000-0000000000a1',
  '0e2e0000-0000-4000-8000-000000000100',
  '0e2e0000-0000-4000-8000-000000000101',
  '0e2e0000-0000-4000-8000-000000000102',
  '0e2e0000-0000-4000-8000-000000000103',
  '0e2e0000-0000-4000-8000-000000000104'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'w2-entitlement-admin@putduk.test' as email from entitlement_ctx
  union all select zero_id, 'w2-entitlement-zero@putduk.test' from entitlement_ctx
  union all select below_id, 'w2-entitlement-below@putduk.test' from entitlement_ctx
  union all select band_id, 'w2-entitlement-band@putduk.test' from entitlement_ctx
  union all select edge_id, 'w2-entitlement-edge@putduk.test' from entitlement_ctx
  union all select elite_id, 'w2-entitlement-elite@putduk.test' from entitlement_ctx
) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from entitlement_ctx;
grant select, update on entitlement_ctx to service_role;

select ok(
  (select not prosecdef
      and provolatile = 'v'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'app_private.read_funding_entitlement_foundation(uuid)'::regprocedure)
  and not has_function_privilege('public', 'app_private.read_funding_entitlement_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_entitlement_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.read_funding_entitlement_foundation(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'app_private.read_funding_entitlement_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.funding_entitlement_portion_micro(bigint,bigint)', 'EXECUTE'),
  'entitlement qualification is an invoker-only service read');
select ok(
  position('1500' in pg_get_functiondef('app_private.read_funding_entitlement_foundation(uuid)'::regprocedure)) = 0
  and position('499999' in pg_get_functiondef('app_private.read_funding_entitlement_foundation(uuid)'::regprocedure)) = 0
  and position('5000000000' in pg_get_functiondef('app_private.read_funding_entitlement_foundation(uuid)'::regprocedure)) = 0
  and position('wallet_ledger' in pg_get_functiondef('app_private.read_funding_entitlement_foundation(uuid)'::regprocedure)) = 0
  and position('insert into public.ledger' in lower(pg_get_functiondef(
    'app_private.read_funding_entitlement_foundation(uuid)'::regprocedure))) = 0,
  'tier bands are not copied into the function and it does not post a ledger credit');
select ok(not exists (select 1 from public.outbox_events
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    and (status <> 'PENDING' or available_at <> 'infinity'::timestamptz
      or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED')),
  'entitlement qualification does not enable the policy consumer');

set local role authenticated;
select throws_ok(
  $$select app_private.read_funding_entitlement_foundation(null)$$,
  '42501', null,
  'a member cannot read entitlement qualification');
reset role;

set local role service_role;
select throws_ok(
  $$select app_private.read_funding_entitlement_foundation(null)$$,
  '22023', 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND',
  'qualification requires a member');
select public.bootstrap_user((select zero_id from entitlement_ctx));
select is(
  app_private.read_funding_entitlement_foundation((select zero_id from entitlement_ctx))->>'funding_status',
  'FUNDING_BELOW_MINIMUM',
  'zero principal is below the minimum');
select is(
  app_private.read_funding_entitlement_foundation((select zero_id from entitlement_ctx))->>'tier_activated',
  'false',
  'zero principal does not activate a tier');
select ok(
  app_private.read_funding_entitlement_foundation((select zero_id from entitlement_ctx))->>'tier_code' is null
  and app_private.read_funding_entitlement_foundation((select zero_id from entitlement_ctx))->>'base_entitlement_micro_krw' is null
  and app_private.read_funding_entitlement_foundation((select zero_id from entitlement_ctx))->>'retention_entitlement_micro_krw' is null
  and app_private.read_funding_entitlement_foundation((select zero_id from entitlement_ctx))->>'retention_verified_credit' = 'false',
  'zero principal has no base or retention entitlement');
reset role;

set local role service_role;
update entitlement_ctx set below_deposit_id = public.create_deposit_request(
  below_id, 'KRW', 99999, 'w2-entitlement-below-request');
select public.approve_deposit_request(below_deposit_id, admin_id, 99999,
  'w2-entitlement-below-credit', 'fixture bank transfer confirmed', gen_random_uuid())
from entitlement_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'below-minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select is(
  app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'funding_status',
  'FUNDING_BELOW_MINIMUM',
  '99999 KRW is FUNDING_BELOW_MINIMUM');
select is(
  app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'eligible_principal_micro_krw',
  (99999::bigint * 1000000)::text,
  'below-minimum principal is the lot micro-KRW sum');
select is(
  app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'tier_activated',
  'false',
  'below-minimum principal does not activate a tier');
select ok(
  app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'tier_code' is null
  and not (app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx)) ? 'slots'),
  'below-minimum result has no tier code or slot count');
reset role;

set local role service_role;
update entitlement_ctx set band_first_deposit_id = public.create_deposit_request(
  band_id, 'KRW', 100000, 'w2-entitlement-band-request-1');
select public.approve_deposit_request(band_first_deposit_id, admin_id, 100000,
  'w2-entitlement-band-credit-1', 'fixture minimum bank transfer confirmed', gen_random_uuid())
from entitlement_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
update entitlement_ctx set band_first_effective_at = lot.effective_at
from public.funding_principal_lots as lot
where lot.user_id = band_id and lot.amount_atomic = 100000;
set local role service_role;
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'tier_code',
  'L1',
  '100000 KRW selects approved L1');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'base_cycle_rate_bps',
  '1500',
  'approved base cycle rate is 1500 bps');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'base_cycle_rate_bps',
  (select policy.config->>'baseCycleRateBps'
    from app_private.economy_policy_published as policy
    where policy.policy_version = 'PUTDUK-MINING-V1-2026-10-03'),
  'base rate is read from the published policy row');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'base_entitlement_micro_krw',
  (100000::bigint * 1500 * 1000000 / 10000)::text,
  'L1 base entitlement is 15000 KRW in micro-KRW');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_bonus_bps',
  '1500',
  'approved L1 retention rate is 1500 bps');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_entitlement_micro_krw',
  (100000::bigint * 1500 * 1000000 / 10000)::text,
  'L1 retention amount is calculated separately from base');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_qualification',
  'UNCONFIRMED',
  'retention qualification is unconfirmed');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_verified_credit',
  'false',
  'retention is not a verified credit');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'ledger_credit_created',
  'false',
  'qualification does not claim a ledger credit');
select ok(
  not app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx)) ? 'slots'
  and not app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx)) ? 'product_multiplier_bps'
  and not app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx)) ? 'campaign'
  and not app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx)) ? 'verified_balance_micro_krw',
  'slot, product multiplier, campaign cap and verified balance are outside this result');

update entitlement_ctx set band_second_deposit_id = public.create_deposit_request(
  band_id, 'KRW', 400000, 'w2-entitlement-band-request-2');
select public.approve_deposit_request(band_second_deposit_id, admin_id, 400000,
  'w2-entitlement-band-credit-2', 'fixture added bank transfer confirmed', gen_random_uuid())
from entitlement_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the second deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select ok((select lot.effective_at = ctx.band_first_effective_at and lot.amount_atomic = 100000
  from entitlement_ctx as ctx
  join public.funding_principal_lots as lot on lot.user_id = ctx.band_id
  where lot.amount_atomic = 100000),
  'the second lot does not change the first lot effective time');
select is((select count(*)::integer from public.funding_principal_lots
  where user_id = (select band_id from entitlement_ctx)), 2,
  'the second deposit keeps its own lot');
set local role service_role;
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'tier_code',
  'L2',
  '500000 KRW selects approved L2');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'eligible_principal_micro_krw',
  (500000::bigint * 1000000)::text,
  'eligible principal is the sum of the two lots');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_bonus_bps',
  (select tier.item->>'retentionBonusBps'
    from app_private.economy_policy_published as policy
    cross join lateral jsonb_array_elements(policy.config->'tiers') as tier(item)
    where policy.policy_version = 'PUTDUK-MINING-V1-2026-10-03'
      and tier.item->>'code' = 'L2'),
  'L2 retention rate is the published tier row');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_bonus_bps',
  '1600',
  'approved L2 retention rate is 1600 bps');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'base_entitlement_micro_krw',
  (500000::bigint * 1500 * 1000000 / 10000)::text,
  'L2 base entitlement uses the shared base rate');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_entitlement_micro_krw',
  (500000::bigint * 1600 * 1000000 / 10000)::text,
  'L2 retention entitlement is separate from base');
select ok(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'base_entitlement_micro_krw'
    is distinct from app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_entitlement_micro_krw'
  and app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'retention_verified_credit' = 'false',
  'different base and retention amounts stay unverified');
reset role;

set local role service_role;
update entitlement_ctx set edge_deposit_id = public.create_deposit_request(
  edge_id, 'KRW', 499999, 'w2-entitlement-edge-request');
select public.approve_deposit_request(edge_deposit_id, admin_id, 499999,
  'w2-entitlement-edge-credit', 'fixture L1 ceiling bank transfer confirmed', gen_random_uuid())
from entitlement_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the L1 ceiling deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select is(
  app_private.read_funding_entitlement_foundation((select edge_id from entitlement_ctx))->>'tier_code',
  'L1',
  '499999 KRW remains in approved L1');
select is(
  app_private.read_funding_entitlement_foundation((select edge_id from entitlement_ctx))->>'retention_bonus_bps',
  '1500',
  'the L1 ceiling does not take the next retention rate');

update entitlement_ctx set elite_deposit_id = public.create_deposit_request(
  elite_id, 'KRW', 5000000000, 'w2-entitlement-elite-request');
select public.approve_deposit_request(elite_deposit_id, admin_id, 5000000000,
  'w2-entitlement-elite-credit', 'fixture top band bank transfer confirmed', gen_random_uuid())
from entitlement_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the top band deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select is(
  app_private.read_funding_entitlement_foundation((select elite_id from entitlement_ctx))->>'tier_code',
  'L14',
  '5000000000 KRW selects approved L14');
select is(
  app_private.read_funding_entitlement_foundation((select elite_id from entitlement_ctx))->>'retention_bonus_bps',
  '2500',
  'approved L14 retention rate is 2500 bps');
select is(
  app_private.read_funding_entitlement_foundation((select elite_id from entitlement_ctx))->>'base_entitlement_micro_krw',
  (5000000000::bigint * (1500::bigint * 1000000 / 10000))::text,
  'L14 base entitlement stays on the shared base rate');
select is(
  app_private.read_funding_entitlement_foundation((select elite_id from entitlement_ctx))->>'retention_entitlement_micro_krw',
  (5000000000::bigint * (2500::bigint * 1000000 / 10000))::text,
  'L14 retention entitlement is separate and not a verified balance');
select is(
  app_private.read_funding_entitlement_foundation((select elite_id from entitlement_ctx))->>'retention_verified_credit',
  'false',
  'top-band retention is still not a verified credit');
reset role;

create temporary table entitlement_write_probe (
  journals bigint,
  entries bigint,
  outbox bigint,
  lots bigint,
  revisions bigint
);
insert into entitlement_write_probe
select
  (select count(*) from public.ledger_transactions),
  (select count(*) from public.ledger_entries),
  (select count(*) from public.outbox_events),
  (select count(*) from public.funding_principal_lots),
  (select count(*) from public.funding_principal_revisions);
set local role service_role;
select lives_ok(
  $$select app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))$$,
  'rereading qualification succeeds');
reset role;
select ok((select journals = (select count(*) from public.ledger_transactions)
    and entries = (select count(*) from public.ledger_entries)
    and outbox = (select count(*) from public.outbox_events)
    and lots = (select count(*) from public.funding_principal_lots)
    and revisions = (select count(*) from public.funding_principal_revisions)
  from entitlement_write_probe),
  'the qualification read does not append a journal, lot or outbox event');

with program as (
  insert into public.trial_programs(name, version, is_enabled, duration_seconds,
    quota_bps, target_reward_krw, first_result_target_seconds, first_world_id,
    completion_copy, effective_at)
  select 'w2-entitlement-fixture', 1, false, 86400, 10000, 5000, 60,
    world.id, '체험을 마쳤어요', statement_timestamp() - interval '2 hours'
  from public.asset_worlds as world where world.code = 'KOREA' returning id
)
update entitlement_ctx set program_id = program.id from program;
with trial as (
  insert into public.trial_accounts(user_id, trial_program_id, trial_program_version,
    world_id, status, started_at, expires_at, last_settled_at, quota_consumed_bps,
    reward_atomic, target_reward_krw)
  select ctx.band_id, ctx.program_id, 1, program.first_world_id, 'COMPLETED',
    statement_timestamp() - interval '1 hour', statement_timestamp(), statement_timestamp(), 10000, 5000, 5000
  from entitlement_ctx as ctx
  join public.trial_programs as program on program.id = ctx.program_id
  returning id
)
update entitlement_ctx set trial_id = trial.id from trial;
insert into public.trial_completions(trial_account_id, user_id, reason,
  final_quota_bps, final_reward_atomic, completed_at)
select trial_id, band_id, 'QUOTA', 10000, 5000, statement_timestamp() from entitlement_ctx;
insert into public.kyc_cases(user_id, status, risk_level, decided_at, reviewed_by)
select band_id, 'APPROVED', 'LOW', statement_timestamp(), admin_id from entitlement_ctx;
set local role service_role;
with converted as (
  select * from public.convert_trial_welcome_reward((select band_id from entitlement_ctx),
    'w2-entitlement-welcome-1', gen_random_uuid(), 1, 'w2-entitlement-risk-1')
)
update entitlement_ctx set conversion_id = converted.conversion_id from converted;
select lives_ok($$set constraints trial_reward_conversions_money_source_complete immediate$$,
  'welcome conversion still completes without becoming principal');
set constraints trial_reward_conversions_money_source_complete deferred;
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'eligible_principal_micro_krw',
  (500000::bigint * 1000000)::text,
  'welcome bonus does not increase eligible principal');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'tier_code',
  'L2',
  'welcome bonus does not change the tier');
reset role;
select ok(
  exists (
    select 1 from public.money_source_movements
    where user_id = (select band_id from entitlement_ctx)
      and source_bucket = 'BONUS' and origin_code = 'WELCOME_REWARD' and amount_atomic = 5000
  )
  and not exists (
    select 1 from public.funding_principal_lots as lot
    join public.money_source_movements as movement on movement.id = lot.money_source_movement_id
    where lot.user_id = (select band_id from entitlement_ctx)
      and movement.source_bucket <> 'PRINCIPAL'
  ),
  'bonus credit is not a principal lot');

set local role service_role;
select throws_ok($$
  insert into public.funding_principal_lots(
    user_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    origin_code, amount_atomic, amount_micro_krw, effective_at)
  select user_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    'MINING_REWARD', amount_atomic, amount_micro_krw, effective_at
  from public.funding_principal_lots
  where user_id = (select band_id from entitlement_ctx) and amount_atomic = 100000
$$, '55000', 'FUNDING_PRINCIPAL_ORIGIN_REJECTED',
  'mining reward cannot be inserted as a principal lot');
select throws_ok($$select app_private.reject_undecided_principal_recovery(
  (select band_id from entitlement_ctx), 1)$$,
  '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'a partial principal recovery is still rejected');
select throws_ok($$select app_private.reject_undecided_principal_recovery(
  (select band_id from entitlement_ctx), 500000::bigint * 1000000)$$,
  '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'a full amount does not choose a lot allocation');
select throws_ok($$
  insert into public.funding_principal_revisions(
    user_id, lot_id, money_source_movement_id, ledger_transaction_id, source_event_id,
    direction, delta_micro_krw, eligible_principal_micro_krw_after, effective_at)
  select lot.user_id, lot.id, lot.money_source_movement_id, lot.ledger_transaction_id,
    lot.source_event_id, 'DECREASE', 1, lot.amount_micro_krw, lot.effective_at
  from public.funding_principal_lots as lot
  where lot.user_id = (select band_id from entitlement_ctx) and lot.amount_atomic = 100000
$$, '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'a decrease revision still cannot choose a lot');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from entitlement_ctx))->>'eligible_principal_micro_krw',
  (500000::bigint * 1000000)::text,
  'rejected recovery does not change eligible principal');
select throws_ok($$select public.request_krw_withdrawal(
  (select band_id from entitlement_ctx),
  '0e2e0000-0000-4000-8000-000000000099',
  1,
  'w2-entitlement-withdrawal-closed')$$,
  '55000', 'VERIFIED_WITHDRAWAL_DESTINATION_REQUIRED',
  'a missing destination does not spend verified principal');
reset role;
select ok((select count(*) = 2
    and bool_and(lot.amount_micro_krw = lot.amount_atomic * 1000000)
  from public.funding_principal_lots as lot
  where lot.user_id = (select band_id from entitlement_ctx))
  and not exists (
    select 1 from public.funding_principal_revisions
    where user_id = (select band_id from entitlement_ctx) and direction = 'DECREASE'
  )
  and (select lot.effective_at = ctx.band_first_effective_at
    from entitlement_ctx as ctx
    join public.funding_principal_lots as lot on lot.user_id = ctx.band_id
    where lot.amount_atomic = 100000),
  'rejected recovery leaves both lots and the first effective time unchanged');

insert into public.ledger_transactions (
  category, currency, idempotency_key, reference_type, reference_id,
  member_user_id, request_id, correlation_id, description, created_by
)
select 'ADMIN_ADJUSTMENT', 'KRW', 'w2-entitlement-admin-adjustment',
  'entitlement_fixture', gen_random_uuid(), below_id, gen_random_uuid(), gen_random_uuid(),
  'balanced fixture that is not principal', admin_id from entitlement_ctx;
insert into public.ledger_entries (transaction_id, account_id, sequence, side, amount_atomic)
select journal.id, account.id, leg.sequence, leg.side, 1000
from public.ledger_transactions as journal
cross join entitlement_ctx as ctx
cross join (values (0::smallint, 'DEBIT'::public.ledger_side, true), (1::smallint, 'CREDIT'::public.ledger_side, false))
  as leg(sequence, side, member_account)
join public.ledger_accounts as account on account.code = case when leg.member_account
  then 'USER:' || upper(ctx.below_id::text) || ':KRW:LIABILITY'
  else 'PUTDUK:OPERATING_CASH:KRW' end
where journal.idempotency_key = 'w2-entitlement-admin-adjustment';
select lives_ok($$set constraints ledger_entries_balanced_at_commit,
  ledger_transactions_balanced_at_commit immediate$$,
  'a general admin adjustment remains a balanced journal');
set constraints ledger_entries_balanced_at_commit, ledger_transactions_balanced_at_commit deferred;
set local role service_role;
select is(
  app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'funding_status',
  'FUNDING_PRINCIPAL_UNRESOLVED',
  'unclassified money does not stay a fundable principal');
select ok(
  app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'tier_code' is null
  and app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'tier_activated' = 'false'
  and app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'eligible_principal_micro_krw' is null
  and app_private.read_funding_entitlement_foundation((select below_id from entitlement_ctx))->>'retention_verified_credit' = 'false',
  'unclassified money does not become a tier or verified retention');
reset role;

select * from finish();
rollback;
