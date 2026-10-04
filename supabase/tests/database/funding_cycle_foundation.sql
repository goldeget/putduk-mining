-- 30일 cycle 창의 저장과 조회만 증명한다.
-- 최소 원금 미만이면 창이 없다.
-- 자격 충족 시 끝은 시작에 발행 cycleDays * 24시간을 더한 시각이다.
-- 같은 창의 둘째 입금은 시작, 끝, 첫 lot effective_at을 바꾸지 않는다.
-- 끝이 지나기 전에는 둘째 창이 없고, 지난 뒤에는 다음 창이 열리며 이전 행이 남는다.
-- 자격 조회와 부분 원금 회수 거절은 그대로다. 원장 credit은 늘지 않는다.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table cycle_ctx (
  admin_id uuid,
  zero_id uuid,
  below_id uuid,
  cross_id uuid,
  band_id uuid,
  late_id uuid,
  below_deposit_id uuid,
  cross_first_deposit_id uuid,
  cross_second_deposit_id uuid,
  band_first_deposit_id uuid,
  band_second_deposit_id uuid,
  late_deposit_id uuid,
  cross_first_effective_at timestamptz,
  band_first_effective_at timestamptz,
  band_cycle_id uuid,
  late_cycle_id uuid,
  ledger_count bigint,
  wallet_count bigint,
  outbox_count bigint
);
insert into cycle_ctx (admin_id, zero_id, below_id, cross_id, band_id, late_id) values (
  '0c3c0000-0000-4000-8000-0000000000a1',
  '0c3c0000-0000-4000-8000-000000000100',
  '0c3c0000-0000-4000-8000-000000000101',
  '0c3c0000-0000-4000-8000-000000000102',
  '0c3c0000-0000-4000-8000-000000000103',
  '0c3c0000-0000-4000-8000-000000000104'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'w3-cycle-admin@putduk.test' as email from cycle_ctx
  union all select zero_id, 'w3-cycle-zero@putduk.test' from cycle_ctx
  union all select below_id, 'w3-cycle-below@putduk.test' from cycle_ctx
  union all select cross_id, 'w3-cycle-cross@putduk.test' from cycle_ctx
  union all select band_id, 'w3-cycle-band@putduk.test' from cycle_ctx
  union all select late_id, 'w3-cycle-late@putduk.test' from cycle_ctx
) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from cycle_ctx;
grant select, update on cycle_ctx to service_role;

select ok(
  (select relrowsecurity and relforcerowsecurity
    from pg_class where oid = 'app_private.funding_cycle_windows'::regclass)
  and has_table_privilege('service_role', 'app_private.funding_cycle_windows', 'SELECT')
  and has_table_privilege('service_role', 'app_private.funding_cycle_windows', 'INSERT')
  and not has_table_privilege('service_role', 'app_private.funding_cycle_windows', 'UPDATE')
  and not has_table_privilege('service_role', 'app_private.funding_cycle_windows', 'DELETE')
  and not has_table_privilege('authenticated', 'app_private.funding_cycle_windows', 'SELECT')
  and not has_table_privilege('anon', 'app_private.funding_cycle_windows', 'INSERT'),
  'cycle windows are private, append-only, and hidden from members');
select ok(
  (select not prosecdef and provolatile = 'v'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'app_private.ensure_funding_cycle_windows(uuid)'::regprocedure)
  and (select not prosecdef and provolatile = 'v'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'app_private.read_funding_cycle_foundation(uuid)'::regprocedure)
  and not has_function_privilege('public', 'app_private.ensure_funding_cycle_windows(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_cycle_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.ensure_funding_cycle_windows(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'app_private.ensure_funding_cycle_windows(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'app_private.read_funding_cycle_foundation(uuid)', 'EXECUTE'),
  'cycle storage and read are invoker-only service functions');
select ok(
  position('insert into public.ledger' in lower(pg_get_functiondef(
    'app_private.ensure_funding_cycle_windows(uuid)'::regprocedure))) = 0
  and position('wallet_ledger' in pg_get_functiondef(
    'app_private.ensure_funding_cycle_windows(uuid)'::regprocedure)) = 0
  and position('1500' in pg_get_functiondef(
    'app_private.ensure_funding_cycle_windows(uuid)'::regprocedure)) = 0
  and position('interval ''30 days''' in pg_get_functiondef(
    'app_private.ensure_funding_cycle_windows(uuid)'::regprocedure)) = 0
  and position('cycleDays' in pg_get_functiondef(
    'app_private.funding_cycle_policy_days()'::regprocedure)) > 0,
  'cycle storage reads published cycleDays and does not post a ledger credit');
select ok(not exists (select 1 from public.outbox_events
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    and (status <> 'PENDING' or available_at <> 'infinity'::timestamptz
      or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED')),
  'cycle storage does not enable the policy consumer');

set local role authenticated;
select throws_ok(
  $$select app_private.read_funding_cycle_foundation(null)$$,
  '42501', null,
  'a member cannot read cycle windows');
reset role;

set local role service_role;
select throws_ok(
  $$select app_private.ensure_funding_cycle_windows(null)$$,
  '22023', 'FUNDING_PRINCIPAL_SUBJECT_NOT_FOUND',
  'cycle storage requires a member');
select public.bootstrap_user((select zero_id from cycle_ctx));
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select zero_id from cycle_ctx))$$,
  'zero principal can be evaluated');
