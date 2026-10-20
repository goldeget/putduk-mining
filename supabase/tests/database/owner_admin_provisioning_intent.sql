begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(62);

select has_table('app_private', 'owner_admin_provision_intents', 'private owner intents exist');
select has_table('app_private', 'owner_admin_provision_receipts', 'private immutable receipts exist');
select has_function('app_private', 'capture_owner_admin_provision', array['uuid','text','text','text','text'], 'owner capture is a private helper');
select ok((select not prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='app_private.capture_owner_admin_provision(uuid,text,text,text,text)'::regprocedure), 'new helper is INVOKER with fixed search path');
select ok((select prosecdef and proconfig @> array['search_path=pg_catalog'] from pg_proc where oid='app_private.capture_public_signup_identity()'::regprocedure), 'original signup trigger keeps its definer/search path');
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class where oid in ('app_private.owner_admin_provision_intents'::regclass,'app_private.owner_admin_provision_receipts'::regclass)), 'both private tables enable and force RLS');
select ok(not has_function_privilege('anon','app_private.capture_owner_admin_provision(uuid,text,text,text,text)','EXECUTE') and not has_function_privilege('authenticated','app_private.capture_owner_admin_provision(uuid,text,text,text,text)','EXECUTE') and not has_function_privilege('service_role','app_private.capture_owner_admin_provision(uuid,text,text,text,text)','EXECUTE'), 'no client or service role can call owner capture directly');
select ok(not has_table_privilege('anon','app_private.owner_admin_provision_intents','SELECT') and not has_table_privilege('authenticated','app_private.owner_admin_provision_intents','INSERT'), 'public callers cannot read or register intents');
select ok(has_table_privilege('service_role','app_private.owner_admin_provision_intents','SELECT') and has_table_privilege('service_role','app_private.owner_admin_provision_intents','INSERT') and not has_table_privilege('service_role','app_private.owner_admin_provision_intents','UPDATE') and not has_table_privilege('service_role','app_private.owner_admin_provision_intents','DELETE'), 'service intent ACL is append-only select/insert');
select ok(not has_table_privilege('service_role','app_private.owner_admin_provision_receipts','INSERT') and not has_table_privilege('service_role','app_private.owner_admin_provision_receipts','UPDATE') and not has_table_privilege('service_role','app_private.owner_admin_provision_receipts','DELETE'), 'service cannot forge or rewrite receipts');

create function pg_temp.owner_intent(p_request uuid, p_user uuid, p_email text, p_expiry timestamptz default statement_timestamp()+interval '10 minutes') returns void language sql as $$
  insert into app_private.owner_admin_provision_intents(request_id,planned_auth_user_id,email_sha256,expires_at,reason,authorization_reference)
  values(p_request,p_user,encode(extensions.digest(convert_to(lower(btrim(p_email)),'UTF8'),'sha256'),'hex'),p_expiry,'Synthetic local owner provisioning test only','local-test:owner-admin-provisioning-intent');
$$;
create function pg_temp.owner_auth(p_user uuid,p_email text,p_flow text,p_request text,p_provider text default 'email',p_extra jsonb default '{}'::jsonb) returns void language sql as $$
  insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
  values(p_user,'authenticated','authenticated',p_email,jsonb_build_object('provider',p_provider),p_extra || jsonb_strip_nulls(jsonb_build_object('identity_flow',p_flow,'provision_request_id',p_request)));
