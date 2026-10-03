begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temporary table safe_mode_ctx (admin_id uuid, viewer_id uuid, receipt_id uuid, control_id uuid);
insert into safe_mode_ctx values
  ('0d460000-0000-4000-8000-0000000000a1', '0d460000-0000-4000-8000-0000000000a2', null, null);
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
select id, 'authenticated', 'authenticated', email, '', statement_timestamp(),
  '{}'::jsonb, '{}'::jsonb, statement_timestamp(), statement_timestamp(), '', '', '', ''
from (select admin_id as id, 'safe-mode-admin@putduk.test' as email from safe_mode_ctx
  union all select viewer_id, 'safe-mode-viewer@putduk.test' from safe_mode_ctx) as person;
insert into public.user_roles (user_id, role, granted_by)
select admin_id, 'ADMIN'::public.app_role, admin_id from safe_mode_ctx
union all select viewer_id, 'VIEWER'::public.app_role, viewer_id from safe_mode_ctx;

-- Test-only helper, rolled back with every fixture. It calls the production
-- audit INSERT as service_role and never seeds its final state or event.
create function pg_temp.safe_mode_command(
  p_key text, p_paused boolean, p_expected uuid default null,
  p_reason text default 'verified safe mode operation',
  p_review timestamptz default null, p_actor uuid default null,
  p_role public.app_role default 'ADMIN', p_component text default 'AI'
) returns uuid language plpgsql security invoker set search_path = pg_catalog as $$
declare v_id uuid;
begin
  insert into public.audit_logs (actor_user_id, actor_role, action, target_type,
    target_id, reason, request_id, metadata)
  values (coalesce(p_actor, (select admin_id from pg_temp.safe_mode_ctx)), p_role,
    case when p_paused then 'SAFE_MODE_ENABLED' else 'SAFE_MODE_DISABLED' end,
    'SAFE_MODE', p_component, p_reason, gen_random_uuid(), jsonb_build_object(
      'command_version', 1, 'idempotency_key', p_key, 'component', p_component,
      'is_paused', p_paused, 'review_at', p_review, 'expected_request_id', p_expected))
  returning id into v_id;
  return v_id;
