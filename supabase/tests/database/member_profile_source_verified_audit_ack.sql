begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Actual signup trigger, controlled SQL Auth fixture. This is not a GoTrue UI proof.
-- A second statement occurs after BEGIN so transaction time differs from capture time.
create temporary table profile_ack_ctx(user_id uuid,event_id uuid,marketing boolean);
insert into profile_ack_ctx(user_id,marketing) values
 ('17500000-0000-4000-8000-000000000001',false),
 ('17500000-0000-4000-8000-000000000002',true);
select pg_sleep(0.02);
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select user_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
 'profile-175-'||right(user_id::text,1)||'@putduk.local','',transaction_timestamp(),
 '{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('signup_source','PUBLIC_V1','login_id','profile175_'||right(user_id::text,1),
 'legal_name','검증 회원','date_of_birth','1990-01-01',
 'phone_e164','+82109751750'||right(user_id::text,1),
 'recovery_email','profile-175-'||right(user_id::text,1)||'@putduk.local',
 'service_terms_version','TERMS-KO-2026-09-27','service_terms_granted',true,
 'privacy_version','PRIVACY-KO-2026-09-27','privacy_granted',true,
 'marketing_version','MARKETING-KO-2026-09-27','marketing_granted',marketing),
 transaction_timestamp(),transaction_timestamp() from profile_ack_ctx;
update profile_ack_ctx c set event_id=e.id from public.outbox_events e
 where e.event_type='MEMBER_PROFILE_CAPTURED.v1' and e.aggregate_id=c.user_id;
select is((select count(*) from profile_ack_ctx where event_id is not null),2::bigint,
 'real signup trigger creates both exact profile originals');
select ok((select bool_and(created_at>transaction_timestamp()) from public.outbox_events
 where id in(select event_id from profile_ack_ctx)),
 'capture statement time genuinely differs from transaction time without timestamp rewrites');
select is((select count(*) from public.user_consent_records where user_id in(select user_id from profile_ack_ctx)
 and captured_via='SIGNUP'),6::bigint,'each original has three immutable captured consents');
select is((select count(*) from public.member_timeline_events where user_id in(select user_id from profile_ack_ctx)
 and event_type='MEMBER_PROFILE_CAPTURED'),2::bigint,'signup already writes exactly one timeline per member');
select ok((select bool_and(app_private.read_member_profile_capture_original(event_id) is not null)
 from profile_ack_ctx),'source validator accepts genuine transaction/statement-time signup originals');
select ok(not has_table_privilege('service_role','app_private.member_profile_audit_receipts','INSERT'),
 'workers receive no direct private receipt INSERT privilege');
select ok(not has_table_privilege('authenticated','app_private.member_profile_audit_receipts','SELECT'),
 'members receive no private audit or identity snapshot read privilege');
select ok(not has_function_privilege('authenticated','app_private.consume_member_profile_audit(uuid,text)','EXECUTE'),
 'members cannot execute the owner audit consumer');

-- SETTINGS is later mutable preference history, not the captured SIGNUP boolean.
insert into public.user_consent_records(user_id,consent_key,consent_version,granted,captured_via,request_id,metadata)
select user_id,'MARKETING','MARKETING-KO-2026-09-27',not marketing,'SETTINGS',gen_random_uuid(),
 '{"locale":"ko-KR"}'::jsonb from profile_ack_ctx;
select ok((select bool_and((app_private.read_member_profile_capture_original(event_id)
 ->'event'->'payload'->>'marketing_granted')::boolean=marketing) from profile_ack_ctx),
 'later settings grant/revocation never substitutes captured signup marketing true or false');