$$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
values('81000000-0000-4000-8000-000000000001','existing-owner-fixture@putduk.test','{}','{}');
insert into public.user_roles(user_id,role) values('81000000-0000-4000-8000-000000000001','VIEWER');
create temporary table owner_existing_roles as select * from public.user_roles;
select throws_ok($q$select public.bootstrap_first_super_admin('81000000-0000-4000-8000-000000000001','Synthetic local test reason','BOOTSTRAP_FIRST_SUPER_ADMIN','82000000-0000-4000-8000-000000000001')$q$,'55000','FIRST_ADMIN_ALREADY_BOOTSTRAPPED','first-admin guard remains intact when roles already exist');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000002','missing-profile@putduk.test',null,null)$q$,'23514','PUBLIC_SIGNUP_PROFILE_REQUIRED','plain email creation still requires public signup profile');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000003','forged-owner@putduk.test','OWNER_ADMIN_PROVISION_V1',null)$q$,'22023','OWNER_ADMIN_REQUEST_INVALID','owner marker without request ID is rejected');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000003','forged-owner@putduk.test','OWNER_ADMIN_PROVISION_V1','bad-request')$q$,'22023','OWNER_ADMIN_REQUEST_INVALID','malformed request is rejected');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000003','forged-owner@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000099')$q$,'23514','OWNER_ADMIN_INTENT_UNAVAILABLE','public metadata cannot invent a private intent');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000004','unsupported-flow@putduk.test','UNAPPROVED_ADMIN_FLOW','82000000-0000-4000-8000-000000000099')$q$,'23514','PUBLIC_SIGNUP_PROFILE_REQUIRED','another marker still follows the unchanged public profile guard');
select throws_ok($q$select pg_temp.owner_intent('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','existing-owner-fixture@putduk.test')$q$,'23514','OWNER_ADMIN_NEW_IDENTITY_REQUIRED','existing Auth identities cannot be preauthorized');
select throws_ok($q$select pg_temp.owner_intent('82000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','forged-owner@putduk.test',statement_timestamp()+interval '16 minutes')$q$,'23514','OWNER_ADMIN_INTENT_WINDOW_INVALID','intent expiry cannot exceed fifteen minutes');
select throws_ok($q$select pg_temp.owner_intent('82000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','forged-owner@putduk.test',statement_timestamp()-interval '1 second')$q$,'23514','OWNER_ADMIN_INTENT_WINDOW_INVALID','already expired intent cannot be registered');

select pg_temp.owner_intent('82000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000010','approved-owner-fixture@putduk.test');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000011','approved-owner-fixture@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010')$q$,'23514','OWNER_ADMIN_INTENT_MISMATCH','copied public marker with another Auth UUID is rejected');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000010','wrong-owner-fixture@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010')$q$,'23514','OWNER_ADMIN_INTENT_MISMATCH','wrong email cannot consume the intent');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000010','approved-owner-fixture@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010','google')$q$,'23514','OWNER_ADMIN_INTENT_MISMATCH','another Auth provider cannot consume the intent');
select is((select count(*) from auth.users where id in ('81000000-0000-4000-8000-000000000010','81000000-0000-4000-8000-000000000011')),0::bigint,'failed owner creation rolls back Auth rows');
select lives_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000010','approved-owner-fixture@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010')$q$,'preauthorized fresh owner creates atomically without member identity or consent');
select is((select count(*) from public.user_profiles where user_id='81000000-0000-4000-8000-000000000010' and display_name='운영자'),1::bigint,'new owner has one minimal profile');
select is((select count(*) from public.user_roles where user_id='81000000-0000-4000-8000-000000000010' and role='SUPER_ADMIN' and granted_by is null and revoked_at is null),1::bigint,'new owner has one owner-authorized role without impersonated actor');
select is((select count(*) from public.user_identity_profiles where user_id='81000000-0000-4000-8000-000000000010'),0::bigint,'owner identity has no fake legal name DOB or phone');
select is((select count(*) from public.user_consent_records where user_id='81000000-0000-4000-8000-000000000010'),0::bigint,'owner provisioning fabricates no member consent');
select is((select count(*) from public.wallet_accounts where user_id='81000000-0000-4000-8000-000000000010'),0::bigint,'owner provisioning fabricates no member wallet');
select is((select count(*) from public.trial_accounts where user_id='81000000-0000-4000-8000-000000000010'),0::bigint,'owner provisioning fabricates no trial');
select ok((select count(*)=1 from app_private.owner_admin_provision_receipts r join public.user_roles ur on ur.id=r.role_id and ur.user_id=r.auth_user_id join public.audit_logs a on a.id=r.audit_id and a.request_id=r.request_id and a.target_id=r.role_id::text where r.request_id='82000000-0000-4000-8000-000000000010' and a.actor_user_id is null and a.actor_role is null and a.action='role.owner_authorized_new_super_admin' and r.receipt_digest ~ '^[0-9a-f]{64}$'), 'receipt binds exactly one role and audit to the authorized fresh identity');
select ok((select not (after_state::text ~ '@|password|phone|email_sha256') and not (metadata::text ~ '@|password|phone|email_sha256') from public.audit_logs where request_id='82000000-0000-4000-8000-000000000010'), 'audit contains no email password phone or email hash');
select results_eq('select * from public.user_roles where user_id<>''81000000-0000-4000-8000-000000000010'' order by id','select * from owner_existing_roles order by id','all existing user role records remain byte-for-byte unchanged');
select throws_ok($q$update app_private.owner_admin_provision_intents set reason='Attempted rewrite' where request_id='82000000-0000-4000-8000-000000000010'$q$,'55000','owner_admin_provision_intents is append-only','intent is immutable');
select throws_ok($q$delete from app_private.owner_admin_provision_receipts where request_id='82000000-0000-4000-8000-000000000010'$q$,'55000','owner_admin_provision_receipts is append-only','success receipt cannot be deleted');
select throws_ok($q$select app_private.capture_owner_admin_provision('81000000-0000-4000-8000-000000000010','approved-owner-fixture@putduk.test','email','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010')$q$,'42501','OWNER_ADMIN_TRIGGER_ONLY','even maintenance cannot invoke capture outside an Auth trigger');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000012','consumed-request-copy@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010')$q$,'23514','OWNER_ADMIN_INTENT_UNAVAILABLE','a consumed request cannot grant another role');

