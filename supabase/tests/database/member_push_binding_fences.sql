-- DRAFT, NOT EXECUTED. Actual auth.sessions shape must be verified against the
-- fresh pinned local Auth database before this fixture is applied. No HTTP/send.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new)
select id,'authenticated','authenticated',id::text||'@push-contract.putduk.test','',clock_timestamp(),'{}','{}',
  clock_timestamp(),clock_timestamp(),'','','','' from unnest(array[
    '39100000-0000-4000-8000-000000000001'::uuid,'39100000-0000-4000-8000-000000000002'::uuid])id;
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) values
  ('39100000-0000-4000-8000-000000000011','39100000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 minute',clock_timestamp(),'aal1',clock_timestamp()+interval '1 hour'),
  ('39100000-0000-4000-8000-000000000012','39100000-0000-4000-8000-000000000001',clock_timestamp()-interval '1 minute',clock_timestamp(),'aal1',clock_timestamp()+interval '1 hour'),
  ('39100000-0000-4000-8000-000000000021','39100000-0000-4000-8000-000000000002',clock_timestamp()-interval '1 minute',clock_timestamp(),'aal1',clock_timestamp()+interval '1 hour');
create temporary table push_binding_ctx(name text primary key,value jsonb);
grant select,insert,update on push_binding_ctx to service_role;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;

-- Test setup adapter only: production callers must present explicit click intent.
create function pg_temp.register_bound_push_fixture(p_user uuid,p_session uuid,p_operation text,p_endpoint text,
 p_key text,p_secret text,p_expiry timestamptz,p_agent text)returns jsonb
 language plpgsql security invoker as $fixture$
declare snapshot jsonb;permit jsonb;intent uuid:=gen_random_uuid();
begin
 if p_operation<>'REGISTER'then raise exception 'FIXTURE_REGISTER_ONLY';end if;
 snapshot:=public.member_push_endpoint_command(p_user,p_session,'SNAPSHOT',p_endpoint,null,null,null,null,null,null,null);
 permit:=public.member_push_endpoint_command(p_user,p_session,'ISSUE',p_endpoint,p_key,p_secret,p_expiry,p_agent,
  (snapshot->>'endpointEpoch')::bigint,intent,null);
 return public.member_push_endpoint_command(p_user,p_session,'REGISTER',p_endpoint,p_key,p_secret,p_expiry,p_agent,
  (snapshot->>'endpointEpoch')::bigint,intent,(permit->>'permitId')::uuid);