select is(
  (app_private.read_funding_cycle_foundation((select zero_id from cycle_ctx))->>'cycle_count')::integer,
  0,
  'zero principal does not open a cycle');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select zero_id from cycle_ctx)),
  0,
  'zero principal stores no cycle row');
reset role;

set local role service_role;
update cycle_ctx set below_deposit_id = public.create_deposit_request(
  below_id, 'KRW', 99999, 'w3-cycle-below-request');
select public.approve_deposit_request(below_deposit_id, admin_id, 99999,
  'w3-cycle-below-credit', 'fixture bank transfer confirmed', gen_random_uuid())
from cycle_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'below-minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select below_id from cycle_ctx))$$,
  'below-minimum principal can be evaluated');
select is(
  app_private.read_funding_cycle_foundation((select below_id from cycle_ctx))->>'funding_status',
  'FUNDING_BELOW_MINIMUM',
  '99999 KRW stays below the minimum');
select is(
  (app_private.read_funding_cycle_foundation((select below_id from cycle_ctx))->>'cycle_count')::integer,
  0,
  'below-minimum principal does not open a cycle');
select ok(
  app_private.read_funding_cycle_foundation((select below_id from cycle_ctx))->>'active_cycle_id' is null
  and app_private.read_funding_cycle_foundation((select below_id from cycle_ctx))->>'ledger_credit_created' = 'false',
  'below-minimum read creates no active cycle and no ledger credit');
reset role;

set local role service_role;
update cycle_ctx set cross_first_deposit_id = public.create_deposit_request(
  cross_id, 'KRW', 99999, 'w3-cycle-cross-request-1');
select public.approve_deposit_request(cross_first_deposit_id, admin_id, 99999,
  'w3-cycle-cross-credit-1', 'fixture first partial bank transfer confirmed', gen_random_uuid())
from cycle_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the first partial approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
update cycle_ctx set cross_first_effective_at = lot.effective_at
from public.funding_principal_lots as lot
where lot.user_id = cross_id and lot.amount_atomic = 99999;
set local role service_role;
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select cross_id from cycle_ctx))$$,
  'a partial principal below the minimum can be evaluated');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select cross_id from cycle_ctx)),
  0,
  'the first lot below the minimum does not open a cycle');
update cycle_ctx set cross_second_deposit_id = public.create_deposit_request(
  cross_id, 'KRW', 1, 'w3-cycle-cross-request-2');
select public.approve_deposit_request(cross_second_deposit_id, admin_id, 1,
  'w3-cycle-cross-credit-2', 'fixture qualifying bank transfer confirmed', gen_random_uuid())
from cycle_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the qualifying remainder still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select cross_id from cycle_ctx))$$,
  'crossing the minimum opens the first cycle');
select ok(
  (select opened.cycle_started_at = qualifying.effective_at
      and opened.cycle_started_at is distinct from ctx.cross_first_effective_at
      and kept.effective_at = ctx.cross_first_effective_at
      and opened.cycle_end = opened.cycle_started_at
        + opened.cycle_days * interval '24 hours'
      and opened.cycle_days = (policy.config->>'cycleDays')::integer
    from cycle_ctx as ctx
    join public.funding_principal_lots as kept
      on kept.user_id = ctx.cross_id and kept.amount_atomic = 99999
    join public.funding_principal_lots as qualifying
      on qualifying.user_id = ctx.cross_id and qualifying.amount_atomic = 1
    join app_private.funding_cycle_windows as opened
      on opened.user_id = ctx.cross_id and opened.cycle_ordinal = 0
    join app_private.economy_policy_published as policy
      on policy.policy_version = 'PUTDUK-MINING-V1-2026-10-03'),
  'the cycle starts at the qualifying lot and keeps the earlier lot time');
