-- cycle segment와 남은 기간 차이만 증명한다.
-- 첫 segment는 cycle 시작에 고정되고 창을 옮기지 않는다.
-- 같은 cycle의 추가 입금은 이전 행을 바꾸지 않고 남은 구간에 새 행을 연다.
-- 추가분은 새 조건의 30일 전체가 아니라 남은 기간 차이다.
-- base와 retention은 분리되고 원장 credit은 늘지 않는다.
-- 부분 원금 회수는 계속 거절된다.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table segment_ctx (
  admin_id uuid,
  zero_id uuid,
  below_id uuid,
  seq_id uuid,
  replay_id uuid,
  below_deposit_id uuid,
  seq_first_deposit_id uuid,
  seq_second_deposit_id uuid,
  replay_first_deposit_id uuid,
  replay_second_deposit_id uuid,
  seq_first_effective_at timestamptz,
  seq_cycle_id uuid,
  seq_cycle_started_at timestamptz,
  seq_cycle_end timestamptz,
  seq_opening jsonb,
  ledger_count bigint,
  wallet_count bigint,
  outbox_count bigint
);
insert into segment_ctx (admin_id, zero_id, below_id, seq_id, replay_id) values (
  '0c4c0000-0000-4000-8000-0000000000a1',
  '0c4c0000-0000-4000-8000-000000000100',
  '0c4c0000-0000-4000-8000-000000000101',
  '0c4c0000-0000-4000-8000-000000000102',
  '0c4c0000-0000-4000-8000-000000000103'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'w4-segment-admin@putduk.test' as email from segment_ctx
  union all select zero_id, 'w4-segment-zero@putduk.test' from segment_ctx
  union all select below_id, 'w4-segment-below@putduk.test' from segment_ctx
  union all select seq_id, 'w4-segment-seq@putduk.test' from segment_ctx
  union all select replay_id, 'w4-segment-replay@putduk.test' from segment_ctx
) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from segment_ctx;
grant select, update on segment_ctx to service_role;

select ok(
  (select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'app_private.funding_cycle_segments'::regclass)
  and has_table_privilege('service_role', 'app_private.funding_cycle_segments', 'SELECT')
  and has_table_privilege('service_role', 'app_private.funding_cycle_segments', 'INSERT')
  and not has_table_privilege('service_role', 'app_private.funding_cycle_segments', 'UPDATE')
  and not has_table_privilege('service_role', 'app_private.funding_cycle_segments', 'DELETE')
  and not has_table_privilege('authenticated', 'app_private.funding_cycle_segments', 'SELECT')
  and not has_table_privilege('anon', 'app_private.funding_cycle_segments', 'INSERT'),
  'segments are private, append-only, and hidden from members');
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'funding_cycle_segments'
      and column_name in ('reward_carry', 'product_id', 'used_micro_krw', 'speed_bps')
  ),
  'segments do not store carry, product copies, used capacity, or speed');