end; $$;
grant select, update on safe_mode_ctx to service_role;
do $$ begin
  execute format('grant usage on schema %I to service_role',
    (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end; $$;
grant execute on function pg_temp.safe_mode_command(text, boolean, uuid, text,
  timestamptz, uuid, public.app_role, text) to service_role;

select ok(not has_function_privilege('anon', 'app_private.apply_safe_mode_audit_command()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'app_private.apply_safe_mode_audit_command()', 'EXECUTE'),
  'browser roles cannot call the private command trigger');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog']::text[]
  from pg_proc where oid = 'app_private.apply_safe_mode_audit_command()'::regprocedure),
  'the command uses invoker authority and a pinned path');

set local role service_role;
update safe_mode_ctx set receipt_id = pg_temp.safe_mode_command('safe-mode-first-operation', true);
reset role;
update safe_mode_ctx set control_id = control.id from public.safe_mode_controls as control
where control.component = 'AI';
select ok((select control.is_paused and control.changed_by = ctx.admin_id
  and control.request_id = audit.request_id and audit.after_state->>'id' = control.id::text
  from safe_mode_ctx as ctx join public.safe_mode_controls as control on control.id = ctx.control_id
  join public.audit_logs as audit on audit.id = ctx.receipt_id),
  'one actual server-role command creates its state and immutable receipt');
select is((select count(*)::integer from public.outbox_events where
  event_type = 'SAFE_MODE_CHANGED.v1' and aggregate_id = (select control_id from safe_mode_ctx)),
  1, 'the same command creates one versioned event');
select is((select status from app_private.idempotency_keys where scope = 'safe_mode.control'
  and idempotency_key = 'safe-mode-first-operation'), 'COMPLETED', 'its logical key commits completed');

select is(pg_temp.safe_mode_command('safe-mode-first-operation', true), null::uuid,
  'a verified retry does not append another audit');
select is((select count(*)::integer from public.audit_logs where
  metadata->>'idempotency_key' = 'safe-mode-first-operation'), 1, 'the first audit stays unique');
select throws_ok($$select pg_temp.safe_mode_command('safe-mode-first-operation', false)$$,
  '22023', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'a same-key changed pause is rejected');
select throws_ok($$select pg_temp.safe_mode_command('safe-mode-first-operation', true,
  null, 'changed reason for same logical key')$$, '22023', 'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'a changed reason cannot borrow a completed key');
select throws_ok($$select pg_temp.safe_mode_command('safe-mode-first-operation', true,
  null, 'verified safe mode operation', null, null, 'ADMIN', 'NOTIFICATION')$$,
  '22023', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'one key cannot target another component');
select throws_ok($$select pg_temp.safe_mode_command('safe-mode-stale-operation', false)$$,
  '40001', 'SAFE_MODE_STATE_CHANGED', 'stale visible state cannot overwrite a later command');
select throws_ok($$select pg_temp.safe_mode_command('safe-mode-past-review', false,
  null, 'verified safe mode operation', '2000-01-01T00:00:00Z')$$,
  '22023', 'INVALID_SAFE_MODE_REVIEW_TIME', 'DB server time rejects an expired review');
select throws_ok($$select pg_temp.safe_mode_command('safe-mode-viewer-operation', true,
  null, 'verified safe mode operation', null, (select viewer_id from safe_mode_ctx), 'VIEWER', 'AI')$$,
  '42501', 'OPERATOR_ROLE_REQUIRED', 'a viewer has no command authority');

-- Outbox failure must roll back the state, audit and logical-key reservation.
create function pg_temp.fail_safe_mode_event() returns trigger language plpgsql
security invoker set search_path = pg_catalog as $$
begin
  if new.event_type = 'SAFE_MODE_CHANGED.v1'
    and new.idempotency_key = 'safe-mode:safe-mode-outbox-failure' then
    raise exception using errcode = 'P0001', message = 'TEST_SAFE_MODE_OUTBOX_FAILURE';
  end if;
  return new;
end; $$;
create trigger safe_mode_test_event_failure before insert on public.outbox_events
for each row execute function pg_temp.fail_safe_mode_event();
select throws_ok($$select pg_temp.safe_mode_command('safe-mode-outbox-failure', false,
  (select request_id from public.safe_mode_controls where component = 'AI'))$$,
  'P0001', 'TEST_SAFE_MODE_OUTBOX_FAILURE', 'event failure aborts the entire command');
select ok((select is_paused from public.safe_mode_controls where component = 'AI'),
  'failed event leaves the prior pause unchanged');
select is((select count(*)::integer from public.audit_logs where
  metadata->>'idempotency_key' = 'safe-mode-outbox-failure'), 0, 'failed event leaves no audit');
select is((select count(*)::integer from app_private.idempotency_keys where scope = 'safe_mode.control'
  and idempotency_key = 'safe-mode-outbox-failure'), 0, 'failed event leaves no logical-key reservation');
drop trigger safe_mode_test_event_failure on public.outbox_events;

select lives_ok($$select pg_temp.safe_mode_command('safe-mode-second-operation', false,
  (select request_id from public.safe_mode_controls where component = 'AI'))$$,
  'a fresh reviewed state can be changed once');
select ok(not (select is_paused from public.safe_mode_controls where component = 'AI'),
  'the second command actually clears the pause');
select is(pg_temp.safe_mode_command('safe-mode-first-operation', true), null::uuid,
  'the old completed request remains a verified receipt after a later change');
select ok(not (select is_paused from public.safe_mode_controls where component = 'AI'),
  'replaying the old pause never overwrites the newer clear');
select is((select count(*)::integer from public.outbox_events where
  event_type = 'SAFE_MODE_CHANGED.v1' and aggregate_id = (select control_id from safe_mode_ctx)),
  2, 'only two original commands produced two events');

-- Real worker completion verifies the old command without replaying its state.
update public.outbox_events set status = 'PROCESSING', lease_owner = 'safe-pgtap-worker',
  lease_expires_at = clock_timestamp() + interval '1 minute'
where payload->>'audit_id' = (select receipt_id::text from safe_mode_ctx);
select throws_ok($$select public.complete_outbox_event(
  (select id from public.outbox_events where payload->>'audit_id' = (select receipt_id::text from safe_mode_ctx)),
  'another-worker')$$, '55000', 'OUTBOX_LEASE_NOT_OWNED', 'a different worker cannot acknowledge the event');
set local role service_role;
select lives_ok($$select public.complete_outbox_event(
  (select id from public.outbox_events where payload->>'audit_id' = (select receipt_id::text from pg_temp.safe_mode_ctx)),
  'safe-pgtap-worker')$$, 'an actual service worker acknowledges the original immutable command');
reset role;
select is((select count(*)::integer from public.event_consumer_deliveries as delivery
  join public.outbox_events as event on event.id = delivery.event_id
  where event.payload->>'audit_id' = (select receipt_id::text from safe_mode_ctx)
    and delivery.consumer_name = 'operator_safe_mode_audit.v1' and delivery.status = 'SUCCEEDED'),
  1, 'one internal consumer receipt accompanies the event completion');
select ok(not (select is_paused from public.safe_mode_controls where component = 'AI'),
  'consuming an old pause never reapplies it after the newer clear');
-- Only the isolated fixture simulates lease recovery for a duplicate delivery.
update public.outbox_events set status = 'PROCESSING', lease_owner = 'safe-pgtap-worker',
  lease_expires_at = clock_timestamp() + interval '1 minute'
where payload->>'audit_id' = (select receipt_id::text from safe_mode_ctx);
select lives_ok($$select public.complete_outbox_event(
  (select id from public.outbox_events where payload->>'audit_id' = (select receipt_id::text from safe_mode_ctx)),
  'safe-pgtap-worker')$$, 'duplicate delivery verifies and retains the original consumer receipt');
select is((select count(*)::integer from public.event_consumer_deliveries), 1,
  'duplicate delivery creates no extra consumer effect');
select ok(not has_table_privilege('service_role', 'public.event_consumer_deliveries', 'UPDATE')
  and not has_table_privilege('service_role', 'public.event_consumer_deliveries', 'DELETE'),
  'the worker cannot rewrite or delete delivery receipts');
-- Corrupt only the second event's fixture payload, never shared history.
update public.outbox_events set payload = payload || '{"request_hash":"invalid"}'::jsonb,
  status = 'PROCESSING', lease_owner = 'safe-pgtap-worker',
  lease_expires_at = clock_timestamp() + interval '1 minute'
where idempotency_key = 'safe-mode:safe-mode-second-operation';
select throws_ok($$select public.complete_outbox_event(
  (select id from public.outbox_events where idempotency_key = 'safe-mode:safe-mode-second-operation'),
  'safe-pgtap-worker')$$, '55000', 'SAFE_MODE_EVENT_RECEIPT_MISMATCH', 'a changed event never borrows a valid command receipt');
select is((select status::text from public.outbox_events where
  idempotency_key = 'safe-mode:safe-mode-second-operation'), 'PROCESSING',
  'rejected completion leaves the owned event available for explicit failure handling');
select is((select count(*)::integer from public.event_consumer_deliveries), 1,
  'rejected completion leaves no consumer receipt');

-- Deliberately corrupt only this transaction's fixture; never remove shared history.
update app_private.idempotency_keys set response_payload = '{}'::jsonb where
  scope = 'safe_mode.control' and idempotency_key = 'safe-mode-first-operation';
select throws_ok($$select pg_temp.safe_mode_command('safe-mode-first-operation', true)$$,
  '55000', 'SAFE_MODE_RECEIPT_MISMATCH', 'an incomplete cached receipt fails closed');
select ok(not (select is_paused from public.safe_mode_controls where component = 'AI'),
  'a broken receipt is never repaired by reapplying state');

select * from finish();
rollback;