reset role;

set local role service_role;
update cycle_ctx set band_first_deposit_id = public.create_deposit_request(
  band_id, 'KRW', 100000, 'w3-cycle-band-request-1');
select public.approve_deposit_request(band_first_deposit_id, admin_id, 100000,
  'w3-cycle-band-credit-1', 'fixture minimum bank transfer confirmed', gen_random_uuid())
from cycle_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
reset role;
update cycle_ctx set band_first_effective_at = lot.effective_at
from public.funding_principal_lots as lot
where lot.user_id = band_id and lot.amount_atomic = 100000;
set local role service_role;
select is(
  (app_private.read_funding_cycle_foundation((select band_id from cycle_ctx))->>'cycle_count')::integer,
  0,
  'reading a cycle does not create one');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select band_id from cycle_ctx)),
  0,
  'the cycle table stays empty until storage runs');
update cycle_ctx set
  ledger_count = (select count(*) from public.ledger_transactions),
  wallet_count = (select count(*) from public.wallet_ledger),
  outbox_count = (select count(*) from public.outbox_events);
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select band_id from cycle_ctx))$$,
  'meeting the minimum opens one cycle');
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select band_id from cycle_ctx))$$,
  'storing the same cycle again is idempotent');
select is(
  (select count(*) from public.ledger_transactions),
  (select ledger_count from cycle_ctx),
  'opening a cycle does not add a ledger transaction');
select is(
  (select count(*) from public.wallet_ledger),
  (select wallet_count from cycle_ctx),
  'opening a cycle does not add a wallet projection');
select is(
  (select count(*) from public.outbox_events),
  (select outbox_count from cycle_ctx),
  'opening a cycle does not add an outbox event');
select is(
  (select count(*)::integer from public.money_source_movements
    where user_id = (select band_id from cycle_ctx) and source_bucket = 'MINING_REWARD'),
  0,
  'opening a cycle does not create a mining reward');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select band_id from cycle_ctx)),
  1,
  'qualification stores one cycle');
select ok(
  (select opened.cycle_started_at = ctx.band_first_effective_at
      and opened.cycle_end = opened.cycle_started_at + opened.cycle_days * interval '24 hours'
      and opened.cycle_end = (opened.cycle_started_at at time zone 'UTC'
        + opened.cycle_days * interval '1 day') at time zone 'UTC'
      and opened.cycle_days = (policy.config->>'cycleDays')::integer
      and (policy.config->>'cycleDays')::integer = 30
    from cycle_ctx as ctx
    join app_private.funding_cycle_windows as opened
      on opened.user_id = ctx.band_id and opened.cycle_ordinal = 0
    join app_private.economy_policy_published as policy
      on policy.policy_version = 'PUTDUK-MINING-V1-2026-10-03'),
  'cycle end is the published 30 days measured as exact UTC days');
select is(
  (app_private.read_funding_cycle_foundation((select band_id from cycle_ctx))->>'cycle_started_at')::timestamptz,
  (select band_first_effective_at from cycle_ctx),
  'the active cycle starts at the first qualifying lot');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from cycle_ctx))->>'tier_code',
  'L1',
  'entitlement qualification still selects L1 at the minimum');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from cycle_ctx))->>'retention_qualification',
  'UNCONFIRMED',
  'retention stays unconfirmed after a cycle is stored');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from cycle_ctx))->>'retention_verified_credit',
  'false',
  'retention is still not a verified credit');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from cycle_ctx))->>'ledger_credit_created',
  'false',
  'entitlement qualification still does not claim a ledger credit');
reset role;
update cycle_ctx set band_cycle_id = opened.id
from app_private.funding_cycle_windows as opened
where opened.user_id = band_id and opened.cycle_ordinal = 0;

set local role service_role;
update cycle_ctx set band_second_deposit_id = public.create_deposit_request(
  band_id, 'KRW', 400000, 'w3-cycle-band-request-2');
select public.approve_deposit_request(band_second_deposit_id, admin_id, 400000,
  'w3-cycle-band-credit-2', 'fixture added bank transfer confirmed', gen_random_uuid())