select throws_ok($q$insert into app_private.owner_admin_provision_intents(request_id,planned_auth_user_id,email_sha256,expires_at,reason,authorization_reference,purpose) values('82000000-0000-4000-8000-000000000040','81000000-0000-4000-8000-000000000040',repeat('a',64),statement_timestamp()+interval '10 minutes','Synthetic invalid purpose test','local-test:invalid-purpose','GENERAL_ADMIN')$q$,'23514',null,'intent purpose cannot be generalized');
select throws_ok($q$insert into app_private.owner_admin_provision_intents(request_id,planned_auth_user_id,email_sha256,expires_at,reason,authorization_reference,role) values('82000000-0000-4000-8000-000000000040','81000000-0000-4000-8000-000000000040',repeat('a',64),statement_timestamp()+interval '10 minutes','Synthetic invalid role test','local-test:invalid-role','VIEWER')$q$,'23514',null,'intent role cannot become a general role grant');
select throws_ok($q$insert into app_private.owner_admin_provision_intents(request_id,planned_auth_user_id,email_sha256,created_at,expires_at,reason,authorization_reference) values('82000000-0000-4000-8000-000000000040','81000000-0000-4000-8000-000000000040',repeat('a',64),statement_timestamp()+interval '1 second',statement_timestamp()+interval '10 minutes','Synthetic future clock test','local-test:future-clock')$q$,'23514','OWNER_ADMIN_INTENT_WINDOW_INVALID','client cannot register a future-valid intent');
select pg_temp.owner_intent('82000000-0000-4000-8000-000000000041','81000000-0000-4000-8000-000000000041','expired-owner@putduk.test',clock_timestamp()+interval '100 milliseconds');
select pg_sleep(0.2);
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000041','expired-owner@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000041')$q$,'23514','OWNER_ADMIN_INTENT_UNAVAILABLE','an expired unused intent cannot be consumed');
set local role anon;
select throws_ok($q$select app_private.capture_owner_admin_provision('81000000-0000-4000-8000-000000000010','synthetic@putduk.test','email','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010')$q$,'42501',null,'actual anonymous SQL role cannot call helper');
reset role;
set local role authenticated;
select throws_ok($q$select app_private.capture_owner_admin_provision('81000000-0000-4000-8000-000000000010','synthetic@putduk.test','email','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010')$q$,'42501',null,'actual authenticated SQL role cannot call helper');
reset role;
set local role service_role;
select throws_ok($q$select app_private.capture_owner_admin_provision('81000000-0000-4000-8000-000000000010','synthetic@putduk.test','email','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000010')$q$,'42501',null,'actual service SQL role cannot call capture helper directly');
select throws_ok($q$insert into app_private.owner_admin_provision_receipts select * from app_private.owner_admin_provision_receipts$q$,'42501',null,'actual service SQL role cannot forge a receipt');
select throws_ok($q$insert into app_private.owner_admin_provision_intents(request_id,planned_auth_user_id,email_sha256,expires_at,reason,authorization_reference) values('82000000-0000-4000-8000-000000000042','81000000-0000-4000-8000-000000000042',repeat('a',64),statement_timestamp()+interval '10 minutes','Synthetic service role test','local-test:service-role')$q$,'42501','OWNER_ADMIN_INTENT_REGISTRATION_PRIVILEGE_REQUIRED','registration fails closed without broad Auth read authority');
reset role;

