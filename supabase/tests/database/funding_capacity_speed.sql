-- Capacity와 Speed 계산만 증명한다.
-- 한도는 발행 policy row에서 읽고, 계산 함수에는 테스트가 확정 한도를 넣는다.
-- retention은 확정 잔액이 아니다. speed는 capacity를 올리지 않는다.
-- 소진 뒤 capacity 증가분은 남은 차이만 재개한다. cycle 시작과 끝은 그대로다.
-- 원장 credit과 부분 원금 회수 배분은 만들지 않는다.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table capacity_ctx (
  admin_id uuid,
  below_id uuid,
  band_id uuid,
  below_deposit_id uuid,
  band_deposit_id uuid,
  band_second_deposit_id uuid,
  cycle_started_at timestamptz,
  cycle_end timestamptz,
  cycle_span bigint,
  principal_micro bigint,
  base_micro bigint,
  retention_micro bigint,
  second_base_micro bigint,
  second_retention_micro bigint,
  ledger_count bigint,
  entry_count bigint,
  outbox_count bigint,
  window_count integer
);
insert into capacity_ctx (admin_id, below_id, band_id) values (
  '0ca50000-0000-4000-8000-0000000000a1',
  '0ca50000-0000-4000-8000-000000000101',
  '0ca50000-0000-4000-8000-000000000102'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'v2-capacity-admin@putduk.test' as email from capacity_ctx
  union all select below_id, 'v2-capacity-below@putduk.test' from capacity_ctx
  union all select band_id, 'v2-capacity-band@putduk.test' from capacity_ctx
) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from capacity_ctx;
grant select, update on capacity_ctx to service_role;

create temporary table capacity_limits (
  single_capacity bigint,
  combined_capacity bigint,
  speed_identity bigint,
  single_speed bigint,
  combined_speed bigint
);
insert into capacity_limits
select
  (policy.config->'campaign'->>'maximumSingleCapacityBoostBps')::bigint,
  (policy.config->'campaign'->>'maximumCombinedCapacityBoostBps')::bigint,
  (policy.config->'campaign'->>'defaultSpeedMultiplierBps')::bigint,
  (policy.config->'campaign'->>'maximumSingleSpeedMultiplierBps')::bigint,
  (policy.config->'campaign'->>'maximumCombinedSpeedMultiplierBps')::bigint
from app_private.economy_policy_published as policy
where policy.policy_version = 'PUTDUK-MINING-V1-2026-10-03';
grant select on capacity_limits to service_role;

select is((select single_capacity::text from capacity_limits), '1000',
  'the published capacity campaign single limit is +10 percent');
select is((select combined_capacity::text from capacity_limits), '2000',
  'the published capacity campaign combined limit is +20 percent');
select is((select speed_identity::text from capacity_limits), '10000',
  'the published speed identity is 1.00x');
select is((select single_speed::text from capacity_limits), '12500',
  'the published single speed limit is 1.25x');
select is((select combined_speed::text from capacity_limits), '15000',
  'the published combined speed limit is 1.50x');
select is(
  (select speed_identity + 2 * (single_speed - speed_identity) from capacity_limits)::text,
  (select combined_speed::text from capacity_limits),
  'two maximum speed increases add up to the combined final multiplier');
select ok(
  (select speed_identity + 3 * (single_speed - speed_identity) > combined_speed
    from capacity_limits),
  'three maximum speed increases exceed the combined final multiplier');

select ok(
  (select not prosecdef and provolatile = 'v'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)'::regprocedure)
  and not has_function_privilege('public', 'app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)', 'EXECUTE')
  and has_function_privilege('service_role', 'app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)', 'EXECUTE'),
  'capacity and speed are an invoker-only service read');
