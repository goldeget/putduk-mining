begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

select ok(
  (select not prosecdef and provolatile = 'v'
      and pg_get_userbyid(proowner) = 'service_role'
      and proconfig @> array['search_path=pg_catalog']::text[]
    from pg_proc
    where oid = 'public.read_own_mining_server_display(uuid)'::regprocedure)
  and not has_function_privilege(
    'authenticated', 'public.read_own_mining_server_display(uuid)', 'EXECUTE')
  and not has_function_privilege(
    'anon', 'public.read_own_mining_server_display(uuid)', 'EXECUTE')
  and not has_function_privilege(
    'public', 'public.read_own_mining_server_display(uuid)', 'EXECUTE')
  and has_function_privilege(
    'service_role', 'public.read_own_mining_server_display(uuid)', 'EXECUTE'),
  'only the server service role can execute the display read');

select ok(
  not has_function_privilege('authenticated', 'app_private.read_funding_principal_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_principal_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.read_funding_entitlement_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_entitlement_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.read_funding_cycle_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_cycle_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.read_funding_segment_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_segment_foundation(uuid)', 'EXECUTE')
  and not has_function_privilege(
    'authenticated',
    'app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)',
    'EXECUTE')
  and not has_function_privilege(
    'anon',
    'app_private.read_funding_capacity_speed(uuid,bigint,bigint[],bigint[],bigint,bigint,bigint,bigint,bigint,bigint[],bigint)',
    'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.read_funding_reward_pending(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app_private.read_funding_reward_pending(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'app_private.read_funding_reward_pending(uuid)', 'EXECUTE'),
  'private funding reads stay service-role only');

select ok(
  position('app_private.read_funding_principal_foundation' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) > 0
  and position('app_private.read_funding_entitlement_foundation' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) > 0
  and position('app_private.read_funding_cycle_foundation' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) > 0
  and position('app_private.read_funding_segment_foundation' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) > 0
  and position('app_private.read_funding_capacity_speed' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) > 0
  and position('app_private.read_funding_reward_pending' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) > 0
  and position('insert into' in lower(pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure))) = 0
  and position('wallet_ledger' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) = 0
  and position('ledger_transactions' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) = 0
  and position('reward_carry' in pg_get_functiondef(
    'public.read_own_mining_server_display(uuid)'::regprocedure)) = 0,
  'the display read calls the existing readers and does not write money');

set local role anon;
select throws_ok(
  $$select public.read_own_mining_server_display('0c5e0000-0000-4000-8000-000000000101'::uuid)$$,
  '42501', null,
  'an anonymous session cannot read mining display');
reset role;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select throws_ok(
  $$select public.read_own_mining_server_display('0c5e0000-0000-4000-8000-000000000101'::uuid)$$,
  '42501', 'permission denied for function read_own_mining_server_display',
  'a member session cannot execute the mining display read');
reset role;