create function pg_temp.fail_owner_audit() returns trigger language plpgsql as $$ begin if new.action='role.owner_authorized_new_super_admin' then raise exception using errcode='P0001',message='OWNER_TEST_AUDIT_FAILURE'; end if; return new; end; $$;
create trigger owner_test_fail_audit before insert on public.audit_logs for each row execute function pg_temp.fail_owner_audit();
select pg_temp.owner_intent('82000000-0000-4000-8000-000000000020','81000000-0000-4000-8000-000000000020','audit-failure@putduk.test');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000020','audit-failure@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000020')$q$,'P0001','OWNER_TEST_AUDIT_FAILURE','an audit failure aborts the complete Auth creation');
select ok(not exists(select 1 from auth.users where id='81000000-0000-4000-8000-000000000020') and not exists(select 1 from public.user_profiles where user_id='81000000-0000-4000-8000-000000000020') and not exists(select 1 from public.user_roles where user_id='81000000-0000-4000-8000-000000000020') and not exists(select 1 from app_private.owner_admin_provision_receipts where request_id='82000000-0000-4000-8000-000000000020'),'audit failure leaves no Auth profile role or receipt');
drop trigger owner_test_fail_audit on public.audit_logs;
create function pg_temp.fail_owner_receipt() returns trigger language plpgsql as $$ begin raise exception using errcode='P0001',message='OWNER_TEST_RECEIPT_FAILURE'; end; $$;
create trigger owner_test_fail_receipt before insert on app_private.owner_admin_provision_receipts for each row execute function pg_temp.fail_owner_receipt();
select pg_temp.owner_intent('82000000-0000-4000-8000-000000000021','81000000-0000-4000-8000-000000000021','receipt-failure@putduk.test');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000021','receipt-failure@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000021')$q$,'P0001','OWNER_TEST_RECEIPT_FAILURE','a receipt failure aborts the complete Auth creation');
select ok(not exists(select 1 from auth.users where id='81000000-0000-4000-8000-000000000021') and not exists(select 1 from public.user_roles where user_id='81000000-0000-4000-8000-000000000021') and not exists(select 1 from public.audit_logs where request_id='82000000-0000-4000-8000-000000000021'),'receipt failure rolls back preceding Auth role and audit');
drop trigger owner_test_fail_receipt on app_private.owner_admin_provision_receipts;