select ok(
  (select not prosecdef and provolatile = 'v'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'app_private.ensure_funding_cycle_segments(uuid)'::regprocedure)
  and (select not prosecdef and provolatile = 'v'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'app_private.read_funding_segment_foundation(uuid)'::regprocedure)
  and not has_function_privilege('public', 'app_private.ensure_funding_cycle_segments(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_segment_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.ensure_funding_cycle_segments(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'app_private.ensure_funding_cycle_segments(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'app_private.read_funding_segment_foundation(uuid)', 'EXECUTE'),
  'segment storage and read are invoker-only service functions');
select ok(
  position('insert into public.ledger' in lower(pg_get_functiondef(
    'app_private.ensure_funding_cycle_segments(uuid)'::regprocedure))) = 0
  and position('wallet_ledger' in pg_get_functiondef(
    'app_private.ensure_funding_cycle_segments(uuid)'::regprocedure)) = 0
  and position('reward_carry' in pg_get_functiondef(
    'app_private.ensure_funding_cycle_segments(uuid)'::regprocedure)) = 0
  and position('1500' in pg_get_functiondef(
    'app_private.ensure_funding_cycle_segments(uuid)'::regprocedure)) = 0
  and position('funding_entitlement_portion_micro' in pg_get_functiondef(
    'app_private.funding_segment_plan(uuid,timestamptz,timestamptz,timestamptz,uuid)'::regprocedure)) > 0
  and position('ensure_funding_cycle_windows' in pg_get_functiondef(
    'app_private.ensure_funding_cycle_segments(uuid)'::regprocedure)) > 0,
  'segment storage reuses the cycle window and integer portion without a ledger credit');

set local role service_role;
select is(
  app_private.funding_segment_span_microseconds(
    timestamptz '2026-10-01 00:00:00+00',
    timestamptz '2026-10-31 00:00:00+00'),
  2592000000000::bigint,
  'thirty UTC days are an integer microsecond span');
select is(
  app_private.funding_segment_scale_micro(75000000000, 2592000000000, 2592000000000),
  75000000000::bigint,
  'a full remaining interval keeps the whole integer amount');
select is(
  app_private.funding_segment_scale_micro(75000000000, 1296000000000, 2592000000000)
    - app_private.funding_segment_scale_micro(15000000000, 1296000000000, 2592000000000),
  30000000000::bigint,
  'half the remaining difference is half of the condition gap');
select cmp_ok(
  app_private.funding_segment_scale_micro(75000000000, 1296000000000, 2592000000000)
    - app_private.funding_segment_scale_micro(15000000000, 1296000000000, 2592000000000),
  '<',
  75000000000::bigint,
  'the half-cycle addition is below the new full cycle amount');
select throws_ok(
  $$select app_private.funding_segment_scale_micro(1, 2, 1)$$,
  '22023', 'SEGMENT_SCALE_INVALID',
  'a remaining ratio above the cycle is rejected');
reset role;

set local role authenticated;
select throws_ok(
  $$select app_private.read_funding_segment_foundation(null)$$,
  '42501', null,
  'a member cannot read segments');
reset role;

set local role service_role;
select throws_ok(
  $$select app_private.ensure_funding_cycle_segments(null)$$,
  '22023', 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND',
  'segment storage requires a member');
select public.bootstrap_user((select zero_id from segment_ctx));
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select zero_id from segment_ctx))$$,
  'zero principal can be evaluated');
select is(
  (app_private.read_funding_segment_foundation((select zero_id from segment_ctx))->>'segment_count')::integer,
  0,
  'zero principal does not open a segment');
reset role;

set local role service_role;
update segment_ctx set below_deposit_id = public.create_deposit_request(
  below_id, 'KRW', 99999, 'w4-segment-below-request');
select public.approve_deposit_request(below_deposit_id, admin_id, 99999,
  'w4-segment-below-credit', 'fixture bank transfer confirmed', gen_random_uuid())
from segment_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'below-minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select below_id from segment_ctx))$$,
  'below-minimum principal can be evaluated');
select is(
  (app_private.read_funding_segment_foundation((select below_id from segment_ctx))->>'segment_count')::integer,
  0,
  'below-minimum principal does not open a segment');
select is(
  app_private.read_funding_segment_foundation((select below_id from segment_ctx))->>'ledger_credit_created',
  'false',
  'a below-minimum read claims no ledger credit');
reset role;

set local role service_role;
update segment_ctx set seq_first_deposit_id = public.create_deposit_request(
  seq_id, 'KRW', 100000, 'w4-segment-seq-request-1');
select public.approve_deposit_request(seq_first_deposit_id, admin_id, 100000,
  'w4-segment-seq-credit-1', 'fixture minimum bank transfer confirmed', gen_random_uuid())
from segment_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select is(
  (app_private.read_funding_segment_foundation((select seq_id from segment_ctx))->>'segment_count')::integer,
  0,
  'reading segments does not create one');
select is(
  (select count(*)::integer from app_private.funding_cycle_segments
    where user_id = (select seq_id from segment_ctx)),
  0,
  'the segment table stays empty until storage runs');
update segment_ctx set
  ledger_count = (select count(*) from public.ledger_transactions),
  wallet_count = (select count(*) from public.wallet_ledger),
  outbox_count = (select count(*) from public.outbox_events);
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select seq_id from segment_ctx))$$,
  'meeting the minimum opens the cycle-start segment');
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select seq_id from segment_ctx))$$,
  'storing the same opening segment again is idempotent');
select is(
  (select count(*) from public.ledger_transactions),
  (select ledger_count from segment_ctx),
  'opening a segment does not add a ledger transaction');
select is(
  (select count(*) from public.wallet_ledger),
  (select wallet_count from segment_ctx),
  'opening a segment does not add a wallet projection');
select is(
  (select count(*) from public.outbox_events),
  (select outbox_count from segment_ctx),
  'opening a segment does not add an outbox event');