from cycle_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the second deposit still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
update cycle_ctx set
  ledger_count = (select count(*) from public.ledger_transactions),
  wallet_count = (select count(*) from public.wallet_ledger),
  outbox_count = (select count(*) from public.outbox_events);
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select band_id from cycle_ctx))$$,
  'a second deposit inside the window can be stored');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select band_id from cycle_ctx)),
  1,
  'a second deposit before cycle end does not open another cycle');
select ok(
  (select opened.id = ctx.band_cycle_id
      and opened.cycle_started_at = ctx.band_first_effective_at
      and opened.cycle_end = ctx.band_first_effective_at + opened.cycle_days * interval '24 hours'
      and kept.effective_at = ctx.band_first_effective_at
    from cycle_ctx as ctx
    join app_private.funding_cycle_windows as opened
      on opened.user_id = ctx.band_id and opened.cycle_ordinal = 0
    join public.funding_principal_lots as kept
      on kept.user_id = ctx.band_id and kept.amount_atomic = 100000),
  'the second deposit keeps the cycle id, window, and first lot time');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from cycle_ctx))->>'tier_code',
  'L2',
  'the tier can change without moving the cycle');
select is(
  app_private.read_funding_entitlement_foundation((select band_id from cycle_ctx))->>'retention_qualification',
  'UNCONFIRMED',
  'a higher tier still leaves retention unconfirmed');
select is(
  (select count(*) from public.ledger_transactions),
  (select ledger_count from cycle_ctx),
  'storing the same window after another deposit adds no ledger transaction');
select is(
  (select count(*) from public.wallet_ledger),
  (select wallet_count from cycle_ctx),
  'storing the same window after another deposit adds no wallet projection');
select is(
  (select count(*) from public.outbox_events),
  (select outbox_count from cycle_ctx),
  'storing the same window after another deposit adds no outbox event');
reset role;

select set_config(
  'putduk.funding_cycle_as_of',
  (select (opened.cycle_end - interval '1 microsecond')::text
    from app_private.funding_cycle_windows as opened
    where opened.user_id = (select band_id from cycle_ctx)
      and opened.cycle_ordinal = 0),
  true);
set local role service_role;
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select band_id from cycle_ctx))$$,
  'service role ignores a caller clock');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select band_id from cycle_ctx)),
  1,
  'service role cannot open the next cycle before the server reaches it');
reset role;
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select band_id from cycle_ctx))$$,
  'one microsecond before the end can be evaluated by the database clock');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select band_id from cycle_ctx)),
  1,
  'the next cycle stays closed until cycle end');
select set_config(
  'putduk.funding_cycle_as_of',
  (select opened.cycle_end::text
    from app_private.funding_cycle_windows as opened
    where opened.user_id = (select band_id from cycle_ctx)
      and opened.cycle_ordinal = 0),
  true);
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select band_id from cycle_ctx))$$,
  'cycle end opens the next window');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select band_id from cycle_ctx)),
  2,
  'the following cycle is stored after cycle end');
select ok(
  (select first_opened.id = ctx.band_cycle_id
      and first_opened.cycle_started_at = ctx.band_first_effective_at
      and first_opened.cycle_end = ctx.band_first_effective_at
        + first_opened.cycle_days * interval '24 hours'
      and next_opened.cycle_started_at = first_opened.cycle_end
      and next_opened.cycle_end = next_opened.cycle_started_at
        + next_opened.cycle_days * interval '24 hours'
      and next_opened.cycle_days = first_opened.cycle_days
      and kept.effective_at = ctx.band_first_effective_at
    from cycle_ctx as ctx
    join app_private.funding_cycle_windows as first_opened
      on first_opened.user_id = ctx.band_id and first_opened.cycle_ordinal = 0
    join app_private.funding_cycle_windows as next_opened
      on next_opened.user_id = ctx.band_id and next_opened.cycle_ordinal = 1
    join public.funding_principal_lots as kept
      on kept.user_id = ctx.band_id and kept.amount_atomic = 100000),
  'the previous cycle row remains and the next one starts at its end');
select is(
  (app_private.read_funding_cycle_foundation((select band_id from cycle_ctx))->>'active_cycle_id')::uuid,
  (select opened.id from app_private.funding_cycle_windows as opened
    where opened.user_id = (select band_id from cycle_ctx) and opened.cycle_ordinal = 1),
  'at cycle end the active window is the newly opened cycle');