create function pg_temp.fail_owner_role() returns trigger language plpgsql as $$ begin if new.user_id='81000000-0000-4000-8000-000000000022' then raise exception using errcode='P0001',message='OWNER_TEST_ROLE_FAILURE'; end if; return new; end; $$;
create trigger owner_test_fail_role before insert on public.user_roles for each row execute function pg_temp.fail_owner_role();
select pg_temp.owner_intent('82000000-0000-4000-8000-000000000022','81000000-0000-4000-8000-000000000022','role-failure@putduk.test');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000022','role-failure@putduk.test','OWNER_ADMIN_PROVISION_V1','82000000-0000-4000-8000-000000000022')$q$,'P0001','OWNER_TEST_ROLE_FAILURE','a role insert failure aborts the complete Auth creation');
select ok(not exists(select 1 from auth.users where id='81000000-0000-4000-8000-000000000022') and not exists(select 1 from public.user_profiles where user_id='81000000-0000-4000-8000-000000000022') and not exists(select 1 from public.audit_logs where request_id='82000000-0000-4000-8000-000000000022'),'role failure rolls back Auth and profile without an audit');
drop trigger owner_test_fail_role on public.user_roles;

select lives_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000030','ordinary-member@putduk.test',null,null,'email',jsonb_build_object('signup_source','PUBLIC_V1','login_id','owner_test_member','legal_name','합성회원','date_of_birth','1990-01-01','phone_e164','+821099988877','recovery_email','ordinary-member@putduk.test','service_terms_granted',true,'privacy_granted',true,'marketing_granted',false,'service_terms_version','TERMS-KO-2026-09-27','privacy_version','PRIVACY-KO-2026-09-27','marketing_version','MARKETING-KO-2026-09-27'))$q$,'unchanged valid PUBLIC_V1 member capture still completes');
select is((select count(*) from public.user_identity_profiles where user_id='81000000-0000-4000-8000-000000000030'),1::bigint,'PUBLIC_V1 still captures its identity');
select is((select count(*) from public.user_consent_records where user_id='81000000-0000-4000-8000-000000000030'),3::bigint,'PUBLIC_V1 still captures all three consent choices');
select ok((select granted=false from public.user_consent_records where user_id='81000000-0000-4000-8000-000000000030' and consent_key='MARKETING'),'PUBLIC_V1 optional false consent stays false');
select is((select count(*) from public.wallet_accounts where user_id='81000000-0000-4000-8000-000000000030' and currency='KRW'),1::bigint,'PUBLIC_V1 still bootstraps its KRW foundation');
select is((select count(*) from public.outbox_events where aggregate_id='81000000-0000-4000-8000-000000000030' and event_type='MEMBER_PROFILE_CAPTURED.v1'),1::bigint,'PUBLIC_V1 still writes the original outbox event');
select is((select count(*) from public.member_timeline_events where user_id='81000000-0000-4000-8000-000000000030' and event_type='MEMBER_PROFILE_CAPTURED'),1::bigint,'PUBLIC_V1 still writes its original timeline');
select is((select count(*) from public.user_roles where user_id='81000000-0000-4000-8000-000000000030'),0::bigint,'public members gain no administrator role');
select throws_ok($q$select pg_temp.owner_auth('81000000-0000-4000-8000-000000000031','missing-consent@putduk.test',null,null,'email',jsonb_build_object('signup_source','PUBLIC_V1','login_id','owner_test_denied','legal_name','합성회원','date_of_birth','1990-01-01','phone_e164','+821099988876','recovery_email','missing-consent@putduk.test','service_terms_granted',true,'privacy_granted',false,'marketing_granted',false,'service_terms_version','TERMS-KO-2026-09-27','privacy_version','PRIVACY-KO-2026-09-27','marketing_version','MARKETING-KO-2026-09-27'))$q$,'23514','REQUIRED_CONSENT_MISSING','ordinary public signup still rejects missing required consent');
select ok(not exists(select 1 from auth.users where id='81000000-0000-4000-8000-000000000031') and not exists(select 1 from public.user_identity_profiles where user_id='81000000-0000-4000-8000-000000000031'),'rejected member consent still rolls back the Auth identity');

select * from finish();
rollback;
