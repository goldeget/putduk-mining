-- 저장된 segment와 policy speed로 pending 수치만 증명한다.
-- 호출자가 넘긴 보상 금액은 함수 인자가 아니다.
-- speed는 저장된 base를 더 빨리 채우고 capacity 수치는 그대로다.
-- 남은 capacity가 0이면 더 빠른 speed도 pending을 다시 열지 않는다.
-- retention은 pending에 더하지 않는다. 원장 credit은 늘지 않는다.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table producer_limits (
  speed_identity bigint,
  combined_speed bigint
);
insert into producer_limits
select
  (policy.config->'campaign'->>'defaultSpeedMultiplierBps')::bigint,
  (policy.config->'campaign'->>'maximumCombinedSpeedMultiplierBps')::bigint
from app_private.economy_policy_published as policy
where policy.policy_version = 'PUTDUK-MINING-V1-2026-10-03';
grant select on producer_limits to service_role;

select is((select speed_identity::text from producer_limits), '10000',
  'the published speed identity is 1.00x');
select is((select combined_speed::text from producer_limits), '15000',
  'the published combined speed limit is 1.50x');

select ok(
  (select not prosecdef and provolatile = 'i'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'app_private.funding_reward_pending_segment_micro(bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure)
  and (select not prosecdef and provolatile = 'v'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'app_private.read_funding_reward_pending(uuid)'::regprocedure)
  and pg_get_function_identity_arguments(
    'app_private.read_funding_reward_pending(uuid)'::regprocedure) = 'p_user_id uuid'
  and not has_function_privilege('public', 'app_private.read_funding_reward_pending(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_reward_pending(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.read_funding_reward_pending(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'app_private.read_funding_reward_pending(uuid)', 'EXECUTE'),
  'pending is an invoker-only service read with no reward amount');
select ok(
  position('insert into' in lower(pg_get_functiondef(
    'app_private.read_funding_reward_pending(uuid)'::regprocedure))) = 0
  and position('wallet_ledger' in pg_get_functiondef(
    'app_private.read_funding_reward_pending(uuid)'::regprocedure)) = 0
  and position('ledger_transactions' in pg_get_functiondef(
    'app_private.read_funding_reward_pending(uuid)'::regprocedure)) = 0
  and position('deposit_requests' in pg_get_functiondef(
    'app_private.read_funding_reward_pending(uuid)'::regprocedure)) = 0
  and position('::float' in pg_get_functiondef(
    'app_private.funding_reward_pending_fill_microseconds(bigint,bigint,bigint,bigint)'::regprocedure)) = 0
  and position('double precision' in pg_get_functiondef(
    'app_private.funding_reward_pending_segment_micro(bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure)) = 0
  and position('15000' in pg_get_functiondef(
    'app_private.read_funding_reward_pending(uuid)'::regprocedure)) = 0
  and position('12500' in pg_get_functiondef(
    'app_private.funding_reward_pending_segment_micro(bigint,bigint,bigint,bigint,bigint,bigint)'::regprocedure)) = 0
  and to_regclass('app_private.reward_carry') is null
  and to_regclass('app_private.funding_reward_pending') is null,
  'pending does not write money, carry, or a second reward table');

select is(
  (app_private.funding_reward_pending_segment_micro(
    100, 40, 50, 100,
    (select speed_identity from producer_limits),
    (select speed_identity from producer_limits))->>'accrued_micro_krw'),
  '50',
  'half of a stored segment at identity speed is half the stored base');
select is(
  (app_private.funding_reward_pending_segment_micro(
    100, 40, 50, 100,
    (select combined_speed from producer_limits),
    (select speed_identity from producer_limits))->>'accrued_micro_krw'),
  '75',
  'the published 1.50x speed fills three quarters without a caller amount');
select is(
  (app_private.funding_reward_pending_segment_micro(
    100, 40, 50, 100,
    (select combined_speed from producer_limits),
    (select speed_identity from producer_limits))->>'segment_capacity_micro_krw'),
  '100',
  'the faster speed does not raise the stored segment capacity');
select is(
  (app_private.funding_reward_pending_segment_micro(
    100, 40, 50, 100,
    (select combined_speed from producer_limits),
    (select speed_identity from producer_limits))->>'retention_unconfirmed_micro_krw'),
  '30',
  'unconfirmed retention stays beside the base accrual');
select is(
  app_private.funding_reward_pending_cap_micro(50, 100),
  50::bigint,
  'pending below capacity is the base accrual, not base plus retention');
select is(
  (app_private.funding_reward_pending_segment_micro(
    100, 40, 100, 100,
    (select combined_speed from producer_limits),
    (select speed_identity from producer_limits))->>'accrued_micro_krw'),
  '100',
  'higher speed stops at the stored base once the segment is full');
select is(
  app_private.funding_reward_pending_cap_micro(
    (app_private.funding_reward_pending_segment_micro(
      100, 40, 80, 100,
      (select combined_speed from producer_limits),
      (select speed_identity from producer_limits))->>'accrued_micro_krw')::bigint,
    0),
  0::bigint,
  'exhausted capacity stays closed when only speed is higher');
select is(
  app_private.funding_reward_pending_cap_micro(-20, 100),
  0::bigint,
  'a negative accrual does not claw back a reward');
select is(
  app_private.funding_reward_pending_cap_micro(
    (app_private.funding_reward_pending_segment_micro(
      100, 0, 50, 100,
      (select speed_identity from producer_limits),
      (select speed_identity from producer_limits))->>'accrued_micro_krw')::bigint
    + (app_private.funding_reward_pending_segment_micro(
      40, 0, 0, 50,
      (select speed_identity from producer_limits),
      (select speed_identity from producer_limits))->>'accrued_micro_krw')::bigint,
    140),
  50::bigint,
  'a later segment does not rewrite the earlier half');
select is(
  app_private.funding_reward_pending_cap_micro(
    (app_private.funding_reward_pending_segment_micro(
      100, 0, 100, 100,
      (select speed_identity from producer_limits),
      (select speed_identity from producer_limits))->>'accrued_micro_krw')::bigint
    + (app_private.funding_reward_pending_segment_micro(
      40, 0, 50, 50,
      (select speed_identity from producer_limits),
      (select speed_identity from producer_limits))->>'accrued_micro_krw')::bigint,
    140),
  140::bigint,
  'a finished window is the stored opening plus the stored remainder');
select cmp_ok(
  app_private.funding_reward_pending_cap_micro(
    (app_private.funding_reward_pending_segment_micro(
      100, 0, 100, 100,
      (select speed_identity from producer_limits),
      (select speed_identity from producer_limits))->>'accrued_micro_krw')::bigint
    + (app_private.funding_reward_pending_segment_micro(
      40, 0, 50, 50,
      (select speed_identity from producer_limits),
      (select speed_identity from producer_limits))->>'accrued_micro_krw')::bigint,
    140),
  '<',
  180::bigint,
  'the finished window is not replaced by a new full-cycle tier');
select throws_ok(
  $$select app_private.funding_reward_pending_fill_microseconds(2, 1, 10000, 10000)$$,
  '22023', 'PRODUCER_INPUT_INVALID',
  'elapsed time cannot exceed the stored segment');
select throws_ok(
  $$select app_private.read_funding_reward_pending(
    '00000000-0000-4000-8000-000000000001'::uuid, 1)$$,
  '42883', null,
  'a caller reward amount is not accepted');

set local role authenticated;
select throws_ok(
  $$select app_private.read_funding_reward_pending(null)$$,
  '42501', null,
  'a member cannot produce pending rewards');
reset role;

create temporary table producer_ctx (
  admin_id uuid,
  zero_id uuid,
  below_id uuid,
  seq_id uuid,
  below_deposit_id uuid,
  seq_deposit_id uuid,
  cycle_started_at timestamptz,
  cycle_end timestamptz,
  opening jsonb,
  ledger_count bigint,
  wallet_count bigint,
  outbox_count bigint,
  consumer_count bigint,
  lot_count integer
);
insert into producer_ctx (admin_id, zero_id, below_id, seq_id) values (
  '0c5d0000-0000-4000-8000-0000000000a1',
  '0c5d0000-0000-4000-8000-000000000100',
  '0c5d0000-0000-4000-8000-000000000101',
  '0c5d0000-0000-4000-8000-000000000102'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'v2-producer-admin@putduk.test' as email from producer_ctx
  union all select zero_id, 'v2-producer-zero@putduk.test' from producer_ctx
  union all select below_id, 'v2-producer-below@putduk.test' from producer_ctx
  union all select seq_id, 'v2-producer-seq@putduk.test' from producer_ctx
) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from producer_ctx;
grant select, update on producer_ctx to service_role;

set local role service_role;
select public.bootstrap_user((select zero_id from producer_ctx));
select is(
  app_private.read_funding_reward_pending((select zero_id from producer_ctx))->>'pending_micro_krw',
  '0',
  'zero principal has no pending reward');
select is(
  app_private.read_funding_reward_pending((select zero_id from producer_ctx))->>'ledger_credit_created',
  'false',
  'zero principal does not create a ledger credit');
reset role;

set local role service_role;
update producer_ctx set below_deposit_id = public.create_deposit_request(
  below_id, 'KRW', 99999, 'v2-producer-below-request');
select public.approve_deposit_request(below_deposit_id, admin_id, 99999,
  'v2-producer-below-credit', 'fixture bank transfer confirmed', gen_random_uuid())
from producer_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'below-minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select is(
  app_private.read_funding_reward_pending((select below_id from producer_ctx))->>'capacity_state',
  'FUNDING_BELOW_MINIMUM',
  'below-minimum principal does not activate pending');
select is(
  app_private.read_funding_reward_pending((select below_id from producer_ctx))->>'pending_micro_krw',
  '0',
  'below-minimum principal pending is zero');
reset role;

set local role service_role;
update producer_ctx set seq_deposit_id = public.create_deposit_request(
  seq_id, 'KRW', 100000, 'v2-producer-seq-request');
select public.approve_deposit_request(seq_deposit_id, admin_id, 100000,
  'v2-producer-seq-credit', 'fixture minimum bank transfer confirmed', gen_random_uuid())
from producer_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select seq_id from producer_ctx)),
  0,
  'the deposit alone does not open a cycle');