select throws_ok(format('update public.outbox_events set payload=payload||%L::jsonb where id=%L',
 '{"marketing_granted":null}',(select event_id from profile_ack_ctx where not marketing)),
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_IMMUTABLE','captured false cannot mutate to null');
select throws_ok(format('update public.outbox_events set actor_user_id=%L where id=%L',
 (select user_id from profile_ack_ctx where marketing),(select event_id from profile_ack_ctx where not marketing)),
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_IMMUTABLE','original owner is immutable');
select throws_ok(format('delete from public.outbox_events where id=%L',
 (select event_id from profile_ack_ctx where not marketing)),
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_IMMUTABLE','original cannot be deleted/replaced');
select throws_ok(format('update public.outbox_events set status=''PROCESSED'',processed_at=clock_timestamp() where id=%L',
 (select event_id from profile_ack_ctx where not marketing)),
 '55000','MEMBER_PROFILE_AUDIT_RECEIPT_INVALID','direct terminal update cannot skip an audit ACK');

create temporary table profile_effects_before as select
 (select count(*) from public.ledger_transactions) ledger,
 (select count(*) from public.notifications) notifications,
 (select count(*) from public.member_timeline_events where user_id in(select user_id from profile_ack_ctx)) timeline;
-- Controlled lease fixture, followed by actual canonical completion RPC.
update public.outbox_events set status='PROCESSING',attempt_count=1,lease_owner='qa-profile-175',
 lease_expires_at=clock_timestamp()+interval '60 seconds'
 where id in(select event_id from profile_ack_ctx);
grant select on profile_ack_ctx to service_role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select throws_ok(format('select public.complete_outbox_event(%L,''wrong-worker'')',
 (select event_id from profile_ack_ctx where not marketing)),
 '55000','OUTBOX_LEASE_NOT_OWNED','wrong worker cannot audit or complete the original');
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role service_role;
select throws_ok(format('select app_private.consume_member_profile_audit(%L,''qa-profile-175'')',
 (select event_id from profile_ack_ctx where not marketing)),
 '42501','MEMBER_PROFILE_AUDIT_SERVICE_REQUIRED','SQL service role with crossed JWT is rejected');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.outbox_events set lease_expires_at=clock_timestamp()-interval '1 second'
 where id=(select event_id from profile_ack_ctx where not marketing);
set local role service_role;
select throws_ok(format('select public.complete_outbox_event(%L,''qa-profile-175'')',
 (select event_id from profile_ack_ctx where not marketing)),
 '55000','OUTBOX_LEASE_NOT_OWNED','expired worker lease cannot audit the original');
reset role;
update public.outbox_events set lease_expires_at=clock_timestamp()+interval '60 seconds'
 where id=(select event_id from profile_ack_ctx where not marketing);

-- Deliberate fault after delivery INSERT must roll back ACK, receipt and terminal state.
create function pg_temp.fail_profile_receipt() returns trigger language plpgsql as $$
begin raise exception using errcode='55000',message='QA_PROFILE_RECEIPT_FAULT';end;$$;
create trigger qa_profile_receipt_fault before insert on app_private.member_profile_audit_receipts
for each row execute function pg_temp.fail_profile_receipt();
set local role service_role;
select throws_ok(format('select public.complete_outbox_event(%L,''qa-profile-175'')',
 (select event_id from profile_ack_ctx where not marketing)),
 '55000','QA_PROFILE_RECEIPT_FAULT','receipt-stage fault aborts the canonical completion transaction');
reset role;
select is((select count(*) from public.event_consumer_deliveries where event_id in(select event_id from profile_ack_ctx)),
 0::bigint,'intermediate delivery INSERT rolls back');
select is((select count(*) from app_private.member_profile_audit_receipts
 where event_id in(select event_id from profile_ack_ctx)),0::bigint,'failed consumer leaves no private receipt');
select is((select status::text from public.outbox_events where id=(select event_id from profile_ack_ctx where not marketing)),
 'PROCESSING','failed consumer leaves the original lease state unchanged');
drop trigger qa_profile_receipt_fault on app_private.member_profile_audit_receipts;
set local role service_role;
select lives_ok(format('select public.complete_outbox_event(%L,''qa-profile-175'')',
 (select event_id from profile_ack_ctx where not marketing)),'genuine captured false completes via existing canonical command');
select lives_ok(format('select public.complete_outbox_event(%L,''qa-profile-175'')',
 (select event_id from profile_ack_ctx where marketing)),'genuine captured true completes via existing canonical command');
reset role;
select is((select count(*) from app_private.member_profile_audit_receipts where event_id in(select event_id from profile_ack_ctx)),
 2::bigint,'exactly one private audit receipt per original');
select is((select count(*) from public.event_consumer_deliveries where event_id in(select event_id from profile_ack_ctx)
 and consumer_name='member_profile_audit.v1' and status='SUCCEEDED'),2::bigint,'exactly one terminal internal delivery per original');
select ok((select bool_and(status='PROCESSED' and lease_owner is null and lease_expires_at is null)
 from public.outbox_events where id in(select event_id from profile_ack_ctx)),'completion seals terminal state and clears both leases');
select ok((select bool_and(source_digest=app_private.funding_engine_digest(source_snapshot))
 from app_private.member_profile_audit_receipts where event_id in(select event_id from profile_ack_ctx)),
 'audit digest binds the actual captured source rows and immutable envelope');
select throws_ok(format('update app_private.member_profile_audit_receipts set source_digest=repeat(''0'',64) where event_id=%L',
 (select event_id from profile_ack_ctx where not marketing)),null,null,'private audit receipt is append-only');
select throws_ok(format('update public.event_consumer_deliveries set consumer_name=''fake.v1'' where event_id=%L',
 (select event_id from profile_ack_ctx where not marketing)),
 '55000','MEMBER_PROFILE_AUDIT_DELIVERY_IMMUTABLE','audit delivery cannot change its consumer identity');

-- Controlled recovery lease replays the same immutable original; no duplicate effect.
update public.outbox_events set status='PROCESSING',processed_at=null,attempt_count=2,
 lease_owner='qa-profile-175-replay',lease_expires_at=clock_timestamp()+interval '60 seconds'
 where id=(select event_id from profile_ack_ctx where not marketing);
set local role service_role;
select lives_ok(format('select public.complete_outbox_event(%L,''qa-profile-175-replay'')',
 (select event_id from profile_ack_ctx where not marketing)),'leased replay validates and reuses the sealed receipt');
reset role;
select is((select count(*) from app_private.member_profile_audit_receipts where event_id in(select event_id from profile_ack_ctx)),
 2::bigint,'replay adds no audit receipt');
select is((select count(*) from public.event_consumer_deliveries where event_id in(select event_id from profile_ack_ctx)),
 2::bigint,'replay adds no consumer delivery');
select is((select count(*) from public.ledger_transactions),(select ledger from profile_effects_before),
 'profile auditing never writes money');
select is((select count(*) from public.notifications),(select notifications from profile_effects_before),
 'profile auditing never creates a member notification');
select is((select count(*) from public.member_timeline_events where user_id in(select user_id from profile_ack_ctx)),
 (select timeline from profile_effects_before),'profile auditing never duplicates the signup timeline');

-- Existing Auth owner with no canonical signup profile is not business authority.
insert into auth.users(id,instance_id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('17500000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','profile-175-forged@putduk.local','{}','{}',now(),now());
-- Every negative changes one field on an otherwise valid envelope for the same
-- Auth owner with no existing profile event. No wrong key/request masks another defect.
create function pg_temp.insert_profile_candidate(p_override jsonb) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare
 u uuid := '17500000-0000-4000-8000-000000000003';
 q uuid := gen_random_uuid();
 j jsonb;
 original_payload jsonb;
begin
 original_payload := jsonb_build_object('user_id',u,'required_consent_versions',
   jsonb_build_array('TERMS-KO-2026-09-27','PRIVACY-KO-2026-09-27'),'marketing_granted',false);
 j := jsonb_build_object('event_type','MEMBER_PROFILE_CAPTURED.v1','schema_version',1,
   'aggregate_type','user_identity_profile','aggregate_id',u,'actor_user_id',u,
   'payload',original_payload,'correlation_id',q,'request_id',q,'idempotency_key','member-profile:'||u::text)
   || (p_override-'payload');
 if p_override ? 'payload' then j:=j||jsonb_build_object('payload',original_payload||(p_override->'payload'));end if;
 insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,
   payload,correlation_id,request_id,idempotency_key)
 values(j->>'event_type',(j->>'schema_version')::integer,j->>'aggregate_type',
   (j->>'aggregate_id')::uuid,(j->>'actor_user_id')::uuid,j->'payload',
   (j->>'correlation_id')::uuid,(j->>'request_id')::uuid,j->>'idempotency_key');
end;$$;
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"payload":{"originalVerified":true}}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','extra payload attestation cannot bypass source authority');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"schema_version":2}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','schema version alone is rejected');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"event_type":"MEMBER_PROFILE_CAPTURED.v2"}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','event version alone is rejected');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"actor_user_id":"17500000-0000-4000-8000-000000000001"}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','foreign actor alone is rejected');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"payload":{"required_consent_versions":["TERMS-KO-2026-09-27","PRIVACY-KO-2026-09-28"]}}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','unapproved required consent version alone is rejected');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"payload":{"marketing_granted":null}}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','captured marketing null alone is rejected');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"payload":{"marketing_granted":"false"}}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','captured marketing string alone is rejected');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"request_id":"17500000-0000-4000-8000-000000000004"}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','different request UUID alone is rejected');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"correlation_id":"17500000-0000-4000-8000-000000000004"}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','different correlation UUID alone is rejected');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"request_id":null}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','null request UUID is rejected by the envelope guard');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"correlation_id":null}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','null correlation UUID is rejected by the envelope guard');
select throws_ok($sql$select pg_temp.insert_profile_candidate('{"idempotency_key":"profile-other:17500000-0000-4000-8000-000000000003"}')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','wrong idempotency namespace alone is rejected');
select is((select count(*) from public.outbox_events where aggregate_id='17500000-0000-4000-8000-000000000003'),
 0::bigint,'all independent malformed envelope inserts rolled back before the source-fake phase');
insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,actor_user_id,
 payload,correlation_id,request_id,idempotency_key,status,attempt_count,lease_owner,lease_expires_at)
