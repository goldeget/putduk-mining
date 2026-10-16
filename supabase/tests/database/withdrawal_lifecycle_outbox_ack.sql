-- Authoring only in the suspended-execution phase. Run in a fresh local DB.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
select ok((select prosecdef from pg_proc
  where oid='app_private.ack_withdrawal_lifecycle_outbox(uuid,text)'::regprocedure),
  'only the private acknowledgement has definer elevation');
select ok((select not prosecdef from pg_proc
  where oid='public.complete_outbox_event(uuid,text)'::regprocedure),
  'public dispatcher stays invoker');
select ok(not has_function_privilege('anon',
  'app_private.ack_withdrawal_lifecycle_outbox(uuid,text)','EXECUTE'),
  'anonymous cannot acknowledge withdrawals');
select ok(not has_function_privilege('authenticated',
  'app_private.ack_withdrawal_lifecycle_outbox(uuid,text)','EXECUTE'),
  'members cannot acknowledge withdrawals');
select ok(has_function_privilege('service_role',
  'app_private.ack_withdrawal_lifecycle_outbox(uuid,text)','EXECUTE'),
  'closed worker role can call acknowledgement');
select ok(not has_table_privilege('service_role','public.event_consumer_deliveries','INSERT'),
  'patch does not grant broad consumer receipt insertion');
select throws_ok($$select app_private.ack_withdrawal_lifecycle_outbox(
  '00000000-0000-4000-8000-000000000001','worker')$$,
  '42501','WITHDRAWAL_ACK_CLOSED_EXECUTOR_REQUIRED','postgres direct call is not the closed worker');

insert into public.outbox_events(id,event_type,schema_version,aggregate_type,aggregate_id,
  payload,correlation_id,request_id,idempotency_key,status,lease_owner,lease_expires_at)
values('00000000-0000-4000-8000-000000000002','WITHDRAWAL_REQUESTED.v1',1,
  'withdrawal_request','00000000-0000-4000-8000-000000000003','{}',
  gen_random_uuid(),gen_random_uuid(),'ack-negative-original:event','PROCESSING',
  'contract-gap-worker',clock_timestamp()+interval '10 minutes');
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select app_private.ack_withdrawal_lifecycle_outbox(
  '00000000-0000-4000-8000-000000000099','contract-gap-worker')$$,
  '55000','OUTBOX_LEASE_NOT_OWNED','missing event cannot succeed');
select throws_ok($$select app_private.ack_withdrawal_lifecycle_outbox(
  '00000000-0000-4000-8000-000000000002','other-worker')$$,
  '55000','OUTBOX_LEASE_NOT_OWNED','different worker cannot acknowledge');
select throws_ok($$select app_private.ack_withdrawal_lifecycle_outbox(
  '00000000-0000-4000-8000-000000000002','')$$,
  '22023','INVALID_OUTBOX_CLAIM_CONTEXT','empty lease owner rejected');
select throws_ok($$select public.complete_outbox_event(
  '00000000-0000-4000-8000-000000000002','contract-gap-worker')$$,
  '55000','WITHDRAWAL_HOLD_ORIGINAL_REQUIRED','forged event without original cannot succeed');
reset role;
select is((select count(*)::integer from public.event_consumer_deliveries
  where event_id='00000000-0000-4000-8000-000000000002'),0,
  'failed original validation appends no success receipt');
select * from finish();
rollback;