select is(
  app_private.read_funding_reward_pending((select seq_id from producer_ctx))->>'capacity_state',
  'NO_ACTIVE_WINDOW',
  'pending does not invent a cycle window');
select is(
  (select count(*)::integer from app_private.funding_cycle_segments
    where user_id = (select seq_id from producer_ctx)),
  0,
  'reading pending does not insert a segment');
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select seq_id from producer_ctx))$$,
  'the stored segment is the pending input');
reset role;
update producer_ctx set
  cycle_started_at = opened.cycle_started_at,
  cycle_end = opened.cycle_end,
  opening = to_jsonb(segment.*),
  ledger_count = (select count(*) from public.ledger_transactions),
  wallet_count = (select count(*) from public.wallet_ledger),
  outbox_count = (select count(*) from public.outbox_events),
  consumer_count = (
    select count(*) from public.outbox_events
    where last_error_code = 'POLICY_CONSUMER_NOT_ENABLED'),
  lot_count = (
    select count(*)::integer from public.funding_principal_lots
    where user_id = seq_id)
from app_private.funding_cycle_windows as opened,
  app_private.funding_cycle_segments as segment
where opened.user_id = seq_id
  and opened.cycle_ordinal = 0
  and segment.cycle_id = opened.id
  and segment.segment_ordinal = 0;