select ok(
  position('12500' in pg_get_functiondef('app_private.funding_capacity_speed_compute(bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint[],bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure)) = 0
  and position('15000' in pg_get_functiondef('app_private.funding_capacity_speed_compute(bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint[],bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure)) = 0
  and position('2000' in pg_get_functiondef('app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)'::regprocedure)) = 0
  and position('12500' in pg_get_functiondef('app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)'::regprocedure)) = 0
  and position('15000' in pg_get_functiondef('app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)'::regprocedure)) = 0
  and position('numeric' in pg_get_functiondef('app_private.funding_capacity_speed_compute(bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint[],bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure)) = 0
  and position('extract' in pg_get_functiondef('app_private.funding_capacity_speed_scale_micro(bigint,bigint,bigint)'::regprocedure)) = 0
  and position('insert into' in lower(pg_get_functiondef('app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)'::regprocedure))) = 0
  and position('deposit_requests' in pg_get_functiondef('app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)'::regprocedure)) = 0
  and position('wallet_ledger' in pg_get_functiondef('app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)'::regprocedure)) = 0,
  'campaign ceilings and lifetime deposits are not copied into the calculation');

set local role authenticated;
select throws_ok(
  $$select app_private.read_funding_capacity_speed(
    null, 0, array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null, 0)$$,
  '42501', null,
  'a member cannot calculate capacity or speed');
reset role;

set local role service_role;
select throws_ok(
  $$select app_private.read_funding_capacity_speed(
    null, 0, array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null, 0)$$,
  '22023', 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND',
  'capacity requires a member');
select public.bootstrap_user((select below_id from capacity_ctx));
select is(
  app_private.read_funding_capacity_speed(
    (select below_id from capacity_ctx), 0,
    array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null, 0)->>'capacity_state',
  'FUNDING_BELOW_MINIMUM',
  'principal below the minimum has no mining capacity');
select ok(
  app_private.read_funding_capacity_speed(
    (select below_id from capacity_ctx), 0,
    array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null, 0)->>'retention_verified_credit' = 'false'
  and app_private.read_funding_capacity_speed(
    (select below_id from capacity_ctx), 0,
    array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null, 0)->>'effective_capacity_micro_krw' is null
  and app_private.read_funding_capacity_speed(
    (select below_id from capacity_ctx), 0,
    array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null, 0)->>'reactivated' = 'false'
  and app_private.read_funding_capacity_speed(
    (select below_id from capacity_ctx), 0,
    array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null, 0)->>'ledger_credit_created' = 'false',
  'below-minimum retention is not a verified balance and nothing resumes');
reset role;

set local role service_role;
update capacity_ctx set band_deposit_id = public.create_deposit_request(
  band_id, 'KRW', 100000, 'v2-capacity-band-request-1');
select public.approve_deposit_request(band_deposit_id, admin_id, 100000,
  'v2-capacity-band-credit-1', 'fixture minimum bank transfer confirmed', gen_random_uuid())
from capacity_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select band_id from capacity_ctx))$$,
  'the first qualified deposit opens the existing cycle window');
reset role;
update capacity_ctx set
  cycle_started_at = opened.cycle_started_at,
  cycle_end = opened.cycle_end,
  cycle_span = opened.cycle_days::bigint * 24::bigint * 60 * 60 * 1000000,
  window_count = 1
from app_private.funding_cycle_windows as opened
where opened.user_id = band_id and opened.cycle_ordinal = 0;
select ok((select cycle_span % 2 = 0 and cycle_span > 0 from capacity_ctx),
  'the stored cycle span splits into an exact half');

set local role service_role;
update capacity_ctx set
  principal_micro = (entitlement->>'eligible_principal_micro_krw')::bigint,
  base_micro = (entitlement->>'base_entitlement_micro_krw')::bigint,
  retention_micro = (entitlement->>'retention_entitlement_micro_krw')::bigint
from (
  select app_private.read_funding_entitlement_foundation(band_id) as entitlement
  from capacity_ctx
) as current;
select is(
  (app_private.read_funding_capacity_speed(
    (select band_id from capacity_ctx), 0,
    array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null,
    (select cycle_span from capacity_ctx))->>'effective_capacity_micro_krw'),
  (select base_micro::text from capacity_ctx),
  'opening capacity is the entitlement base, not lifetime deposits');
select is(
  (app_private.read_funding_capacity_speed(
    (select band_id from capacity_ctx), 0,
    array[]::bigint[], array[]::bigint[],
    null, null, null, null, null, null,
    (select cycle_span from capacity_ctx))->>'retention_cycle_micro_krw'),
  (select retention_micro::text from capacity_ctx),
  'retention stays a separate unconfirmed amount');
select ok(
  (select result->>'retention_verified_credit' = 'false'
      and result->>'retention_qualification' = 'UNCONFIRMED'
      and result->>'capacity_state' = 'ACTIVE'
      and result->>'reactivated' = 'false'
      and result->>'speed_multiplier_bps' = (select speed_identity::text from capacity_limits)
      and result->>'effective_capacity_micro_krw'
        is distinct from ((select base_micro + retention_micro from capacity_ctx))::text
      and (result->>'cycle_started_at')::timestamptz = (select cycle_started_at from capacity_ctx)
      and (result->>'cycle_end')::timestamptz = (select cycle_end from capacity_ctx)
    from (
      select app_private.read_funding_capacity_speed(
        (select band_id from capacity_ctx), 0,
        array[]::bigint[], array[]::bigint[],
        null, null, null, null, null, null,
        (select cycle_span from capacity_ctx)) as result
    ) as opened),
  'base is not the verified retention balance and the cycle dates are copied');
reset role;

update capacity_ctx set
  ledger_count = (select count(*) from public.ledger_transactions),
  entry_count = (select count(*) from public.ledger_entries),
  outbox_count = (select count(*) from public.outbox_events);

set local role service_role;
select ok(
  (select result->>'capacity_state' = 'CAPACITY_EXHAUSTED'
      and result->>'reactivated' = 'false'
      and result->>'remaining_capacity_micro_krw' = '0'
      and result->>'effective_capacity_micro_krw' = (select base_micro::text from capacity_ctx)
      and result->>'speed_multiplier_bps' = (select single_speed::text from capacity_limits)
      and result->>'used_capacity_micro_krw' = (select base_micro::text from capacity_ctx)
    from (
      select app_private.read_funding_capacity_speed(
        (select band_id from capacity_ctx),
        (select base_micro from capacity_ctx),
        array[]::bigint[],
        array[(select single_speed from capacity_limits)]::bigint[],
        (select principal_micro from capacity_ctx),
        (select base_micro from capacity_ctx),
        (select retention_micro from capacity_ctx),
        (select retention_micro from capacity_ctx),
        (select base_micro from capacity_ctx),
        array[]::bigint[],
        (select cycle_span from capacity_ctx)) as result
    ) as exhausted),
  'a full cycle cannot resume from speed alone');
select ok(
  (select result->>'capacity_state' = 'ACTIVE'
      and result->>'reactivated' = 'true'
      and result->>'speed_multiplier_bps' = (select speed_identity::text from capacity_limits)
      and result->>'remaining_capacity_micro_krw'
        = ((select principal_micro * single_capacity / 10000
            from capacity_ctx cross join capacity_limits))::text
      and result->>'effective_capacity_micro_krw'
        = ((select base_micro + principal_micro * single_capacity / 10000
            from capacity_ctx cross join capacity_limits))::text
      and result->>'retention_cycle_micro_krw' = (select retention_micro::text from capacity_ctx)
      and result->>'retention_verified_credit' = 'false'
      and (result->>'cycle_started_at')::timestamptz = (select cycle_started_at from capacity_ctx)
      and (result->>'cycle_end')::timestamptz = (select cycle_end from capacity_ctx)
    from (
      select app_private.read_funding_capacity_speed(
        (select band_id from capacity_ctx),
        (select base_micro from capacity_ctx),
        array[(select single_capacity from capacity_limits)]::bigint[],
        array[]::bigint[],
        (select principal_micro from capacity_ctx),
        (select base_micro from capacity_ctx),
        (select retention_micro from capacity_ctx),
        (select retention_micro from capacity_ctx),
        (select base_micro from capacity_ctx),
        array[]::bigint[],
        (select cycle_span from capacity_ctx)) as result
    ) as resumed),
  'a capacity boost reopens only the unused boost difference');
select throws_ok(
  $$select app_private.read_funding_capacity_speed(
    (select band_id from capacity_ctx),
    (select base_micro from capacity_ctx),
    array[(select single_capacity + 1 from capacity_limits)]::bigint[],
    array[]::bigint[],
    (select principal_micro from capacity_ctx),
    (select base_micro from capacity_ctx),
    (select retention_micro from capacity_ctx),
    (select retention_micro from capacity_ctx),
    (select base_micro from capacity_ctx),
    array[]::bigint[],
    (select cycle_span from capacity_ctx))$$,
  '22023', 'CAPACITY_CAMPAIGN_LIMIT',
  'a boost above the published single limit is rejected');
select throws_ok(
  $$select app_private.read_funding_capacity_speed(
    (select band_id from capacity_ctx),
    (select base_micro from capacity_ctx),
    array[]::bigint[],
    array[
      (select single_speed from capacity_limits),
      (select single_speed from capacity_limits),
      (select single_speed from capacity_limits)
    ]::bigint[],
    (select principal_micro from capacity_ctx),
    (select base_micro from capacity_ctx),
    (select retention_micro from capacity_ctx),
    (select retention_micro from capacity_ctx),
    (select base_micro from capacity_ctx),
    array[]::bigint[],
    (select cycle_span from capacity_ctx))$$,
  '22023', 'CAPACITY_SPEED_LIMIT',
  'three maximum speed boosts exceed the published final multiplier');
reset role;
select is(
  (select count(*) from public.ledger_transactions),
  (select ledger_count from capacity_ctx),
  'capacity and speed reads do not append a ledger transaction');
select is(
  (select count(*) from public.ledger_entries),
  (select entry_count from capacity_ctx),
  'capacity and speed reads do not append a ledger entry');
select is(
  (select count(*) from public.outbox_events),
  (select outbox_count from capacity_ctx),
  'capacity and speed reads do not append an outbox event');

set local role service_role;
update capacity_ctx set band_second_deposit_id = public.create_deposit_request(
  band_id, 'KRW', 400000, 'v2-capacity-band-request-2');
select public.approve_deposit_request(band_second_deposit_id, admin_id, 400000,
  'v2-capacity-band-credit-2', 'fixture added bank transfer confirmed', gen_random_uuid())
from capacity_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the added deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
update capacity_ctx set
  second_base_micro = (entitlement->>'base_entitlement_micro_krw')::bigint,
  second_retention_micro = (entitlement->>'retention_entitlement_micro_krw')::bigint
from (
  select app_private.read_funding_entitlement_foundation(band_id) as entitlement
  from capacity_ctx
) as current;
select ok(
  (select result->>'capacity_state' = 'ACTIVE'
      and result->>'reactivated' = 'true'
      and result->>'effective_capacity_micro_krw'
        = ((select base_micro + (second_base_micro - base_micro) / 2
            from capacity_ctx))::text
      and result->>'effective_capacity_micro_krw'
        is distinct from (select second_base_micro::text from capacity_ctx)
      and result->>'remaining_capacity_micro_krw'
        = ((select (second_base_micro - base_micro) / 2 from capacity_ctx))::text
      and result->>'used_capacity_micro_krw' = (select base_micro::text from capacity_ctx)
      and result->>'retention_cycle_micro_krw'
        = ((select retention_micro + (second_retention_micro - retention_micro) / 2
            from capacity_ctx))::text
      and result->>'retention_verified_credit' = 'false'
      and result->>'speed_multiplier_bps' = (select combined_speed::text from capacity_limits)
      and result->>'eligible_principal_micro_krw'
        = app_private.read_funding_entitlement_foundation(
            (select band_id from capacity_ctx))->>'eligible_principal_micro_krw'
      and (result->>'cycle_started_at')::timestamptz = (select cycle_started_at from capacity_ctx)
      and (result->>'cycle_end')::timestamptz = (select cycle_end from capacity_ctx)
    from (
      select app_private.read_funding_capacity_speed(
        (select band_id from capacity_ctx),
        (select base_micro from capacity_ctx),
        array[]::bigint[],
        array[
          (select single_speed from capacity_limits),
          (select single_speed from capacity_limits)
        ]::bigint[],
        (select principal_micro from capacity_ctx),
        (select base_micro from capacity_ctx),
        (select retention_micro from capacity_ctx),
        (select retention_micro from capacity_ctx),
        (select base_micro from capacity_ctx),
        array[]::bigint[],
        (select cycle_span / 2 from capacity_ctx)) as result
    ) as added),
  'added principal resumes only the remaining-period difference while speed stays off capacity');
reset role;
select ok(
  (select count(*)::integer = 1
      and bool_and(opened.cycle_started_at = ctx.cycle_started_at
        and opened.cycle_end = ctx.cycle_end)
    from capacity_ctx as ctx
    join app_private.funding_cycle_windows as opened on opened.user_id = ctx.band_id),
  'capacity calculation does not move cycle start or end');
set local role service_role;
select throws_ok(
  $$select app_private.reject_undecided_principal_recovery(
    (select band_id from capacity_ctx), 1)$$,
  '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'partial principal recovery stays undecided');
select is(
  (app_private.funding_capacity_speed_compute(
    100000000000, 15000000000, 15000000000,
    100000000000, 15000000000, 15000000000, 15000000000, 15000000000,
    15000000000,
    array[400]::bigint[],
    array[]::bigint[],
    array[11000, 11000]::bigint[],
    50, 100,
    400, 700,
    10000, 11000, 12000)->>'capacity_boost_bps'),
  '400',
  'the calculation uses the injected capacity limit');
select is(
  (app_private.funding_capacity_speed_compute(
    100000000000, 15000000000, 15000000000,
    100000000000, 15000000000, 15000000000, 15000000000, 15000000000,
    15000000000,
    array[400]::bigint[],
    array[]::bigint[],
    array[11000, 11000]::bigint[],
    50, 100,
    400, 700,
    10000, 11000, 12000)->>'speed_multiplier_bps'),
  '12000',
  'the calculation uses the injected final speed limit');
select is(
  (app_private.funding_capacity_speed_compute(
    100000000000, 15000000000, 15000000000,
    100000000000, 15000000000, 15000000000, 15000000000, 15000000000,
    15000000000,
    array[400]::bigint[],
    array[]::bigint[],
    array[11000, 11000]::bigint[],
    50, 100,
    400, 700,
    10000, 11000, 12000)->>'effective_capacity_micro_krw'),
  (15000000000 + (100000000000 * 400 / 10000) / 2)::text,
  'an injected boost reopens only half of the remaining difference');
select throws_ok(
  $$select app_private.funding_capacity_speed_compute(
    100000000000, 15000000000, 15000000000,
    null, null, null, null, null,
    0,
    array[401]::bigint[],
    null,
    array[]::bigint[],
    100, 100,
    400, 700,
    10000, 11000, 12000)$$,
  '22023', 'CAPACITY_CAMPAIGN_LIMIT',
  'an injected single limit rejects a larger boost');
select ok(not exists (select 1 from public.outbox_events
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    and (status <> 'PENDING' or available_at <> 'infinity'::timestamptz
      or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED')),
  'capacity calculation does not enable the policy consumer');
reset role;

select * from finish();
rollback;