end;$fixture$;
do $$begin execute format('grant usage on schema %I to service_role',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
grant execute on function pg_temp.register_bound_push_fixture(uuid,uuid,text,text,text,text,timestamptz,text)to service_role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.endpoint_command(op text,ep text,epoch bigint,intent uuid,permit uuid default null,
 sid uuid default '39100000-0000-4000-8000-000000000011',key text default repeat('a',80))returns jsonb
 language sql security invoker as $cmd$
 select public.member_push_endpoint_command('39100000-0000-4000-8000-000000000001',sid,op,ep,
  case when op in('ISSUE','REGISTER')then key else null end,
  case when op in('ISSUE','REGISTER')then repeat('b',24)else null end,null,
  case when op in('ISSUE','REGISTER')then 'LOCAL_NATIVE_FIXTURE'else null end,epoch,intent,permit);
$cmd$;
grant execute on function pg_temp.endpoint_command(text,text,bigint,uuid,uuid,uuid,text)to service_role;
set local role service_role;
insert into push_binding_ctx values('permit0',pg_temp.endpoint_command('ISSUE',
 'https://fcm.googleapis.com/fcm/send/same-endpoint',0,'39100000-0000-4000-8000-000000000101'));
select is(pg_temp.endpoint_command('ISSUE','https://fcm.googleapis.com/fcm/send/same-endpoint',0,
 '39100000-0000-4000-8000-000000000101'),(select value from push_binding_ctx where name='permit0'),
 'lost permit response replays exact owner/session/payload/epoch permit');
insert into push_binding_ctx values('revoked1',pg_temp.endpoint_command('REVOKE',
 'https://fcm.googleapis.com/fcm/send/same-endpoint',null,'39100000-0000-4000-8000-000000000201'));
select is((select(value->>'endpointEpoch')::integer from push_binding_ctx where name='revoked1'),1,'absent DELETE advances epoch');
select is(pg_temp.endpoint_command('REVOKE','https://fcm.googleapis.com/fcm/send/same-endpoint',null,
 '39100000-0000-4000-8000-000000000201'),(select value from push_binding_ctx where name='revoked1'),'lost DELETE response replays receipt without advancing again');
select throws_ok($$select pg_temp.endpoint_command('ISSUE','https://fcm.googleapis.com/fcm/send/same-endpoint',0,
 '39100000-0000-4000-8000-000000000102')$$,'55000','PUSH_EPOCH_STALE','permit issuance arriving after DELETE rejects pre-delete expected epoch');
select throws_ok($$select pg_temp.endpoint_command('REGISTER','https://fcm.googleapis.com/fcm/send/same-endpoint',0,
 '39100000-0000-4000-8000-000000000101',(select(value->>'permitId')::uuid from push_binding_ctx where name='permit0'))$$,
 '55000','PUSH_EPOCH_STALE','old permit REGISTER cannot insert after absent DELETE');
select is((pg_temp.endpoint_command('SNAPSHOT','https://fcm.googleapis.com/fcm/send/same-endpoint',null,null)->>'endpointEpoch')::integer,
 1,'reload reconciliation observes current epoch without enabling');
insert into push_binding_ctx values('permit1',pg_temp.endpoint_command('ISSUE','https://fcm.googleapis.com/fcm/send/same-endpoint',1,
 '39100000-0000-4000-8000-000000000103'));
select throws_ok($$select pg_temp.endpoint_command('REGISTER','https://fcm.googleapis.com/fcm/send/same-endpoint',1,
 '39100000-0000-4000-8000-000000000103','39100000-0000-4000-8000-000000000999')$$,
 '42501','PUSH_PERMIT_INVALID','forged permit UUID rejected');
select throws_ok($$select pg_temp.endpoint_command('REGISTER','https://fcm.googleapis.com/fcm/send/same-endpoint',1,
 '39100000-0000-4000-8000-000000000103',(select(value->>'permitId')::uuid from push_binding_ctx where name='permit1'),
 '39100000-0000-4000-8000-000000000012')$$,'42501','PUSH_INTENT_MISMATCH','permit cannot cross active sessions of same owner');
select throws_ok($$select pg_temp.endpoint_command('REGISTER','https://fcm.googleapis.com/fcm/send/same-endpoint',1,
 '39100000-0000-4000-8000-000000000103',(select(value->>'permitId')::uuid from push_binding_ctx where name='permit1'),
 '39100000-0000-4000-8000-000000000011',repeat('c',80))$$,'42501','PUSH_INTENT_MISMATCH','canonical key digest blocks payload mutation');
insert into push_binding_ctx values('enabled2',pg_temp.endpoint_command('REGISTER','https://fcm.googleapis.com/fcm/send/same-endpoint',1,
 '39100000-0000-4000-8000-000000000103',(select(value->>'permitId')::uuid from push_binding_ctx where name='permit1')));
select is((select value->>'subscribed' from push_binding_ctx where name='enabled2'),'true','same native endpoint explicitly re-enables using current epoch');
select is(pg_temp.endpoint_command('REGISTER','https://fcm.googleapis.com/fcm/send/same-endpoint',1,
 '39100000-0000-4000-8000-000000000103',(select(value->>'permitId')::uuid from push_binding_ctx where name='permit1')),
 (select value from push_binding_ctx where name='enabled2'),'lost REGISTER response replays same receipt while generation remains current');
select throws_ok($$select pg_temp.endpoint_command('REVOKE','https://fcm.googleapis.com/fcm/send/same-endpoint',null,
 '39100000-0000-4000-8000-000000000201')$$,'55000','PUSH_REVOKE_SUPERSEDED','late old DELETE retry does not disable fresh explicit enable');
select pg_temp.endpoint_command('REVOKE','https://fcm.googleapis.com/fcm/send/same-endpoint',null,'39100000-0000-4000-8000-000000000202');
select throws_ok($$select pg_temp.endpoint_command('REGISTER','https://fcm.googleapis.com/fcm/send/same-endpoint',1,
 '39100000-0000-4000-8000-000000000103',(select(value->>'permitId')::uuid from push_binding_ctx where name='permit1'))$$,
 '55000','PUSH_EPOCH_STALE','existing subscription DELETE blocks old registration replay');
select pg_temp.register_bound_push_fixture('39100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000011','REGISTER',
 'https://fcm.googleapis.com/fcm/send/session-a',repeat('a',80),repeat('b',24),null,'LOCAL_NATIVE_FIXTURE');
select pg_temp.register_bound_push_fixture('39100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000012','REGISTER',
 'https://fcm.googleapis.com/fcm/send/session-b',repeat('a',80),repeat('b',24),null,'LOCAL_NATIVE_FIXTURE');
select public.apply_member_push_binding('39100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000011','LOGOUT_LOCAL',null,null,null,null,null);
select throws_ok($$select pg_temp.endpoint_command('ISSUE','https://fcm.googleapis.com/fcm/send/late-unknown',0,
 '39100000-0000-4000-8000-000000000104')$$,'42501','PUSH_SESSION_REVOKED','local logout fences unknown late endpoints before permit issuance');
reset role;
select ok((select revoked_at is not null from public.push_subscriptions where endpoint='https://fcm.googleapis.com/fcm/send/session-a'),'local logout revokes session A');
select ok((select revoked_at is null from public.push_subscriptions where endpoint='https://fcm.googleapis.com/fcm/send/session-b'),'local logout preserves session B');
select ok((select web_push_enabled from public.notification_preferences where user_id='39100000-0000-4000-8000-000000000001'),'another eligible session keeps preference enabled');
set local role service_role;
select public.apply_member_push_binding('39100000-0000-4000-8000-000000000001','39100000-0000-4000-8000-000000000012','LOGOUT_GLOBAL',null,null,null,null,null);
select throws_ok($$select pg_temp.endpoint_command('ISSUE','https://fcm.googleapis.com/fcm/send/global-late',0,
 '39100000-0000-4000-8000-000000000105',null,'39100000-0000-4000-8000-000000000012')$$,
 '42501','PUSH_SESSION_REVOKED','global cutoff blocks old session before issuance');
select throws_ok($$select public.upsert_push_subscription('39100000-0000-4000-8000-000000000001',
 'https://fcm.googleapis.com/fcm/send/session-b',repeat('a',80),repeat('b',24),null,'LOCAL_NATIVE_FIXTURE')$$,
 '42501','PUSH_SESSION_BINDING_REQUIRED','legacy unbound writer cannot reactivate bound subscription');
reset role;
select ok(not(select web_push_enabled from public.notification_preferences where user_id='39100000-0000-4000-8000-000000000001'),'global logout disables preference with no eligible binding');
select ok(not has_function_privilege('authenticated','public.member_push_endpoint_command(uuid,uuid,text,text,text,text,timestamp with time zone,text,bigint,uuid,uuid)','EXECUTE'),'clients cannot spoof service owner/session fields');
select ok(not has_table_privilege('service_role','app_private.push_enable_permits','INSERT'),'permit writes confined to bounded command');
select ok(not has_table_privilege('service_role','app_private.push_endpoint_epochs','UPDATE'),'epoch cannot be reset through direct service writes');
-- Sequential tests do not establish actual two-connection lock behavior.
-- See EPOCH_PERMIT_CONCURRENCY_PROBES.md for mandatory fresh DB probes.
select * from finish();rollback;