select is(
  (select count(*)::integer from public.money_source_movements
    where user_id = (select seq_id from segment_ctx) and source_bucket = 'MINING_REWARD'),
  0,
  'opening a segment does not create a mining reward');
reset role;
update segment_ctx set
  seq_first_effective_at = lot.effective_at,
  seq_cycle_id = opened.id,
  seq_cycle_started_at = opened.cycle_started_at,
  seq_cycle_end = opened.cycle_end,
  seq_opening = to_jsonb(segment.*)
from public.funding_principal_lots as lot,
  app_private.funding_cycle_windows as opened,
  app_private.funding_cycle_segments as segment
where lot.user_id = seq_id
  and lot.amount_atomic = 100000
  and opened.user_id = seq_id
  and opened.cycle_ordinal = 0
  and segment.cycle_id = opened.id
  and segment.segment_ordinal = 0;
select ok(
  (select segment.effective_at = ctx.seq_cycle_started_at
      and segment.effective_at = ctx.seq_first_effective_at
      and segment.effective_until = ctx.seq_cycle_end
      and opened.cycle_end = opened.cycle_started_at + opened.cycle_days * interval '24 hours'
      and segment.principal_micro_krw = lot.amount_micro_krw
      and segment.entitlement_kind = 'CYCLE_OPENING'
      and segment.tier_code = 'L1'
      and segment.retention_qualification = 'UNCONFIRMED'
      and segment.base_entitlement_micro_krw = app_private.funding_entitlement_portion_micro(
        segment.principal_micro_krw, segment.base_cycle_rate_bps)
    from segment_ctx as ctx
    join public.funding_principal_lots as lot
      on lot.user_id = ctx.seq_id and lot.amount_atomic = 100000
    join app_private.funding_cycle_windows as opened
      on opened.id = ctx.seq_cycle_id
    join app_private.funding_cycle_segments as segment
      on segment.cycle_id = opened.id and segment.segment_ordinal = 0),
  'the opening segment freezes the cycle start, first lot, and full-cycle base');

select pg_sleep(0.05);
set local role service_role;
update segment_ctx set seq_second_deposit_id = public.create_deposit_request(
  seq_id, 'KRW', 400000, 'w4-segment-seq-request-2');
select public.approve_deposit_request(seq_second_deposit_id, admin_id, 400000,
  'w4-segment-seq-credit-2', 'fixture added bank transfer confirmed', gen_random_uuid())
from segment_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the second deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
update segment_ctx set
  ledger_count = (select count(*) from public.ledger_transactions),
  wallet_count = (select count(*) from public.wallet_ledger),
  outbox_count = (select count(*) from public.outbox_events);
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select seq_id from segment_ctx))$$,
  'a second deposit inside the cycle opens a remainder segment');
select is(
  (select count(*) from public.ledger_transactions),
  (select ledger_count from segment_ctx),
  'the remainder segment adds no ledger transaction');
select is(
  (select count(*) from public.wallet_ledger),
  (select wallet_count from segment_ctx),
  'the remainder segment adds no wallet projection');
select is(
  (select count(*) from public.outbox_events),
  (select outbox_count from segment_ctx),
  'the remainder segment adds no outbox event');
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select seq_id from segment_ctx))$$,
  'storing the same remainder segment again is idempotent');
reset role;
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select seq_id from segment_ctx)),
  1,
  'the second deposit does not open another cycle');
select is(
  (select count(*)::integer from app_private.funding_cycle_segments
    where user_id = (select seq_id from segment_ctx)),
  2,
  'the second deposit adds one segment for the user, not one per product');
select ok(
  (select to_jsonb(segment.*) = ctx.seq_opening
      and opened.id = ctx.seq_cycle_id
      and opened.cycle_started_at = ctx.seq_cycle_started_at
      and opened.cycle_end = ctx.seq_cycle_end
      and kept.effective_at = ctx.seq_first_effective_at
    from segment_ctx as ctx
    join app_private.funding_cycle_segments as segment
      on segment.cycle_id = ctx.seq_cycle_id and segment.segment_ordinal = 0
    join app_private.funding_cycle_windows as opened
      on opened.id = ctx.seq_cycle_id
    join public.funding_principal_lots as kept
      on kept.user_id = ctx.seq_id and kept.amount_atomic = 100000),
  'the second deposit keeps the opening segment, cycle window, and first lot time');