select cmp_ok(
  (select consumer_count from producer_ctx),
  '>',
  0::bigint,
  'the policy consumer stays disabled before pending is read');

set local role service_role;
select lives_ok(
  $$select app_private.read_funding_reward_pending((select seq_id from producer_ctx))$$,
  'stored segments can be read as pending');
select is(
  (select count(*) from public.ledger_transactions),
  (select ledger_count from producer_ctx),
  'reading pending does not add a ledger transaction');
select is(
  (select count(*) from public.wallet_ledger),
  (select wallet_count from producer_ctx),
  'reading pending does not add a wallet projection');
select is(
  (select count(*) from public.outbox_events),
  (select outbox_count from producer_ctx),
  'reading pending does not add an outbox event');
select is(
  (select count(*) from public.outbox_events
    where last_error_code = 'POLICY_CONSUMER_NOT_ENABLED'),
  (select consumer_count from producer_ctx),
  'reading pending does not enable the policy consumer');
select is(
  (select count(*)::integer from public.money_source_movements
    where user_id = (select seq_id from producer_ctx)
      and source_bucket = 'MINING_REWARD'),
  0,
  'pending does not create a mining reward movement');
select is(
  (select count(*)::integer from public.funding_principal_lots
    where user_id = (select seq_id from producer_ctx)),
  (select lot_count from producer_ctx),
  'pending does not turn a reward into principal');