create temporary table display_ctx (
  admin_id uuid,
  owner_id uuid,
  other_id uuid,
  empty_id uuid,
  other_deposit_id uuid,
  owner_deposit_id uuid,
  other_pending text,
  owner_private jsonb,
  owner_principal jsonb,
  owner_entitlement jsonb,
  owner_cycle jsonb
);
insert into display_ctx (admin_id, owner_id, other_id, empty_id) values (
  '0c5e0000-0000-4000-8000-0000000000a1',
  '0c5e0000-0000-4000-8000-000000000101',
  '0c5e0000-0000-4000-8000-000000000102',
  '0c5e0000-0000-4000-8000-000000000103'
);
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select person.id, 'authenticated', 'authenticated', person.email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (
  select admin_id as id, 'display-admin@putduk.test' as email from display_ctx
  union all select owner_id, 'display-owner@putduk.test' from display_ctx
  union all select other_id, 'display-other@putduk.test' from display_ctx
  union all select empty_id, 'display-empty@putduk.test' from display_ctx
) as person;
insert into public.user_roles(user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from display_ctx;
grant select, update on display_ctx to service_role;
grant select on display_ctx to authenticated;

select set_config('request.jwt.claim.sub', (select empty_id::text from display_ctx), true);
set local role service_role;
select is(
  (public.read_own_mining_server_display((select empty_id from display_ctx))->>'available'),
  'false',
  'a member without a funding subject gets an empty display');
select throws_ok(
  $$select public.read_own_mining_server_display((select owner_id from display_ctx))$$,
  '42501', 'MINING_DISPLAY_SUBJECT_FORBIDDEN',
  'a member cannot read another member display');
reset role;

set local role service_role;
select public.bootstrap_user((select other_id from display_ctx));
select public.bootstrap_user((select owner_id from display_ctx));
update display_ctx set other_deposit_id = public.create_deposit_request(
  other_id, 'KRW', 99999, 'display-other-request');
select public.approve_deposit_request(
  other_deposit_id, admin_id, 99999,
  'display-other-credit', 'fixture bank transfer confirmed', gen_random_uuid())
from display_ctx;
select lives_ok(
  $$set constraints deposit_requests_money_source_complete immediate$$,
  'below-minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
update display_ctx set other_pending = (
  app_private.read_funding_reward_pending(other_id)->>'pending_micro_krw'
);
reset role;

select is(
  (select other_pending from display_ctx),
  '0',
  'below-minimum private pending is zero');

select set_config('request.jwt.claim.sub', (select other_id::text from display_ctx), true);
set local role service_role;
select is(
  (public.read_own_mining_server_display((select other_id from display_ctx))->>'pending_micro_krw'),
  (select other_pending from display_ctx),
  'below-minimum display pending matches the private micro');
reset role;

set local role service_role;
update display_ctx set owner_deposit_id = public.create_deposit_request(
  owner_id, 'KRW', 100000, 'display-owner-request');
select public.approve_deposit_request(
  owner_deposit_id, admin_id, 100000,
  'display-owner-credit', 'fixture minimum bank transfer confirmed', gen_random_uuid())
from display_ctx;
select lives_ok(
  $$set constraints deposit_requests_money_source_complete immediate$$,
  'minimum approval still completes the original source receipt');
set constraints deposit_requests_money_source_complete deferred;
select lives_ok(
  $$select app_private.ensure_funding_cycle_segments((select owner_id from display_ctx))$$,
  'the stored segment is the display input');
reset role;

alter table app_private.funding_cycle_segments
  disable trigger funding_cycle_segments_append_only;
update app_private.funding_cycle_segments as segment
set effective_until = segment.effective_at + interval '1 millisecond'
where segment.user_id = (select owner_id from display_ctx)
  and segment.segment_ordinal = 0;
alter table app_private.funding_cycle_segments
  enable trigger funding_cycle_segments_append_only;
select pg_sleep(0.2);

set local role service_role;
update display_ctx set
  owner_private = app_private.read_funding_reward_pending(owner_id),
  owner_principal = app_private.read_funding_principal_foundation(owner_id),
  owner_entitlement = app_private.read_funding_entitlement_foundation(owner_id),
  owner_cycle = app_private.read_funding_cycle_foundation(owner_id);
select ok(
  (select count(*)::integer from app_private.funding_cycle_segments
    where user_id = (select owner_id from display_ctx)) = 1
  and (select (owner_private->>'pending_micro_krw')::bigint > 0 from display_ctx)
  and (select (owner_private->>'retention_unconfirmed_micro_krw')::bigint > 0 from display_ctx),
  'the finished stored segment has separate pending and unconfirmed retention');
reset role;

select set_config('request.jwt.claim.sub', (select owner_id::text from display_ctx), true);
set local role service_role;
select ok(
  (select display->>'available' = 'true'
      and display->>'pending_micro_krw' = ctx.owner_private->>'pending_micro_krw'
      and display->>'retention_unconfirmed_micro_krw'
        = ctx.owner_private->>'retention_unconfirmed_micro_krw'
      and display->>'eligible_principal_micro_krw'
        = ctx.owner_principal->>'eligible_principal_micro_krw'
      and display->>'tier_code' = ctx.owner_entitlement->>'tier_code'
      and display->>'tier_activated' = ctx.owner_entitlement->>'tier_activated'
      and display->>'cycle_started_at' = ctx.owner_cycle->>'cycle_started_at'
      and display->>'cycle_end' = ctx.owner_cycle->>'cycle_end'
      and display->>'effective_capacity_micro_krw'
        = ctx.owner_private->>'effective_capacity_micro_krw'
      and display->>'remaining_capacity_micro_krw'
        = ctx.owner_private->>'remaining_capacity_micro_krw'
      and display->>'used_capacity_micro_krw'
        = ctx.owner_private->>'used_capacity_micro_krw'
      and display->>'speed_multiplier_bps' = ctx.owner_private->>'speed_multiplier_bps'
      and (display->>'pending_micro_krw')::bigint
        < (display->>'pending_micro_krw')::bigint
          + (display->>'retention_unconfirmed_micro_krw')::bigint
      and not (display ? 'segments')
      and not (display ? 'policy_id')
      and not (display ? 'policy_version')
      and not (display ? 'base_cycle_rate_bps')
      and not (display ? 'reader')
      and not (display ? 'confirmed_micro_krw')
      and not (display ? 'retention_entitlement_micro_krw')
    from display_ctx as ctx
    cross join lateral (
      select public.read_own_mining_server_display(ctx.owner_id) as display
    ) as shown),
  'the owner display matches the private pending micro without adding retention');
select throws_ok(
  $$select public.read_own_mining_server_display((select other_id from display_ctx))$$,
  '42501', 'MINING_DISPLAY_SUBJECT_FORBIDDEN',
  'the owner cannot read the other member');
reset role;

select set_config('request.jwt.claim.sub', (select other_id::text from display_ctx), true);
set local role service_role;
select throws_ok(
  $$select public.read_own_mining_server_display((select owner_id from display_ctx))$$,
  '42501', 'MINING_DISPLAY_SUBJECT_FORBIDDEN',
  'the other member cannot read the owner display');
reset role;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
set local role service_role;
select throws_ok(
  $$select public.read_own_mining_server_display(null::uuid)$$,
  '42501', 'MINING_DISPLAY_SUBJECT_FORBIDDEN',
  'the server role cannot read a missing subject');
select is(
  (public.read_own_mining_server_display((select owner_id from display_ctx))->>'pending_micro_krw'),
  (select owner_private->>'pending_micro_krw' from display_ctx),
  'the server role reads the member id supplied by the signed-in session');
reset role;

select * from finish();
rollback;