select ok(
  (select added.effective_at = second_lot.effective_at
      and added.effective_at > ctx.seq_first_effective_at
      and added.effective_until = ctx.seq_cycle_end
      and added.entitlement_kind = 'REMAINDER_DELTA'
      and added.tier_code = 'L2'
      and added.principal_micro_krw = first_lot.amount_micro_krw + second_lot.amount_micro_krw
      and added.retention_qualification = 'UNCONFIRMED'
      and added.policy_version = opening.policy_version
      and opening.tier_code = 'L1'
      and opening.principal_micro_krw = first_lot.amount_micro_krw
    from segment_ctx as ctx
    join public.funding_principal_lots as first_lot
      on first_lot.user_id = ctx.seq_id and first_lot.amount_atomic = 100000
    join public.funding_principal_lots as second_lot
      on second_lot.user_id = ctx.seq_id and second_lot.amount_atomic = 400000
    join app_private.funding_cycle_segments as opening
      on opening.cycle_id = ctx.seq_cycle_id and opening.segment_ordinal = 0
    join app_private.funding_cycle_segments as added
      on added.cycle_id = ctx.seq_cycle_id and added.segment_ordinal = 1),
  'the new segment freezes the later principal and tier through the same cycle end');
select ok(
  (select added.base_entitlement_micro_krw = app_private.funding_segment_scale_micro(
        app_private.funding_entitlement_portion_micro(
          added.principal_micro_krw, added.base_cycle_rate_bps),
        app_private.funding_segment_span_microseconds(added.effective_at, added.effective_until),
        app_private.funding_segment_span_microseconds(opening.effective_at, opening.effective_until))
      - app_private.funding_segment_scale_micro(
        app_private.funding_entitlement_portion_micro(
          opening.principal_micro_krw, opening.base_cycle_rate_bps),
        app_private.funding_segment_span_microseconds(added.effective_at, added.effective_until),
        app_private.funding_segment_span_microseconds(opening.effective_at, opening.effective_until))
      and added.base_entitlement_micro_krw < app_private.funding_entitlement_portion_micro(
        added.principal_micro_krw, added.base_cycle_rate_bps)
    from segment_ctx as ctx
    join app_private.funding_cycle_segments as opening
      on opening.cycle_id = ctx.seq_cycle_id and opening.segment_ordinal = 0
    join app_private.funding_cycle_segments as added
      on added.cycle_id = ctx.seq_cycle_id and added.segment_ordinal = 1),
  'added base is the remaining-period difference, not the new full cycle amount');
select ok(
  (select added.retention_entitlement_micro_krw = app_private.funding_segment_scale_micro(
        app_private.funding_entitlement_portion_micro(
          added.principal_micro_krw, added.retention_bonus_bps),
        app_private.funding_segment_span_microseconds(added.effective_at, added.effective_until),
        app_private.funding_segment_span_microseconds(opening.effective_at, opening.effective_until))
      - app_private.funding_segment_scale_micro(
        app_private.funding_entitlement_portion_micro(
          opening.principal_micro_krw, opening.retention_bonus_bps),
        app_private.funding_segment_span_microseconds(added.effective_at, added.effective_until),
        app_private.funding_segment_span_microseconds(opening.effective_at, opening.effective_until))
      and added.retention_entitlement_micro_krw < app_private.funding_entitlement_portion_micro(
        added.principal_micro_krw, added.retention_bonus_bps)
      and added.base_entitlement_micro_krw is distinct from added.retention_entitlement_micro_krw
      and added.retention_qualification = 'UNCONFIRMED'
    from segment_ctx as ctx
    join app_private.funding_cycle_segments as opening
      on opening.cycle_id = ctx.seq_cycle_id and opening.segment_ordinal = 0
    join app_private.funding_cycle_segments as added
      on added.cycle_id = ctx.seq_cycle_id and added.segment_ordinal = 1),
  'retention stays a separate unconfirmed remainder, not the new full cycle amount');