reset role;

select ok(
  (select opened.cycle_started_at = ctx.cycle_started_at
      and opened.cycle_end = ctx.cycle_end
      and to_jsonb(segment.*) = ctx.opening
    from producer_ctx as ctx
    join app_private.funding_cycle_windows as opened
      on opened.user_id = ctx.seq_id and opened.cycle_ordinal = 0
    join app_private.funding_cycle_segments as segment
      on segment.cycle_id = opened.id and segment.segment_ordinal = 0),
  'reading pending keeps the cycle window and the stored segment');

set local role service_role;
select ok(
  (select pending.result->>'reader' = 'FUNDING_REWARD_PENDING'
      and pending.result->>'accepted_receipt' = 'false'
      and pending.result->>'ledger_credit_created' = 'false'
      and pending.result->>'reward_carry_stored' = 'false'
      and pending.result->>'retention_verified_credit' = 'false'
      and pending.result->>'retention_qualification' = 'UNCONFIRMED'
      and pending.result->>'policy_version' = pending.result->'segments'->0->>'policy_version'
      and (pending.result->>'cycle_started_at')::timestamptz = ctx.cycle_started_at
      and (pending.result->>'cycle_end')::timestamptz = ctx.cycle_end
      and pending.result->>'effective_capacity_micro_krw'
        = pending.result->'segments'->0->>'segment_capacity_micro_krw'
      and pending.result->>'speed_multiplier_bps' = pending.result->>'speed_identity_bps'
      and (pending.result->>'pending_micro_krw')::bigint
        <= (pending.result->'segments'->0->>'base_entitlement_micro_krw')::bigint
      and (pending.result->>'pending_micro_krw')::bigint
        = app_private.funding_reward_pending_cap_micro(
            (app_private.funding_reward_pending_segment_micro(
              (pending.result->'segments'->0->>'base_entitlement_micro_krw')::bigint,
              (pending.result->'segments'->0->>'retention_entitlement_micro_krw')::bigint,
              (pending.result->'segments'->0->>'elapsed_microseconds')::bigint,
              (pending.result->'segments'->0->>'span_microseconds')::bigint,
              (pending.result->'segments'->0->>'speed_multiplier_bps')::bigint,
              (pending.result->'segments'->0->>'speed_identity_bps')::bigint
            )->>'accrued_micro_krw')::bigint,
            (pending.result->>'remaining_capacity_micro_krw')::bigint)
      and (
        (pending.result->>'retention_unconfirmed_micro_krw')::bigint = 0
        or (pending.result->>'pending_micro_krw')::bigint
          < (pending.result->>'pending_micro_krw')::bigint
            + (pending.result->>'retention_unconfirmed_micro_krw')::bigint
      )
    from producer_ctx as ctx
    cross join lateral (
      select app_private.read_funding_reward_pending(ctx.seq_id) as result
    ) as pending),
  'pending matches the stored segment, policy speed, and cycle window');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select seq_id from producer_ctx)),
  1,
  'a second pending read does not open another cycle');
reset role;

select * from finish();
rollback;