select 'MEMBER_PROFILE_CAPTURED.v1',1,'user_identity_profile',u,u,
 jsonb_build_object('user_id',u,'required_consent_versions',
 jsonb_build_array('TERMS-KO-2026-09-27','PRIVACY-KO-2026-09-27'),'marketing_granted',false),
 q,q,'member-profile:'||u::text,'PROCESSING',1,'qa-profile-175-forged',clock_timestamp()+interval '60 seconds'
from(select '17500000-0000-4000-8000-000000000003'::uuid u,gen_random_uuid() q)s;
set local role service_role;
select throws_ok('select public.complete_outbox_event((select id from public.outbox_events where aggregate_id=''17500000-0000-4000-8000-000000000003''),''qa-profile-175-forged'')',
 '55000','MEMBER_PROFILE_CAPTURE_ORIGINAL_INVALID','syntactically valid forged profile with no actual source cannot be ACKed');
reset role;
select is((select count(*) from app_private.member_profile_audit_receipts where user_id='17500000-0000-4000-8000-000000000003'),
 0::bigint,'forged profile leaves no private receipt');
select throws_ok($sql$insert into public.event_consumer_deliveries(event_id,consumer_name,status,attempt_count,processed_at)
 select id,'member_profile_audit.v1','SUCCEEDED',1,clock_timestamp() from public.outbox_events
 where aggregate_id='17500000-0000-4000-8000-000000000003'$sql$,
 '55000','MEMBER_PROFILE_AUDIT_DELIVERY_INVALID','direct fake audit delivery is denied outside the closed executor');
select throws_ok($sql$insert into public.outbox_events(event_type,schema_version,aggregate_type,aggregate_id,
 actor_user_id,payload,correlation_id,request_id,idempotency_key)
 values('MEMBER_PROFILE_CAPTURED.v1',1,'user_identity_profile','17500000-0000-4000-8000-000000000003',
 '17500000-0000-4000-8000-000000000003','{"user_id":"17500000-0000-4000-8000-000000000003","required_consent_versions":["TERMS-KO-2026-09-27","PRIVACY-KO-2026-09-27"],"marketing_granted":null}',
 gen_random_uuid(),gen_random_uuid(),'member-profile:17500000-0000-4000-8000-000000000099')$sql$,
 '55000','MEMBER_PROFILE_CAPTURE_ENVELOPE_INVALID','direct malformed profile namespace INSERT is denied');

select * from finish();
rollback;