set local role service_role;
select ok(
  (app_private.read_funding_segment_foundation((select seq_id from segment_ctx))->>'segment_count')::integer = 2
  and (app_private.read_funding_segment_foundation((select seq_id from segment_ctx))->>'cycle_base_entitlement_micro_krw')::bigint
    < (app_private.read_funding_entitlement_foundation((select seq_id from segment_ctx))->>'base_entitlement_micro_krw')::bigint
  and app_private.read_funding_segment_foundation((select seq_id from segment_ctx))->>'retention_verified_credit' = 'false'
  and app_private.read_funding_segment_foundation((select seq_id from segment_ctx))->>'ledger_credit_created' = 'false'
  and app_private.read_funding_entitlement_foundation((select seq_id from segment_ctx))->>'retention_qualification' = 'UNCONFIRMED'
  and app_private.read_funding_entitlement_foundation((select seq_id from segment_ctx))->>'tier_code' = 'L2',
  'stored cycle qualification is below the new full-cycle entitlement and still unverified');
select throws_ok(
  $$select app_private.reject_undecided_principal_recovery(
    (select seq_id from segment_ctx), 1)$$,
  '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'partial principal recovery stays undecided');
reset role;
select ok(
  (select count(*)::integer = 2
    from app_private.funding_cycle_segments
    where user_id = (select seq_id from segment_ctx))
  and (select count(*)::integer = 2
    from public.funding_principal_lots
    where user_id = (select seq_id from segment_ctx))
  and not exists (
    select 1 from public.funding_principal_revisions
    where user_id = (select seq_id from segment_ctx) and direction = 'DECREASE'
  )
  and (select to_jsonb(segment.*) = ctx.seq_opening
    from segment_ctx as ctx
    join app_private.funding_cycle_segments as segment
      on segment.cycle_id = ctx.seq_cycle_id and segment.segment_ordinal = 0),
  'rejected recovery leaves lots, the opening segment, and the first effective time unchanged');
select throws_ok(
  $$update app_private.funding_cycle_segments set effective_until = effective_at$$,
  '55000', 'funding_cycle_segments is append-only',
  'an existing segment cannot be rewritten');

select pg_sleep(0.05);
set local role service_role;
update segment_ctx set replay_first_deposit_id = public.create_deposit_request(
  replay_id, 'KRW', 100000, 'w4-segment-replay-request-1');
select public.approve_deposit_request(replay_first_deposit_id, admin_id, 100000,
  'w4-segment-replay-credit-1', 'fixture replay minimum bank transfer confirmed', gen_random_uuid())
from segment_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the replay minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
select pg_sleep(0.05);
set local role service_role;
update segment_ctx set replay_second_deposit_id = public.create_deposit_request(
  replay_id, 'KRW', 400000, 'w4-segment-replay-request-2');
select public.approve_deposit_request(replay_second_deposit_id, admin_id, 400000,
  'w4-segment-replay-credit-2', 'fixture replay added bank transfer confirmed', gen_random_uuid())
from segment_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the replay second approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select replay_id from segment_ctx))$$,
  'one later evaluation still splits the cycle at the original boundaries');
reset role;
select ok(
  (select opening.effective_at = opened.cycle_started_at
      and opening.effective_at = first_lot.effective_at
      and opening.effective_until = opened.cycle_end
      and opening.principal_micro_krw = first_lot.amount_micro_krw
      and opening.tier_code = 'L1'
      and added.effective_at = second_lot.effective_at
      and added.effective_until = opened.cycle_end
      and added.principal_micro_krw = first_lot.amount_micro_krw + second_lot.amount_micro_krw
      and added.tier_code = 'L2'
      and added.base_entitlement_micro_krw < app_private.funding_entitlement_portion_micro(
        added.principal_micro_krw, added.base_cycle_rate_bps)
      and (select count(*) from app_private.funding_cycle_windows as window_row
        where window_row.user_id = ctx.replay_id) = 1
    from segment_ctx as ctx
    join public.funding_principal_lots as first_lot
      on first_lot.user_id = ctx.replay_id and first_lot.amount_atomic = 100000
    join public.funding_principal_lots as second_lot
      on second_lot.user_id = ctx.replay_id and second_lot.amount_atomic = 400000
    join app_private.funding_cycle_windows as opened
      on opened.user_id = ctx.replay_id and opened.cycle_ordinal = 0
    join app_private.funding_cycle_segments as opening
      on opening.cycle_id = opened.id and opening.segment_ordinal = 0
    join app_private.funding_cycle_segments as added
      on added.cycle_id = opened.id and added.segment_ordinal = 1),
  'a late evaluation still freezes the first segment at cycle start');
select ok(not exists (select 1 from public.outbox_events
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    and (status <> 'PENDING' or available_at <> 'infinity'::timestamptz
      or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED')),
  'segment storage does not enable the policy consumer');

select * from finish();
rollback;