set local role service_role;
select is(
  (app_private.read_funding_cycle_foundation((select band_id from cycle_ctx))->>'active_cycle_id')::uuid,
  (select band_cycle_id from cycle_ctx),
  'the real server clock still reads the original open cycle');
select throws_ok(
  $$select app_private.reject_undecided_principal_recovery(
    (select band_id from cycle_ctx), 1)$$,
  '55000', 'PRINCIPAL_LOT_ALLOCATION_UNDECIDED',
  'partial principal recovery stays undecided');
reset role;
select ok(
  (select count(*)::integer = 2
    from public.funding_principal_lots
    where user_id = (select band_id from cycle_ctx))
  and (select count(*)::integer = 2
    from app_private.funding_cycle_windows
    where user_id = (select band_id from cycle_ctx))
  and not exists (
    select 1 from public.funding_principal_revisions
    where user_id = (select band_id from cycle_ctx) and direction = 'DECREASE'
  )
  and (select kept.effective_at = ctx.band_first_effective_at
    from cycle_ctx as ctx
    join public.funding_principal_lots as kept
      on kept.user_id = ctx.band_id and kept.amount_atomic = 100000),
  'rejected recovery leaves lots, cycle rows, and the first effective time unchanged');
select throws_ok(
  $$update app_private.funding_cycle_windows set cycle_end = cycle_started_at$$,
  '55000', 'funding_cycle_windows is append-only',
  'an existing cycle window cannot be rewritten');

set local role service_role;
update cycle_ctx set late_deposit_id = public.create_deposit_request(
  late_id, 'KRW', 100000, 'w3-cycle-late-request');
select public.approve_deposit_request(late_deposit_id, admin_id, 100000,
  'w3-cycle-late-credit', 'fixture later boundary bank transfer confirmed', gen_random_uuid())
from cycle_ctx;
select lives_ok($$set constraints deposit_requests_money_source_complete immediate$$,
  'the later boundary approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select late_id from cycle_ctx))$$,
  'a later member opens one cycle at qualification');
reset role;
update cycle_ctx set late_cycle_id = opened.id
from app_private.funding_cycle_windows as opened
where opened.user_id = late_id and opened.cycle_ordinal = 0;
select set_config(
  'putduk.funding_cycle_as_of',
  (select (opened.cycle_started_at
      + (opened.cycle_days * 2) * interval '24 hours'
      + interval '1 hour')::text
    from app_private.funding_cycle_windows as opened
    where opened.user_id = (select late_id from cycle_ctx)
      and opened.cycle_ordinal = 0),
  true);
select lives_ok(
  $$select app_private.ensure_funding_cycle_windows((select late_id from cycle_ctx))$$,
  'a later evaluation restores missed windows from the anchor');
select is(
  (select count(*)::integer from app_private.funding_cycle_windows
    where user_id = (select late_id from cycle_ctx)),
  3,
  'two missed boundaries add the closed windows without dropping the first');
select ok(
  (select first_opened.id = ctx.late_cycle_id
      and second_opened.cycle_started_at = first_opened.cycle_end
      and third_opened.cycle_started_at = second_opened.cycle_end
      and third_opened.cycle_started_at is distinct from
        first_opened.cycle_started_at
          + (first_opened.cycle_days * 2) * interval '24 hours'
          + interval '1 hour'
    from cycle_ctx as ctx
    join app_private.funding_cycle_windows as first_opened
      on first_opened.user_id = ctx.late_id and first_opened.cycle_ordinal = 0
    join app_private.funding_cycle_windows as second_opened
      on second_opened.user_id = ctx.late_id and second_opened.cycle_ordinal = 1
    join app_private.funding_cycle_windows as third_opened
      on third_opened.user_id = ctx.late_id and third_opened.cycle_ordinal = 2),
  'missed cycles stay on the original boundaries instead of the evaluation instant');
select set_config('putduk.funding_cycle_as_of', '', true);
select ok(not exists (select 1 from public.outbox_events
  where event_type = 'ECONOMY_POLICY_VERSION_CHANGED.v1'
    and (status <> 'PENDING' or available_at <> 'infinity'::timestamptz
      or last_error_code is distinct from 'POLICY_CONSUMER_NOT_ENABLED')),
  'cycle boundaries still do not enable the policy consumer');

select * from finish();
rollback;
